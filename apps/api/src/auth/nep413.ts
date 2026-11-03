import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/**
 * NEP-413 signed-message verification.
 * Serialization is Borsh: u32 tag (2^31 + 413) || string message || [u8;32] nonce
 * || string recipient || Option<string> callback_url, then sha256, then ed25519 verify.
 */
export const NEP413_TAG = 2 ** 31 + 413; // 2147484061

export interface Nep413Payload {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

export function serializeNep413(payload: Nep413Payload): Buffer {
  if (payload.nonce.length !== 32) {
    throw new Error('NEP-413 nonce must be exactly 32 bytes');
  }
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG, 0);
  const parts = [
    tag,
    borshString(payload.message),
    Buffer.from(payload.nonce),
    borshString(payload.recipient),
  ];
  if (payload.callbackUrl) {
    parts.push(Buffer.from([1]), borshString(payload.callbackUrl));
  } else {
    parts.push(Buffer.from([0]));
  }
  return Buffer.concat(parts);
}

export function nep413MessageHash(payload: Nep413Payload): Buffer {
  return createHash('sha256').update(serializeNep413(payload)).digest();
}

function normalizeBase64(value: string): Buffer {
  const clean = value.replace(/^ed25519:/, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function decodePublicKey(publicKey: string): Buffer {
  const raw = publicKey.replace(/^ed25519:/, '');
  const bytes = bs58.decode(raw);
  if (bytes.length !== 32) throw new Error('Expected a 32-byte ed25519 public key');
  return Buffer.from(bytes);
}

export function decodeSignature(signature: string): Buffer {
  // Wallets return base64; some return base58. Try base64 first, then base58.
  const fromBase64 = normalizeBase64(signature);
  if (fromBase64.length === 64) return fromBase64;
  try {
    const fromBase58 = Buffer.from(bs58.decode(signature.replace(/^ed25519:/, '')));
    if (fromBase58.length === 64) return fromBase58;
  } catch {
    /* fall through */
  }
  throw new Error('Expected a 64-byte ed25519 signature');
}

export function verifyNep413(payload: Nep413Payload, publicKey: string, signature: string): boolean {
  const hash = nep413MessageHash(payload);
  return nacl.sign.detached.verify(hash, decodeSignature(signature), decodePublicKey(publicKey));
}

/** Builds a NEP-413 signature with a raw secret key. Test/demo helper only. */
export function signNep413WithSecret(
  payload: Nep413Payload,
  secretKey: Uint8Array,
): { signature: string; publicKey: string } {
  const hash = nep413MessageHash(payload);
  const signature = nacl.sign.detached(hash, secretKey);
  const publicKey = nacl.sign.keyPair.fromSecretKey(secretKey).publicKey;
  return {
    signature: Buffer.from(signature).toString('base64'),
    publicKey: `ed25519:${bs58.encode(Buffer.from(publicKey))}`,
  };
}
