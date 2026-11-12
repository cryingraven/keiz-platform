import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntentsPaymentProvider } from './intents.provider';

function provider() {
  return new IntentsPaymentProvider({
    baseUrl: 'https://1click.test',
    referral: 'keiz',
  });
}

const params = {
  dry: true,
  swapType: 'EXACT_OUTPUT' as const,
  originAsset: 'nep141:usdc.near',
  destinationAsset: 'nep141:usdc.eth',
  amount: '1000000',
  recipient: '0xabc',
  refundTo: 'alice.near',
  customRecipientMsg: '{"receivableRef":"AR-1"}',
};

function response(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IntentsPaymentProvider.quote', () => {
  it('sends the routing types and a deadline required by 1Click', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      response({
        correlationId: 'corr-1',
        quoteRequest: { deadline: '2026-11-12T10:20:00.000Z' },
        quote: {
          amountIn: '1000000',
          amountInFormatted: '1.0',
          amountOut: '1000000',
          amountOutFormatted: '1.0',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().quote(params);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, string>;

    expect(body.depositType).toBe('ORIGIN_CHAIN');
    expect(body.refundType).toBe('ORIGIN_CHAIN');
    expect(body.recipientType).toBe('DESTINATION_CHAIN');
    expect(body.customRecipientMsg).toBe(params.customRecipientMsg);
    expect(body.deadline).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The live API omits quote.deadline; the request echo must be used.
    expect(result.deadline).toBe('2026-11-12T10:20:00.000Z');
  });

  it('honours an explicit deadline and quote.deadline when present', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      response({
        correlationId: 'corr-2',
        quote: {
          amountIn: '1',
          amountInFormatted: '0.000001',
          amountOut: '1',
          amountOutFormatted: '0.000001',
          deadline: '2026-11-12T11:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().quote({
      ...params,
      customRecipientMsg: undefined,
      deadline: '2026-11-12T10:30:00.000Z',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, string>;

    expect(body.deadline).toBe('2026-11-12T10:30:00.000Z');
    expect(body.customRecipientMsg).toBeUndefined();
    expect(result.deadline).toBe('2026-11-12T11:00:00.000Z');
  });
});
