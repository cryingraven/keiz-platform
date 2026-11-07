'use client';

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

export const passkeyEnabled = enabledFlag && Boolean(clientId);
export const passkeyNetwork = network;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientPromise: Promise<any> | null = null;

async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const [{ FastAuthClient }, { JavascriptProvider }, nearApi] = await Promise.all([
      import('@fast-auth-near/browser-sdk'),
      import('@fast-auth-near/javascript-provider'),
      import('near-api-js'),
    ]);

    const provider = new JavascriptProvider({ network, clientId });
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
  return clientPromise;
}

interface Challenge {
  nonce: string;
  message: string;
  recipient: string;
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

  await signer.requestMessageSignature({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: base64ToBytes(challenge.nonce),
  });

  const { signatureRequest } = await signer.getSignatureRequest();
  const action = await signer.createSignAction(signatureRequest, {
    gas: 300000000000000n,
    deposit: 0n,
  });
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
