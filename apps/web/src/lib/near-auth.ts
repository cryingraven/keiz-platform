'use client';

import type { Auth0Client } from '@auth0/auth0-spa-js';
import { api } from './api';
import { base64ToBytes, bytesToBase64, bytesToHex } from './format';
import { chainNetwork } from './network';
import type { Session } from './auth';

/**
 * NEAR Auth login.
 *
 * A JavascriptProvider runs the Auth0 flow (passkey, Google, Apple, email), the
 * Browser SDK derives the MPC key and builds the on-chain `sign` action, and the
 * API relayer submits it to `fast-auth`. The returned MPC signature is a normal
 * NEP-413 signature, verified by the existing `/auth/verify` endpoint.
 *
 * The docs describe `signer.requestMessageSignature()`, but the latest published
 * SDK (browser-sdk 1.4.2 / javascript-provider 1.4.1) does not ship it yet. We
 * feature-detect it and fall back to the same `nep413` Auth0 authorization
 * parameter the newer SDK sends internally. Remove the fallback (and the direct
 * @auth0/auth0-spa-js dependency) once the published SDK exposes the method.
 */

const enabledFlag = process.env.NEXT_PUBLIC_NEAR_AUTH_ENABLED === 'true';
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
const auth0Domain = process.env.NEXT_PUBLIC_NEAR_AUTH_DOMAIN || auth0Defaults.domain;
const signingAudience =
  process.env.NEXT_PUBLIC_NEAR_AUTH_SIGNING_AUDIENCE || auth0Defaults.signingAudience;

export const nearAuthEnabled = enabledFlag && Boolean(clientId);
export const nearAuthNetwork = network;

/** Warm the SDK imports and RPC connection so the Auth0 popup opens in-gesture. */
export async function preloadNearAuth(): Promise<void> {
  if (!nearAuthEnabled) return;
  await getClient();
}

interface NearAuthClient {
  login: () => Promise<unknown>;
  logout: () => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSigner: () => Promise<any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientPromise: Promise<NearAuthClient & any> | null = null;
let auth0Promise: Promise<Auth0Client> | null = null;

async function getAuth0Client(): Promise<Auth0Client> {
  if (auth0Promise) return auth0Promise;
  const promise = (async () => {
    const { Auth0Client } = await import('@auth0/auth0-spa-js');
    const redirectUri =
      typeof window === 'undefined' ? undefined : window.location.origin;
    return new Auth0Client({
      domain: auth0Domain,
      clientId,
      // Auth0 normally uses a hidden iframe for silent auth, which fails in
      // cross-origin-isolated contexts and when third-party cookies are blocked.
      // Refresh tokens avoid the iframe entirely (memory + worker by default).
      useRefreshTokens: true,
      useRefreshTokensFallback: true,
      cacheLocation: 'memory',
      authorizationParams: redirectUri ? { redirect_uri: redirectUri } : {},
    });
  })();
  auth0Promise = promise.catch((error) => {
    auth0Promise = null;
    throw error;
  });
  return auth0Promise;
}

async function getClient() {
  if (clientPromise) return clientPromise;
  const promise = (async () => {
    const [{ FastAuthClient }, { JavascriptProvider }, nearApi, auth0] = await Promise.all([
      import('@fast-auth-near/browser-sdk'),
      import('@fast-auth-near/javascript-provider'),
      import('near-api-js'),
      getAuth0Client(),
    ]);

    const provider = new JavascriptProvider({ network, clientId, domain: auth0Domain });
    // The published provider creates its own Auth0Client with default options,
    // so its getSignatureRequest() would still use the iframe path. Inject the
    // configured refresh-token client before the provider is used.
    (provider as unknown as { client: Auth0Client }).client = auth0;
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

interface Challenge {
  nonce: string;
  message: string;
  recipient: string;
}

interface SignatureRequest {
  guardId: string;
  verifyPayload: string;
  signPayload: Uint8Array;
  algorithm?: 'secp256k1' | 'eddsa' | 'ecdsa';
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

/**
 * Official path from the docs. Returns null when the installed SDK predates
 * `requestMessageSignature`, so the caller can use the Auth0 fallback.
 */
async function requestMessageWithSdk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any,
  challenge: Challenge,
): Promise<SignatureRequest | null> {
  if (typeof signer?.requestMessageSignature !== 'function') return null;
  await signer.requestMessageSignature({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: base64ToBytes(challenge.nonce),
  });
  const { signatureRequest } = await signer.getSignatureRequest();
  return signatureRequest as SignatureRequest;
}

async function requestMessageWithAuth0(challenge: Challenge): Promise<SignatureRequest> {
  const auth0 = await getAuth0Client();
  await auth0.loginWithPopup({
    authorizationParams: {
      audience: signingAudience,
      scope: 'transaction:sign',
      nep413: encodeSignMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
      }),
    },
  });

  const token = await auth0.getTokenSilently({
    authorizationParams: { audience: signingAudience },
  });
  if (!token) throw new Error('Auth0 did not return a signing token');
  const claims = decodeJwtPayload(token);
  return {
    guardId: `jwt#https://${auth0Domain}/`,
    verifyPayload: token,
    signPayload: payloadBytes(claims.fatxn),
    algorithm: 'eddsa',
  };
}

function friendlyNearAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/cross[- ]origin|opener|isolated|\bcors\b/i.test(message)) {
    return (
      'NEAR Auth could not complete the cross-origin sign-in. Open KEIZ in a top-level tab, ' +
      'allow popups for this site, and make sure this origin is allowed in the NEAR Auth Auth0 client. ' +
      'Then retry.'
    );
  }
  if (/popup|blocked|window/i.test(message)) {
    return 'The sign-in popup was blocked. Allow popups for this site and try again.';
  }
  if (/cancel|closed|denied|dismiss|abort/i.test(message)) {
    return 'NEAR Auth sign-in was cancelled.';
  }
  return message || 'NEAR Auth sign-in failed.';
}

export async function signInWithNearAuth(): Promise<Session> {
  if (!nearAuthEnabled) {
    throw new Error('NEAR Auth is not configured');
  }

  try {
    const client = await getClient();
    await client.login();
    const signer = await client.getSigner();

    const publicKey = await signer.getPublicKey('ed25519');
    const keyBytes = publicKey?.data;
    if (!(keyBytes instanceof Uint8Array)) {
      throw new Error('Could not read the NEAR Auth public key');
    }
    // New NEAR Auth users sign with an implicit account: hex of the public key.
    const accountId = bytesToHex(keyBytes);

    const challenge = await api<Challenge>('/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ accountId, network }),
    });

    const signatureRequest =
      (await requestMessageWithSdk(signer, challenge)) ??
      (await requestMessageWithAuth0(challenge));

    // MPC signing costs a 1 yoctoNEAR deposit on the sign call.
    const action = await signer.createSignAction(signatureRequest, {
      gas: 300_000_000_000_000n,
      deposit: 1n,
    });
    const call = action?.functionCall ?? action;
    if (!call?.methodName || !call?.args) {
      throw new Error('NEAR Auth did not return a sign action');
    }

    const relayed = await api<{ successValue: string }>('/auth/near-auth/relay', {
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
  } catch (error) {
    throw new Error(friendlyNearAuthError(error));
  }
}

/** Clears the Auth0 session when the user signs out of KEIZ. */
export async function signOutNearAuth(): Promise<void> {
  if (!nearAuthEnabled || !clientPromise) return;
  try {
    const client = await clientPromise;
    await client.logout();
  } catch {
    // A failed Auth0 logout must not keep the local UI signed in.
  }
}
