'use client';

import type { Auth0Client } from '@auth0/auth0-spa-js';
import { api } from './api';
import { base64ToBytes, bytesToBase64, bytesToHex } from './format';
import { chainNetwork } from './network';
import type { Session } from './auth';

/**
 * NEAR Auth (FastAuth) passkey login.
 *
 * The passkey is an Auth0 factor; NEAR keys are MPC-derived. A NEP-413 message
 * is signed through the fast-auth contract, which requires a funded relayer.
 * The backend only relays `sign` calls to the configured fast-auth contract.
 *
 * The installed Browser SDK (1.4.2) predates `requestMessageSignature`, so the
 * Auth0 message-approval + signature-request step is implemented here with the
 * same `nep413` authorization parameter the upstream SDK uses.
 */

const enabledFlag = process.env.NEXT_PUBLIC_PASSKEY_ENABLED === 'true';
const clientId = process.env.NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID ?? '';
const network = (process.env.NEXT_PUBLIC_NEAR_AUTH_NETWORK || chainNetwork) as
  | 'mainnet'
  | 'testnet';
const rpcUrl =
  process.env.NEXT_PUBLIC_NEAR_AUTH_RPC_URL ||
  (network === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');
const fastAuthContractId =
  process.env.NEXT_PUBLIC_NEAR_AUTH_CONTRACT_ID ||
  (network === 'mainnet' ? 'fast-auth.near' : 'fast-auth.testnet');
const mpcContractId =
  process.env.NEXT_PUBLIC_NEAR_AUTH_MPC_CONTRACT_ID ||
  (network === 'mainnet' ? 'v1.signer' : 'v1.signer-prod.testnet');
const AUTH0_DEFAULTS = {
  mainnet: {
    domain: 'login.auth.near.org',
    signingAudience: 'auth0.jwt.fast-auth.near',
  },
  testnet: {
    domain: 'login.testnet.fast-auth.com',
    signingAudience: 'auth0.jwt.fast-auth.testnet',
  },
} as const;
const auth0Defaults = AUTH0_DEFAULTS[network];
const auth0Domain =
  process.env.NEXT_PUBLIC_NEAR_AUTH_DOMAIN || auth0Defaults.domain;
const signingAudience =
  process.env.NEXT_PUBLIC_NEAR_AUTH_SIGNING_AUDIENCE || auth0Defaults.signingAudience;

export const passkeyEnabled = enabledFlag && Boolean(clientId);
export const passkeyNetwork = network;

/** Warm the SDK imports and RPC connection so the Auth0 popup opens in-gesture. */
export async function preloadPasskey(): Promise<void> {
  if (!passkeyEnabled) return;
  await getClient();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientPromise: Promise<any> | null = null;
let auth0Promise: Promise<Auth0Client> | null = null;

async function getClient() {
  if (clientPromise) return clientPromise;
  const promise = (async () => {
    const [{ FastAuthClient }, { JavascriptProvider }, nearApi] = await Promise.all([
      import('@fast-auth-near/browser-sdk'),
      import('@fast-auth-near/javascript-provider'),
      import('near-api-js'),
    ]);

    const provider = new JavascriptProvider({
      network,
      clientId,
      domain: auth0Domain,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { connection } = await (nearApi as any).connect({
      networkId: network,
      nodeUrl: rpcUrl,
    });
    return new FastAuthClient(provider, connection, {
      fastAuthContractId,
      mpcContractId,
    });
  })();
  clientPromise = promise.catch((error) => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

async function getAuth0Client(): Promise<Auth0Client> {
  if (auth0Promise) return auth0Promise;
  const promise = (async () => {
    const { Auth0Client } = await import('@auth0/auth0-spa-js');
    return new Auth0Client({
      domain: auth0Domain,
      clientId,
      authorizationParams: {},
    });
  })();
  auth0Promise = promise.catch((error) => {
    auth0Promise = null;
    throw error;
  });
  return auth0Promise;
}

interface Challenge {
  nonce: string;
  message: string;
  recipient: string;
}

const NEP413_TAG = 2 ** 31 + 413;

/** Exact Borsh encoding of the bytes whose SHA-256 the MPC network signs. */
function encodeSignMessage(params: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}): number[] {
  if (params.nonce.length !== 32) {
    throw new Error(`NEP-413 nonce must be 32 bytes, got ${params.nonce.length}`);
  }
  const out: number[] = [];
  const u32 = (value: number) => {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  };
  const bytes = (value: ArrayLike<number>) => {
    for (let index = 0; index < value.length; index += 1) out.push(value[index]);
  };
  const text = (value: string) => {
    const encoded = new TextEncoder().encode(value);
    u32(encoded.length);
    bytes(encoded);
  };

  u32(NEP413_TAG);
  text(params.message);
  bytes(params.nonce);
  text(params.recipient);
  // No callback URL: NEP-413's Option<String> is 0.
  out.push(0);
  return out;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Auth0 returned an invalid JWT');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function payloadBytes(value: unknown): Uint8Array {
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === 'string') {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return base64ToBytes(padded);
  }
  if (value && typeof value === 'object') {
    return Uint8Array.from(Object.values(value as Record<string, number>));
  }
  throw new Error('Auth0 did not return a NEP-413 signing payload');
}

export async function signInWithPasskey(): Promise<Session> {
  if (!passkeyEnabled) {
    throw new Error('Passkey login is not configured');
  }

  const client = await getClient();
  await client.login();
  const signer = await client.getSigner();

  const publicKey = await signer.getPublicKey('ed25519');
  const keyBytes = publicKey?.data;
  if (!(keyBytes instanceof Uint8Array)) {
    throw new Error('Could not read the passkey public key');
  }
  // New NEAR Auth users sign with an implicit account: hex of the public key.
  const accountId = bytesToHex(keyBytes);

  const challenge = await api<Challenge>('/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ accountId, network }),
  });
  const nonce = base64ToBytes(challenge.nonce);

  // Ask Auth0 to approve the NEP-413 payload. The upstream SDK calls this
  // `requestMessageSignature`; the installed 1.4.2 release does not expose it,
  // so we send the same `nep413` authorization parameter directly.
  const auth0 = await getAuth0Client();
  await auth0.loginWithPopup({
    authorizationParams: {
      audience: signingAudience,
      scope: 'transaction:sign',
      nep413: encodeSignMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce,
      }),
    },
  });

  const token = await auth0.getTokenSilently({
    authorizationParams: { audience: signingAudience },
  });
  if (!token) throw new Error('Auth0 did not return a signing token');
  const claims = decodeJwtPayload(token);
  const signatureRequest = {
    guardId: `jwt#https://${auth0Domain}/`,
    verifyPayload: token,
    signPayload: payloadBytes(claims.fatxn),
    algorithm: 'eddsa' as const,
  };

  const action = await signer.createSignAction(signatureRequest);
  const call = action?.functionCall ?? action;
  if (!call?.methodName || !call?.args) {
    throw new Error('NEAR Auth did not return a sign action');
  }

  const relayed = await api<{ successValue: string }>('/auth/passkey/relay', {
    method: 'POST',
    body: JSON.stringify({
      receiverId: fastAuthContractId,
      methodName: 'sign',
      argsBase64: bytesToBase64(new Uint8Array(call.args)),
      gas: BigInt(call.gas).toString(),
      deposit: BigInt(call.deposit ?? 0n).toString(),
    }),
  });

  const { FastAuthSignature } = await import('@fast-auth-near/browser-sdk');
  const signature = FastAuthSignature.fromBase64(relayed.successValue).recover('ed25519');

  return api<Session>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      accountId,
      publicKey: publicKey.toString(),
      signature: bytesToBase64(new Uint8Array(signature)),
      nonce: challenge.nonce,
      recipient: challenge.recipient,
    }),
  });
}
