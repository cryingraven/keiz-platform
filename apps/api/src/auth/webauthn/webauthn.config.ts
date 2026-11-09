import type { ConfigService } from '@nestjs/config';

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

/**
 * WebAuthn relying-party configuration.
 *
 * `WEBAUTHN_RP_ID` is the registrable domain (no scheme, no port). The browser
 * binds every passkey to it, so changing it invalidates existing credentials.
 * `WEBAUTHN_ORIGINS` is the exact, comma-separated origin allowlist.
 */
export function webauthnConfig(config: ConfigService): WebAuthnConfig {
  const rpId =
    config.get<string>('WEBAUTHN_RP_ID') ||
    config.get<string>('APP_DOMAIN') ||
    'localhost';
  const origins = (
    config.get<string>('WEBAUTHN_ORIGINS') ||
    config.get<string>('WEB_ORIGIN') ||
    'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, ''));
  const rpName = config.get<string>('WEBAUTHN_RP_NAME') || 'KEIZ';
  return { rpId, rpName, origins };
}

/** Fail closed on configurations that browsers will silently reject. */
export function auditWebAuthnConfig(config: ConfigService): WebAuthnConfig {
  const value = webauthnConfig(config);
  const production = (config.get<string>('NODE_ENV') || 'development') === 'production';
  if (value.origins.length === 0) {
    throw new Error('[webauthn] WEBAUTHN_ORIGINS must contain at least one origin.');
  }
  for (const origin of value.origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`[webauthn] WEBAUTHN_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (production && parsed.protocol !== 'https:') {
      throw new Error(`[webauthn] Origin ${origin} must use HTTPS in production.`);
    }
    const hostname = parsed.hostname;
    const matches = hostname === value.rpId || hostname.endsWith(`.${value.rpId}`);
    if (!matches) {
      throw new Error(
        `[webauthn] Origin ${origin} is not the RP ID (${value.rpId}) or a subdomain of it.`,
      );
    }
  }
  if (production && (value.rpId === 'localhost' || !value.rpId.includes('.'))) {
    throw new Error('[webauthn] WEBAUTHN_RP_ID must be the public registrable domain.');
  }
  return value;
}
