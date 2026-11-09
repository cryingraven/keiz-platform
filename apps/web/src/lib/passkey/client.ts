'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { PRF_SALT } from './constants';
import { prfOutputFromResults } from './crypto';
import { bytesToBase64 } from '../format';

export interface PasskeyCredentialJson {
  id: string;
  rawId: string;
  type: 'public-key';
  response: Record<string, unknown>;
  authenticatorAttachment?: string;
}

export interface CreatedPasskey {
  credential: PasskeyCredentialJson;
  credentialId: string;
  prfOutput: Uint8Array;
}

/**
 * Inject the PRF extension into the server's options. SimpleWebAuthn spreads
 * optionsJSON into navigator.credentials.*, so a Uint8Array salt survives.
 */
function withPrf<T extends Record<string, unknown>>(options: T): T {
  return {
    ...options,
    extensions: {
      ...((options.extensions as Record<string, unknown> | undefined) ?? {}),
      prf: { eval: { first: PRF_SALT } },
    },
  } as T;
}

/**
 * Strip the PRF output before the credential JSON leaves the browser. If the
 * API received it, it could derive the wrapping key and decrypt the seed.
 */
function stripPrf<T extends { clientExtensionResults?: unknown }>(credential: T): PasskeyCredentialJson {
  const { id, rawId, type, response, authenticatorAttachment } = credential as unknown as PasskeyCredentialJson & {
    clientExtensionResults?: unknown;
  };
  return {
    id,
    rawId,
    type,
    response,
    ...(authenticatorAttachment ? { authenticatorAttachment } : {}),
  };
}

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator?.credentials?.create === 'function'
  );
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Best-effort PRF capability check. `getClientCapabilities` is not available
 * everywhere; when it is missing we only know after a real ceremony.
 */
export function prfLikelySupported(): boolean {
  if (!passkeysSupported()) return false;
  const capabilities = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<{ prf?: boolean }>;
    }
  ).getClientCapabilities;
  if (typeof capabilities !== 'function') return true;
  // getClientCapabilities is async; callers may use the synchronous fallback.
  return true;
}

export async function prfSupported(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const capabilities = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<{ prf?: boolean }>;
    }
  ).getClientCapabilities;
  if (typeof capabilities !== 'function') return true;
  try {
    const result = await capabilities.call(PublicKeyCredential);
    return result?.prf !== false;
  } catch {
    return true;
  }
}

/** Some authenticators return PRF only on assertion, not on creation. */
async function prfFromAssertion(credentialId: string): Promise<Uint8Array | null> {
  const challenge = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const assertion = await startAuthentication({
    optionsJSON: withPrf({
      challenge,
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
    }) as never,
  });
  return prfOutputFromResults(assertion.clientExtensionResults);
}

export async function createPasskey(optionsJSON: Record<string, unknown>): Promise<CreatedPasskey> {
  const credential = await startRegistration({
    optionsJSON: withPrf(optionsJSON) as never,
  });
  const prfOutput =
    prfOutputFromResults(credential.clientExtensionResults) ??
    (await prfFromAssertion(credential.id).catch(() => null));
  if (!prfOutput) {
    throw new Error(
      'This authenticator did not return a PRF secret, so it cannot protect a NEAR key. ' +
        'Try Face ID/Touch ID/Windows Hello or a passkey that supports PRF.',
    );
  }
  return {
    credential: stripPrf(credential),
    credentialId: credential.id,
    prfOutput,
  };
}

export async function assertPasskey(
  optionsJSON: Record<string, unknown>,
): Promise<{ credential: PasskeyCredentialJson; prfOutput: Uint8Array | null }> {
  const credential = await startAuthentication({
    optionsJSON: withPrf(optionsJSON) as never,
  });
  return {
    credential: stripPrf(credential),
    prfOutput: prfOutputFromResults(credential.clientExtensionResults),
  };
}
