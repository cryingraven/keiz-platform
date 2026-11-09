use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{UnorderedMap, UnorderedSet, Vector};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use serde::{Deserialize, Serialize};

const EVENT_VERSION: &str = "1.0.0";
const MAX_RECEIPTS_PER_PAGE: u64 = 100;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Receipt {
    pub id: u64,
    pub token: AccountId,
    pub sender: AccountId,
    pub amount: u128,
    pub receivable_ref: String,
    pub block_height: u64,
    pub observed_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptView {
    pub id: u64,
    pub token: AccountId,
    pub sender: AccountId,
    pub amount: U128,
    pub receivable_ref: String,
    pub block_height: u64,
    pub observed_at: u64,
}

impl From<Receipt> for ReceiptView {
    fn from(receipt: Receipt) -> Self {
        Self {
            id: receipt.id,
            token: receipt.token,
            sender: receipt.sender,
            amount: U128(receipt.amount),
            receivable_ref: receipt.receivable_ref,
            block_height: receipt.block_height,
            observed_at: receipt.observed_at,
        }
    }
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ReceiptMsg {
    #[serde(alias = "receivableRef")]
    receivable_ref: String,
    #[serde(default, alias = "orgId")]
    org_id: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    treasury: AccountId,
    org_id: String,
    paused: bool,
    allowed_tokens: UnorderedSet<AccountId>,
    receipts: Vector<Receipt>,
    receipts_by_ref: UnorderedMap<String, Vec<u64>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, treasury: Option<AccountId>, org_id: String) -> Self {
        let treasury = treasury.unwrap_or_else(|| owner.clone());
        Self {
            owner,
            treasury,
            org_id,
            paused: false,
            allowed_tokens: UnorderedSet::new(b"t"),
            receipts: Vector::new(b"r"),
            receipts_by_ref: UnorderedMap::new(b"i"),
        }
    }

    /// NEP-141 receiver. Returning zero accepts the transfer; the full amount
    /// is returned to the token contract (and refunded) when the token, message
    /// or pause state is invalid.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if self.paused || !self.allowed_tokens.contains(&token) {
            return PromiseOrValue::Value(amount);
        }
        let Some((receivable_ref, msg_org)) = parse_receipt_msg(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        if let Some(msg_org) = msg_org {
            if !self.org_id.is_empty() && msg_org != self.org_id {
                return PromiseOrValue::Value(amount);
            }
        }

        let id = self.receipts.len();
        let receipt = Receipt {
            id,
            token: token.clone(),
            sender: sender_id,
            amount: amount.0,
            receivable_ref: receivable_ref.clone(),
            block_height: env::block_height(),
            observed_at: env::block_timestamp(),
        };
        self.receipts.push(&receipt);

        let mut ids = self.receipts_by_ref.get(&receivable_ref).unwrap_or_default();
        ids.push(id);
        self.receipts_by_ref.insert(&receivable_ref, &ids);

        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "keiz",
                "version": EVENT_VERSION,
                "event": "receipt",
                "data": {
                    "id": id,
                    "token": token,
                    "sender": receipt.sender,
                    "amount": amount.0.to_string(),
                    "receivableRef": receivable_ref,
                    "orgId": self.org_id,
                    "blockHeight": receipt.block_height,
                    "observedAt": receipt.observed_at,
                }
            })
        ));

        PromiseOrValue::Value(U128(0))
    }

    pub fn get_receipt(&self, id: u64) -> Option<ReceiptView> {
        self.receipts.get(id).map(ReceiptView::from)
    }

    pub fn get_receipts(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<ReceiptView> {
        let start = from_index.unwrap_or(0);
        let count = limit.unwrap_or(50).clamp(1, MAX_RECEIPTS_PER_PAGE);
        let end = self.receipts.len().min(start.saturating_add(count));
        (start..end)
            .filter_map(|index| self.receipts.get(index))
            .map(ReceiptView::from)
            .collect()
    }

    pub fn get_receipts_for_ref(
        &self,
        receivable_ref: String,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<ReceiptView> {
        let ids = self.receipts_by_ref.get(&receivable_ref).unwrap_or_default();
        let start = from_index.unwrap_or(0) as usize;
        let count = limit.unwrap_or(50).clamp(1, MAX_RECEIPTS_PER_PAGE) as usize;
        ids.iter()
            .skip(start)
            .take(count)
            .filter_map(|id| self.receipts.get(*id))
            .map(ReceiptView::from)
            .collect()
    }

    pub fn get_receipt_count(&self) -> u64 {
        self.receipts.len()
    }

    /// Owner-only sweep. The treasury is a suggested destination, not an
    /// enforced one, so an owner can recover a mis-sent receipt (including a
    /// non-allowlisted token).
    pub fn sweep(
        &mut self,
        token: AccountId,
        to: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> Promise {
        self.assert_owner();
        assert!(!self.paused, "contract is paused");
        assert!(amount.0 > 0, "amount must be positive");
        assert!(to != env::current_account_id(), "cannot sweep to self");
        let args = serde_json::json!({
            "receiver_id": to,
            "amount": amount.0.to_string(),
            "memo": memo,
        });
        Promise::new(token).function_call(
            "ft_transfer".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(50),
        )
    }

    pub fn set_allowed_token(&mut self, token: AccountId, allowed: bool) {
        self.assert_owner();
        if allowed {
            self.allowed_tokens.insert(&token);
        } else {
            self.allowed_tokens.remove(&token);
        }
    }

    pub fn is_token_allowed(&self, token: AccountId) -> bool {
        self.allowed_tokens.contains(&token)
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_owner();
        self.treasury = treasury;
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_org_id(&self) -> String {
        self.org_id.clone()
    }

    pub fn get_treasury(&self) -> AccountId {
        self.treasury.clone()
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "owner only");
    }
}

fn parse_receipt_msg(msg: &str) -> Option<(String, Option<String>)> {
    let value = msg.trim();
    if value.is_empty() {
        return None;
    }
    let (reference, org_id) = if value.starts_with('{') {
        let parsed = serde_json::from_str::<ReceiptMsg>(value).ok()?;
        (parsed.receivable_ref, parsed.org_id)
    } else {
        (value.to_string(), None)
    };
    let reference = reference.trim().to_string();
    if reference.len() < 4 || reference.len() > 64 {
        return None;
    }
    if !reference.starts_with("AR-") {
        return None;
    }
    if !reference
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return None;
    }
    Some((reference, org_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_json_refs() {
        assert_eq!(
            parse_receipt_msg("AR-2001"),
            Some(("AR-2001".to_string(), None))
        );
        assert_eq!(
            parse_receipt_msg(r#"{"receivableRef":"AR-2002"}"#),
            Some(("AR-2002".to_string(), None))
        );
        assert_eq!(
            parse_receipt_msg(r#"{"receivable_ref":"AR-2003","orgId":"org-1"}"#),
            Some(("AR-2003".to_string(), Some("org-1".to_string())))
        );
    }

    #[test]
    fn rejects_invalid_refs() {
        assert_eq!(parse_receipt_msg(""), None);
        assert_eq!(parse_receipt_msg("INV-1"), None);
        assert_eq!(parse_receipt_msg("AR-"), None);
        assert_eq!(parse_receipt_msg("AR-1;drop"), None);
    }
}
