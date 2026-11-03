import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Agent private keys are encrypted at rest with AES-256-GCM.
 * The key material is never returned by the API and never logged.
 */
export function deriveMasterKey(raw?: string, fallbackSecret?: string): Buffer {
  if (!raw && process.env.NODE_ENV === 'production') {
    throw new Error('AGENT_WALLET_MASTER_KEY is required in production');
  }
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32) return base64;
    return scryptSync(raw, 'keiz-agent-wallet', 32);
  }
  if (fallbackSecret) {
    // Dev convenience only: production must set AGENT_WALLET_MASTER_KEY explicitly.
    return scryptSync(fallbackSecret, 'keiz-agent-wallet-dev', 32);
  }
  throw new Error('AGENT_WALLET_MASTER_KEY is required');
}

export function encryptSecret(secret: Uint8Array, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload: string, key: Buffer): Buffer {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unsupported encrypted secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
}
