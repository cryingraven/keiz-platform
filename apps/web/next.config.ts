import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Next only loads .env files from apps/web, and @next/env no-ops here because
// Next has already marked env as processed. Parse the repo-root file directly
// so a single shared .env keeps the API and the client in sync.
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

function parseEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

const repoRoot = findRepoRoot(process.cwd());
const fileEnv = {
  ...parseEnvFile(path.join(repoRoot, '.env')),
  ...parseEnvFile(path.join(repoRoot, '.env.local')),
};
const readEnv = (key: string): string | undefined => process.env[key] ?? fileEnv[key];

const apiUrl = readEnv('API_URL') || 'http://localhost:3001';
const configuredNetwork =
  readEnv('CHAIN_NETWORK') ??
  readEnv('NEXT_PUBLIC_CHAIN_NETWORK') ??
  readEnv('NEXT_PUBLIC_NEAR_NETWORK');
const chainNetwork = configuredNetwork === 'mainnet' ? 'mainnet' : 'testnet';

const nextConfig: NextConfig = {
  // Explicitly inline public env. Turbopack computes NEXT_PUBLIC_* before
  // next.config runs, so values loaded from the repo root need to be declared.
  env: {
    NEXT_PUBLIC_NEAR_AUTH_ENABLED: readEnv('NEXT_PUBLIC_NEAR_AUTH_ENABLED') || 'false',
    // NEAR Auth network-specific values are intentionally not defaulted here:
    // near-auth.ts derives them from NEXT_PUBLIC_CHAIN_NETWORK unless overridden.
    NEXT_PUBLIC_NEAR_AUTH_NETWORK: readEnv('NEXT_PUBLIC_NEAR_AUTH_NETWORK') || '',
    NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID: readEnv('NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID') || '',
    NEXT_PUBLIC_NEAR_AUTH_CONTRACT_ID: readEnv('NEXT_PUBLIC_NEAR_AUTH_CONTRACT_ID') || '',
    NEXT_PUBLIC_NEAR_AUTH_MPC_CONTRACT_ID:
      readEnv('NEXT_PUBLIC_NEAR_AUTH_MPC_CONTRACT_ID') || '',
    NEXT_PUBLIC_NEAR_AUTH_RPC_URL: readEnv('NEXT_PUBLIC_NEAR_AUTH_RPC_URL') || '',
    NEXT_PUBLIC_NEAR_AUTH_DOMAIN: readEnv('NEXT_PUBLIC_NEAR_AUTH_DOMAIN') || '',
    NEXT_PUBLIC_NEAR_AUTH_SIGNING_AUDIENCE:
      readEnv('NEXT_PUBLIC_NEAR_AUTH_SIGNING_AUDIENCE') || '',
    NEXT_PUBLIC_CHAIN_NETWORK: chainNetwork,
    NEXT_PUBLIC_NEAR_NETWORK: readEnv('NEXT_PUBLIC_NEAR_NETWORK') || chainNetwork,
  },
  // The API is proxied through Next so the httpOnly session cookie is same-origin.
  // Do not call the Nest port directly from the browser.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // The NEAR Auth / Auth0 flow needs the opener relationship while the
          // popup is open. `same-origin-allow-popups` still isolates the popup in
          // some browsers; `unsafe-none` keeps the standard popup postMessage flow
          // working. Do not add Cross-Origin-Embedder-Policy here.
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
    ];
  },
};

export default nextConfig;
