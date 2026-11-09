use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};
use serde::{Deserialize, Serialize};

const EVENT_VERSION: &str = "1.0.0";
const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
const MAX_PROPOSALS_PER_PAGE: u64 = 100;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum ProposalKind {
    #[default]
    Direct,
    IntentsDeposit,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub allowed_assets: Vec<AccountId>,
    pub allowed_recipients: Vec<AccountId>,
    pub intents_enabled: bool,
    pub active: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct DailySpend {
    pub day: u64,
    pub spent: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Proposal {
    pub id: u64,
    pub proposer: AccountId,
    pub token: AccountId,
    pub to: AccountId,
    pub amount: U128,
    pub kind: ProposalKind,
    pub correlation_id: Option<String>,
    pub deadline: Option<u64>,
    pub memo: Option<String>,
    pub approvals: Vec<AccountId>,
    pub executed: bool,
    pub rejected: bool,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ProposeArgs {
    pub token: AccountId,
    pub to: AccountId,
    pub amount: U128,
    #[serde(default)]
    pub kind: ProposalKind,
    pub correlation_id: Option<String>,
    pub deadline: Option<u64>,
    pub memo: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    approvers: UnorderedSet<AccountId>,
    threshold: u32,
    policy: Policy,
    paused: bool,
    proposals: UnorderedMap<u64, Proposal>,
    daily: LookupMap<AccountId, DailySpend>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, approvers: Vec<AccountId>, threshold: u32, policy: Policy) -> Self {
        assert!(!approvers.is_empty(), "at least one approver is required");
        assert!(
            threshold > 0 && threshold as usize <= approvers.len(),
            "threshold must be between 1 and the approver count"
        );
        validate_policy_shape(&policy);
        let mut approver_set = UnorderedSet::new(b"a");
        for approver in approvers {
            approver_set.insert(&approver);
        }
        Self {
            owner,
            approvers: approver_set,
            threshold,
            policy,
            paused: false,
            proposals: UnorderedMap::new(b"p"),
            daily: LookupMap::new(b"d"),
        }
    }

    pub fn propose(&mut self, args: ProposeArgs) -> u64 {
        self.assert_not_paused();
        let predecessor = env::predecessor_account_id();
        assert!(
            predecessor == self.owner || self.approvers.contains(&predecessor),
            "only the owner or an approver can propose"
        );
        self.assert_policy(&args);
        let id = self.proposals.len();
        let proposal = Proposal {
            id,
            proposer: predecessor,
            token: args.token,
            to: args.to,
            amount: args.amount,
            kind: args.kind,
            correlation_id: args.correlation_id,
            deadline: args.deadline,
            memo: args.memo,
            approvals: Vec::new(),
            executed: false,
            rejected: false,
            created_at: env::block_timestamp(),
        };
        self.proposals.insert(&id, &proposal);
        self.emit("proposal", &proposal);
        id
    }

    pub fn approve(&mut self, id: u64) -> Promise {
        self.assert_not_paused();
        let predecessor = env::predecessor_account_id();
        assert!(self.approvers.contains(&predecessor), "approver only");
        let mut proposal = self.proposals.get(&id).expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");
        assert!(!proposal.rejected, "proposal rejected");
        if !proposal.approvals.contains(&predecessor) {
            proposal.approvals.push(predecessor);
        }

        if (proposal.approvals.len() as u32) < self.threshold {
            self.proposals.insert(&id, &proposal);
            self.emit("approval", &proposal);
            return Promise::new(env::current_account_id());
        }

        // Policy is re-checked inside the contract at execution time.
        self.assert_policy(&ProposeArgs {
            token: proposal.token.clone(),
            to: proposal.to.clone(),
            amount: proposal.amount,
            kind: proposal.kind,
            correlation_id: proposal.correlation_id.clone(),
            deadline: proposal.deadline,
            memo: proposal.memo.clone(),
        });
        if let Some(deadline) = proposal.deadline {
            assert!(deadline > env::block_timestamp(), "intent deadline passed");
        }
        self.reserve_daily(&proposal.token, proposal.amount.0);
        proposal.executed = true;
        self.proposals.insert(&id, &proposal);
        self.emit("executed", &proposal);

        let args = serde_json::json!({
            "receiver_id": proposal.to,
            "amount": proposal.amount.0.to_string(),
            "memo": proposal.memo,
        });
        Promise::new(proposal.token).function_call(
            "ft_transfer".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(50),
        )
    }

    pub fn reject(&mut self, id: u64) {
        self.assert_not_paused();
        let predecessor = env::predecessor_account_id();
        assert!(
            predecessor == self.owner || self.approvers.contains(&predecessor),
            "owner or approver only"
        );
        let mut proposal = self.proposals.get(&id).expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");
        proposal.rejected = true;
        self.proposals.insert(&id, &proposal);
        self.emit("rejected", &proposal);
    }

    pub fn cancel(&mut self, id: u64) {
        let predecessor = env::predecessor_account_id();
        let mut proposal = self.proposals.get(&id).expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");
        assert!(
            predecessor == proposal.proposer || predecessor == self.owner,
            "proposer or owner only"
        );
        proposal.rejected = true;
        self.proposals.insert(&id, &proposal);
        self.emit("cancelled", &proposal);
    }

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        validate_policy_shape(&policy);
        self.policy = policy;
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "keiz",
                "version": EVENT_VERSION,
                "event": "policy",
                "data": self.policy,
            })
        ));
    }

    pub fn set_approvers(&mut self, approvers: Vec<AccountId>, threshold: u32) {
        self.assert_owner();
        assert!(!approvers.is_empty(), "at least one approver is required");
        assert!(
            threshold > 0 && threshold as usize <= approvers.len(),
            "threshold must be between 1 and the approver count"
        );
        let mut approver_set = UnorderedSet::new(b"a");
        for approver in approvers {
            approver_set.insert(&approver);
        }
        self.approvers = approver_set;
        self.threshold = threshold;
    }

    pub fn set_threshold(&mut self, threshold: u32) {
        self.assert_owner();
        assert!(
            threshold > 0 && threshold as usize <= self.approvers.len() as usize,
            "threshold must be between 1 and the approver count"
        );
        self.threshold = threshold;
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_proposal(&self, id: u64) -> Option<Proposal> {
        self.proposals.get(&id)
    }

    pub fn get_proposals(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Proposal> {
        let start = from_index.unwrap_or(0);
        let count = limit.unwrap_or(50).clamp(1, MAX_PROPOSALS_PER_PAGE);
        let end = self.proposals.len().min(start.saturating_add(count));
        (start..end)
            .filter_map(|id| self.proposals.get(&id))
            .collect()
    }

    pub fn get_daily_spend(&self, token: AccountId) -> DailySpend {
        self.daily.get(&token).unwrap_or(DailySpend { day: 0, spent: 0 })
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_threshold(&self) -> u32 {
        self.threshold
    }

    pub fn get_approvers(&self) -> Vec<AccountId> {
        self.approvers.to_vec()
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    fn assert_policy(&self, args: &ProposeArgs) {
        assert!(self.policy.active, "policy is inactive");
        assert!(args.amount.0 > 0, "amount must be positive");
        assert!(
            self.policy.allowed_assets.contains(&args.token),
            "asset is not allowed"
        );
        assert!(
            args.amount.0 <= self.policy.per_tx_limit.0,
            "amount exceeds the per-transaction limit"
        );
        if !self.policy.allowed_recipients.is_empty() {
            assert!(
                self.policy.allowed_recipients.contains(&args.to),
                "recipient is not allowed"
            );
        }
        match args.kind {
            ProposalKind::Direct => {}
            ProposalKind::IntentsDeposit => {
                assert!(self.policy.intents_enabled, "intents deposits are disabled");
                assert!(
                    args.correlation_id.as_deref().is_some_and(|value| !value.is_empty()),
                    "intents proposal requires a correlation id"
                );
                assert!(args.deadline.is_some(), "intents proposal requires a deadline");
            }
        }
        let current = self.daily.get(&args.token).unwrap_or(DailySpend {
            day: current_day(),
            spent: 0,
        });
        let spent = if current.day == current_day() {
            current.spent
        } else {
            0
        };
        assert!(
            spent.saturating_add(args.amount.0) <= self.policy.daily_limit.0,
            "amount exceeds the daily limit"
        );
    }

    fn reserve_daily(&mut self, token: &AccountId, amount: u128) {
        let day = current_day();
        let current = self.daily.get(token).unwrap_or(DailySpend { day, spent: 0 });
        let spent = if current.day == day { current.spent } else { 0 };
        assert!(
            spent.saturating_add(amount) <= self.policy.daily_limit.0,
            "amount exceeds the daily limit"
        );
        self.daily.insert(
            token,
            &DailySpend {
                day,
                spent: spent.saturating_add(amount),
            },
        );
    }

    fn emit(&self, event: &str, proposal: &Proposal) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "keiz",
                "version": EVENT_VERSION,
                "event": event,
                "data": {
                    "id": proposal.id,
                    "proposer": proposal.proposer,
                    "token": proposal.token,
                    "to": proposal.to,
                    "amount": proposal.amount.0.to_string(),
                    "kind": proposal.kind,
                    "correlationId": proposal.correlation_id,
                    "deadline": proposal.deadline,
                    "approvals": proposal.approvals,
                    "executed": proposal.executed,
                    "rejected": proposal.rejected,
                }
            })
        ));
    }

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "owner only");
    }

    fn assert_not_paused(&self) {
        assert!(!self.paused, "contract is paused");
    }
}

fn current_day() -> u64 {
    env::block_timestamp() / DAY_NS
}

fn validate_policy_shape(policy: &Policy) {
    assert!(policy.per_tx_limit.0 > 0, "per-tx limit must be positive");
    assert!(policy.daily_limit.0 > 0, "daily limit must be positive");
    assert!(
        policy.per_tx_limit.0 <= policy.daily_limit.0,
        "per-tx limit cannot exceed the daily limit"
    );
    assert!(
        !policy.allowed_assets.is_empty(),
        "at least one asset must be allowed"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy {
            per_tx_limit: U128(100),
            daily_limit: U128(250),
            allowed_assets: vec!["usdc.testnet".parse().unwrap()],
            allowed_recipients: vec!["vendor.testnet".parse().unwrap()],
            intents_enabled: true,
            active: true,
        }
    }

    #[test]
    fn validates_policy_shape() {
        validate_policy_shape(&policy());
    }

    #[test]
    #[should_panic(expected = "per-tx limit cannot exceed")]
    fn rejects_per_tx_above_daily() {
        let mut value = policy();
        value.per_tx_limit = U128(300);
        validate_policy_shape(&value);
    }
}
