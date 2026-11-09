import http from 'node:http';

/**
 * Minimal OutLayer custody API used by the smoke test.
 * Mirrors the endpoints the SDK calls; no funds, no TEE.
 */
export async function startMockOutlayer(port: number) {
  const accountId = 'a'.repeat(64);
  const publicKey = 'ed25519:mock-public-key';
  let polls = 0;

  const json = (res: http.ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (req.method === 'POST' && path === '/register') {
      return json(res, {
        wallet_id: 'wallet-mock-1',
        api_key: 'wk_mock_custody_key',
        near_account_id: accountId,
        handoff_url: 'https://app.outlayer.ai/wallet?key=wk_mock_custody_key',
      });
    }

    if (req.method === 'GET' && path === '/wallet/v1/address') {
      return json(res, {
        wallet_id: 'wallet-mock-1',
        chain: 'near',
        address: accountId,
        public_key: publicKey,
      });
    }

    if (req.method === 'GET' && path === '/wallet/v1/balance') {
      const token = url.searchParams.get('token');
      const source = url.searchParams.get('source');
      return json(res, {
        balance: token && source === 'intents' ? '500000000' : '1000000000000000000000000',
        token: token ?? 'near',
        account_id: accountId,
      });
    }

    if (req.method === 'GET' && path === '/wallet/v1/policy') {
      return json(res, {
        wallet_id: 'wallet-mock-1',
        controller: publicKey,
        frozen: false,
        policy: 'configured',
        rules: { per_tx_limit: '10000000000', daily_limit: '50000000000' },
        usage: {},
      });
    }

    if (req.method === 'GET' && path === '/wallet/v1/tokens') {
      return json(res, {
        tokens: [
          {
            id: 'usdc.near',
            symbol: 'USDC',
            decimals: 6,
            chains: ['near', 'ethereum', 'base', 'solana'],
            defuse_asset_id: 'nep141:usdc.near',
          },
        ],
      });
    }

    if (req.method === 'POST' && path === '/wallet/v1/intents/withdraw/dry-run') {
      return json(res, {
        would_succeed: true,
        estimated_fee: '0',
        fee_token: 'near',
        policy_check: { decision: 'allowed' },
      });
    }

    if (req.method === 'POST' && path === '/wallet/v1/intents/withdraw') {
      return json(res, { request_id: 'req-mock-1', status: 'processing' });
    }

    if (req.method === 'GET' && path.startsWith('/wallet/v1/requests/')) {
      polls += 1;
      if (polls === 1) {
        return json(res, {
          request_id: 'req-mock-1',
          status: 'processing',
          created_at: new Date().toISOString(),
        });
      }
      return json(res, {
        request_id: 'req-mock-1',
        status: 'success',
        result: { intent_hash: 'mock-intent-hash', delivered: 'nep141:usdc.near' },
        created_at: new Date().toISOString(),
      });
    }

    return json(res, { error: 'not_found', path }, 404);
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    polls: () => polls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
