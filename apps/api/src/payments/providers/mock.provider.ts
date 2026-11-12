import { randomBytes } from 'node:crypto';
import { PaymentStatus, formatUnits, parseUnits } from '@keiz/shared';
import { PaymentProvider, QuoteParams, QuoteResult, StatusResult, TokenInfo } from './provider';

const TOKENS: TokenInfo[] = [
  { assetId: 'nep141:usdc.near', symbol: 'USDC', blockchain: 'near', decimals: 6, price: '1.00' },
  { assetId: 'nep141:usdt.near', symbol: 'USDT', blockchain: 'near', decimals: 6, price: '1.00' },
  { assetId: 'nep141:wrap.near', symbol: 'wNEAR', blockchain: 'near', decimals: 24, price: '3.20' },
  { assetId: 'nep141:usdc.eth', symbol: 'USDC', blockchain: 'eth', decimals: 6, price: '1.00' },
  { assetId: 'nep141:usdt.eth', symbol: 'USDT', blockchain: 'eth', decimals: 6, price: '1.00' },
  { assetId: 'nep141:usdc.sol', symbol: 'USDC', blockchain: 'sol', decimals: 6, price: '1.00' },
  { assetId: 'nep141:usdt.sol', symbol: 'USDT', blockchain: 'sol', decimals: 6, price: '1.00' },
  { assetId: 'nep141:usdc.base', symbol: 'USDC', blockchain: 'base', decimals: 6, price: '1.00' },
  { assetId: 'nep141:usdt.base', symbol: 'USDT', blockchain: 'base', decimals: 6, price: '1.00' },
];

/** Deterministic in-memory provider so dev, tests and CI never touch mainnet. */
export class MockPaymentProvider implements PaymentProvider {
  readonly mode = 'mock' as const;
  private readonly deposits = new Map<string, number>();
  private readonly forced = new Map<string, PaymentStatus>();

  async getTokens(): Promise<TokenInfo[]> {
    return TOKENS;
  }

  async quote(params: QuoteParams): Promise<QuoteResult> {
    const origin = this.token(params.originAsset);
    const destination = this.token(params.destinationAsset);
    const amount = BigInt(params.amount);

    let amountIn: bigint;
    let amountOut: bigint;
    if (params.swapType === 'EXACT_OUTPUT') {
      amountOut = amount;
      amountIn = this.convert(amountOut, destination, origin);
    } else {
      amountIn = amount;
      amountOut = this.convert(amountIn, origin, destination);
    }

    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const depositAddress = params.dry
      ? undefined
      : `mock-${randomBytes(8).toString('hex')}`;

    return {
      correlationId: `mock-${randomBytes(6).toString('hex')}`,
      depositAddress,
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn, origin.decimals),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatUnits(amountOut, destination.decimals),
      minAmountOut: amountOut.toString(),
      deadline,
      timeEstimate: 8,
      raw: { mode: 'mock', params },
    };
  }

  async submitDeposit(params: { depositAddress: string; txHash: string }): Promise<void> {
    if (!this.deposits.has(params.depositAddress)) {
      this.deposits.set(params.depositAddress, Date.now());
    }
  }

  async getStatus(depositAddress: string): Promise<StatusResult> {
    const forced = this.forced.get(depositAddress);
    if (forced) return { status: forced, rawStatus: `MOCK_${forced}`, raw: { forced: true } };

    const submittedAt = this.deposits.get(depositAddress);
    if (!submittedAt) {
      return { status: 'AWAITING_DEPOSIT', rawStatus: 'PENDING_DEPOSIT', raw: {} };
    }
    const elapsed = Date.now() - submittedAt;
    const status: PaymentStatus = elapsed < 3000 ? 'PROCESSING' : 'SUCCEEDED';
    return {
      status,
      rawStatus: status === 'PROCESSING' ? 'PROCESSING' : 'SUCCESS',
      swapDetails: {
        originTxHashes: [{ hash: `mock:${depositAddress}` }],
        destinationTxHashes: [
          { hash: `mock-dest:${depositAddress}`, explorerUrl: 'https://nearblocks.io' },
        ],
      },
      raw: { elapsed },
    };
  }

  /** Demo/test hook: force a terminal state without waiting. */
  forceStatus(depositAddress: string, status: PaymentStatus) {
    this.forced.set(depositAddress, status);
    if (!this.deposits.has(depositAddress)) this.deposits.set(depositAddress, Date.now());
  }

  private token(assetId: string): TokenInfo {
    const token = TOKENS.find((t) => t.assetId === assetId);
    if (!token) throw new Error(`Mock provider has no token ${assetId}`);
    return token;
  }

  private convert(amount: bigint, from: TokenInfo, to: TokenInfo): bigint {
    const fromPrice = parseUnits(from.price ?? '1', 6);
    const toPrice = parseUnits(to.price ?? '1', 6);
    return (amount * fromPrice * 10n ** BigInt(to.decimals)) / (toPrice * 10n ** BigInt(from.decimals));
  }
}
