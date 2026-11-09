'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import { base64ToBytes, bytesToBase64 } from './format';
import { chainNetwork } from './network';
import {
  assertPasskey,
  createPasskey,
  deriveNearKey,
  decodeRecoveryKey,
  passkeysSupported,
  prfSupported,
  signNep413,
  unwrapSeed,
  wrapSeed,
  randomSeed,
  type PasskeyTransaction,
  type WrappedSeed,
} from './passkey';

export type AuthMethod = 'wallet' | 'passkey' | 'recovery';

export interface Session {
  user: { id: string; accountId: string; displayName: string | null } | null;
  org: { id: string; name: string; slug: string } | null;
  role: string | null;
  authMethod?: AuthMethod | null;
}

export interface WalletAccount {
  accountId: string;
  publicKey?: string;
}

export interface WalletOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  website: string;
  type: 'sandbox' | 'injected';
}

export interface PasskeySummary {
  id: string;
  credentialId: string;
  accountId: string;
  nearPublicKey: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string | null;
}

interface UnlockResponse {
  credentialId: string;
  accountId: string;
  nearPublicKey: string;
  wrappedSeed: WrappedSeed;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  busy: boolean;
  passkeyBusy: boolean;
  passkeySupported: boolean;
  passkeyReady: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  createPasskeyAccount: () => Promise<void>;
  signInWithRecoveryKey: (recoveryKey: string, accountId?: string) => Promise<void>;
  addPasskey: () => Promise<void>;
  removePasskey: (id: string, confirmRecovery?: boolean) => Promise<void>;
  listPasskeys: () => Promise<PasskeySummary[]>;
  exportRecoveryKey: () => Promise<string>;
  unlockSeed: () => Promise<Uint8Array>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  sendTransactions: (transactions: PasskeyTransaction[]) => Promise<Array<{ hash: string }>>;
  preloadWallets: () => Promise<void>;
  wallets: WalletOption[];
  walletsLoading: boolean;
  activeWalletId: string | null;
  signInWithWallet: (walletId: string) => Promise<void>;
  accounts: WalletAccount[];
  chooseAccount: (accountId: string) => Promise<void>;
  cancelAccountSelection: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type WalletLike = {
  getAccounts: () => Promise<Array<{ accountId: string }>>;
  signMessage: (payload: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    signerId?: string;
  }) => Promise<{ signature: string; publicKey: string }>;
  signAndSendTransactions: (payload: {
    transactions: unknown[];
  }) => Promise<Array<{ transaction?: { hash?: string } }>>;
};

function friendlyWalletError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/reject|cancel|denied|closed|dismiss|abort/i.test(message)) {
    return 'Wallet sign-in was cancelled.';
  }
  if (/not installed|not found|unavailable/i.test(message)) {
    return 'That wallet is not available in this browser.';
  }
  return message || 'Wallet sign-in failed.';
}

function friendlyPasskeyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/prf|secret/i.test(message)) return message;
  if (/notallowed|not allowed|cancel|denied|dismiss|abort/i.test(message)) {
    return 'Passkey sign-in was cancelled.';
  }
  if (/security|not supported|unsupported/i.test(message)) {
    return 'This browser or device does not support the passkey features KEIZ needs. Use a NEAR wallet instead.';
  }
  return message || 'Passkey sign-in failed.';
}

function hexToBytes(value: string): Uint8Array {
  const pairs = value.match(/.{1,2}/g) ?? [];
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}

/** Wallets return signatures as base64, base58, hex, Uint8Array or arrays. */
function normalizeSignature(value: unknown): string {
  if (typeof value === 'string') {
    return /^[0-9a-f]{128}$/i.test(value) ? bytesToBase64(hexToBytes(value)) : value;
  }
  if (value instanceof Uint8Array) return bytesToBase64(value);
  if (Array.isArray(value)) return bytesToBase64(Uint8Array.from(value as number[]));
  if (value && typeof value === 'object' && 'data' in value) {
    return normalizeSignature((value as { data: unknown }).data);
  }
  throw new Error('Wallet returned an unsupported signature format');
}

function normalizePublicKey(value: unknown): string {
  if (typeof value === 'string') return value;
  const text = String(value ?? '');
  if (text && text !== '[object Object]') return text;
  throw new Error('Wallet returned an unsupported public key format');
}

function localAssertionOptions() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  return {
    challenge: bytesToBase64(challenge).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    timeout: 60_000,
    userVerification: 'required',
    allowCredentials: [],
  };
}

export function NearAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectorPromiseRef = useRef<Promise<any> | null>(null);
  const walletRef = useRef<WalletLike | null>(null);
  const seedRef = useRef<Uint8Array | null>(null);
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);

  useEffect(() => {
    setPasskeySupported(passkeysSupported());
    void prfSupported().then(setPasskeyReady);
  }, []);

  const publishWallets = useCallback(() => {
    const connector = connectorRef.current;
    if (!connector) {
      setWallets([]);
      return;
    }
    const list: WalletOption[] = (connector.availableWallets ?? []).map(
      (wallet: { manifest: WalletOption }) => ({
        id: wallet.manifest.id,
        name: wallet.manifest.name,
        description: wallet.manifest.description,
        icon: wallet.manifest.icon,
        website: wallet.manifest.website,
        type: wallet.manifest.type,
      }),
    );
    setWallets(Array.from(new Map(list.map((wallet) => [wallet.id, wallet])).values()));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Session>('/auth/me');
      setSession(data);
      if (data.authMethod === 'wallet') seedRef.current = null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      seedRef.current = null;
      setSession(null);
    };
    window.addEventListener('keiz:unauthorized', onUnauthorized);
    return () => window.removeEventListener('keiz:unauthorized', onUnauthorized);
  }, [refresh]);

  /**
   * Load near-connect lazily, on the first wallet action. Dashboard pages
   * never import it.
   */
  const ensureConnector = useCallback(async () => {
    if (connectorRef.current) return connectorRef.current;
    if (!connectorPromiseRef.current) {
      connectorPromiseRef.current = (async () => {
        try {
          const { NearConnector } = await import('@hot-labs/near-connect');
          const connector = new NearConnector({
            network: chainNetwork,
            features: { signMessage: true },
            autoConnect: false,
            footerBranding: null,
          });
          connector.on?.('wallet:signOut', () => {
            walletRef.current = null;
          });
          connector.on?.('selector:walletsChanged', () => publishWallets());
          connector.on?.('selector:manifestUpdated', () => publishWallets());
          connectorRef.current = connector;
          return connector;
        } catch {
          return null;
        }
      })();
    }
    return connectorPromiseRef.current;
  }, [publishWallets]);

  const loadWallets = useCallback(async () => {
    setWalletsLoading(true);
    try {
      const connector = await ensureConnector();
      if (!connector) {
        setWallets([]);
        return;
      }
      await connector.whenManifestLoaded?.catch?.(() => undefined);
      publishWallets();
      if ((connector.availableWallets?.length ?? 0) === 0) {
        // The manifest registers sandbox wallets asynchronously after the
        // manifest promise resolves. Wait briefly for the first change event.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1500);
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          if (typeof connector.once === 'function') {
            connector.once('selector:walletsChanged', done);
          } else {
            setTimeout(done, 0);
          }
        });
        publishWallets();
      }
    } finally {
      setWalletsLoading(false);
    }
  }, [ensureConnector, publishWallets]);

  const completeSignIn = useCallback(
    async (wallet: WalletLike, accountId: string) => {
      const challenge = await api<{
        nonce: string;
        message: string;
        recipient: string;
      }>('/auth/challenge', {
        method: 'POST',
        body: JSON.stringify({ accountId, network: chainNetwork }),
      });

      const signed = await wallet.signMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
        signerId: accountId,
      });

      // Wallets disagree: base64, base58, hex, Uint8Array or a { data } wrapper.
      const signature = normalizeSignature(signed.signature);
      const publicKey = normalizePublicKey(signed.publicKey);

      const nextSession = await api<Session>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          accountId,
          publicKey,
          signature,
          nonce: challenge.nonce,
          recipient: challenge.recipient,
        }),
      });
      seedRef.current = null;
      setSession(nextSession);
      setAccounts([]);
    },
    [],
  );

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    setAccounts([]);
    try {
      const connector = await ensureConnector();
      if (!connector) throw new Error('Wallet connector is unavailable');
      const wallet = (await connector.connect()) as WalletLike;
      walletRef.current = wallet;
      const walletAccounts = await wallet.getAccounts();
      if (walletAccounts.length === 0) {
        throw new Error('No account returned by the wallet');
      }
      if (walletAccounts.length > 1) {
        // Let the user choose instead of silently using accounts[0].
        setAccounts(walletAccounts);
        return;
      }
      await completeSignIn(wallet, walletAccounts[0].accountId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : friendlyWalletError(err));
    } finally {
      setBusy(false);
    }
  }, [completeSignIn, ensureConnector]);

  const signInWithWallet = useCallback(
    async (walletId: string) => {
      setBusy(true);
      setActiveWalletId(walletId);
      setError(null);
      setAccounts([]);
      try {
        const connector = await ensureConnector();
        if (!connector) throw new Error('Wallet connector is unavailable');
        const wallet = (await connector.connect({ walletId })) as WalletLike;
        walletRef.current = wallet;
        const walletAccounts = await wallet.getAccounts();
        if (walletAccounts.length === 0) {
          throw new Error('No account returned by the wallet');
        }
        if (walletAccounts.length > 1) {
          setAccounts(walletAccounts);
          return;
        }
        await completeSignIn(wallet, walletAccounts[0].accountId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : friendlyWalletError(err));
      } finally {
        setBusy(false);
        setActiveWalletId(null);
      }
    },
    [completeSignIn, ensureConnector],
  );

  const chooseAccount = useCallback(
    async (accountId: string) => {
      const wallet = walletRef.current;
      if (!wallet) {
        setAccounts([]);
        setError('The wallet connection was lost. Please choose a wallet again.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await completeSignIn(wallet, accountId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : friendlyWalletError(err));
      } finally {
        setBusy(false);
      }
    },
    [completeSignIn],
  );

  const cancelAccountSelection = useCallback(() => setAccounts([]), []);

  const rememberSeed = useCallback(
    (seed: Uint8Array, accountId: string, nearPublicKey?: string) => {
      const derived = deriveNearKey(seed);
      const matches = nearPublicKey
        ? derived.nearPublicKey === nearPublicKey
        : derived.accountId === accountId;
      if (!matches) {
        throw new Error('The unlock key does not match this NEAR account');
      }
      seedRef.current = seed;
    },
    [],
  );

  const unlockSeed = useCallback(async (): Promise<Uint8Array> => {
    if (seedRef.current) return seedRef.current;
    if (!session?.user) throw new Error('Sign in first');
    if (session.authMethod === 'recovery') {
      throw new Error('Re-enter your recovery key to unlock signing on this device.');
    }
    const { credential, prfOutput } = await assertPasskey(localAssertionOptions());
    if (!prfOutput) {
      throw new Error('This authenticator did not return the PRF secret needed to unlock signing.');
    }
    const unlocked = await api<UnlockResponse>('/auth/passkey/unlock', {
      method: 'POST',
      body: JSON.stringify({ credentialId: credential.id }),
    });
    const seed = await unwrapSeed(
      unlocked.wrappedSeed,
      prfOutput,
      unlocked.accountId,
      credential.id,
    );
    rememberSeed(seed, unlocked.accountId, unlocked.nearPublicKey);
    return seed;
  }, [rememberSeed, session]);

  const signInWithPasskey = useCallback(async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Record<string, unknown> }>(
        '/auth/passkey/login/options',
        { method: 'POST', body: JSON.stringify({}) },
      );
      const { credential, prfOutput } = await assertPasskey(options);
      const next = await api<Session>('/auth/passkey/login/verify', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });
      setSession(next);
      if (prfOutput && next.user) {
        try {
          const unlocked = await api<UnlockResponse>('/auth/passkey/unlock', {
            method: 'POST',
            body: JSON.stringify({ credentialId: credential.id }),
          });
          const seed = await unwrapSeed(
            unlocked.wrappedSeed,
            prfOutput,
            unlocked.accountId,
            credential.id,
          );
          rememberSeed(seed, unlocked.accountId, unlocked.nearPublicKey);
        } catch {
          // Login still succeeded. Signing will prompt for the passkey again.
          seedRef.current = null;
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : friendlyPasskeyError(err));
    } finally {
      setPasskeyBusy(false);
    }
  }, [rememberSeed]);

  const createPasskeyAccount = useCallback(async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      const seed = randomSeed();
      const key = deriveNearKey(seed);
      const { options } = await api<{ options: Record<string, unknown> }>(
        '/auth/passkey/signup/options',
        {
          method: 'POST',
          body: JSON.stringify({ accountId: key.accountId, nearPublicKey: key.nearPublicKey }),
        },
      );
      const created = await createPasskey(options);
      const wrappedSeed = await wrapSeed(seed, created.prfOutput, key.accountId, created.credentialId);
      const challenge = await api<{ nonce: string; message: string; recipient: string }>(
        '/auth/challenge',
        {
          method: 'POST',
          body: JSON.stringify({ accountId: key.accountId, network: chainNetwork }),
        },
      );
      const signed = signNep413(seed, {
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
      });
      const next = await api<Session>('/auth/passkey/signup/verify', {
        method: 'POST',
        body: JSON.stringify({
          accountId: key.accountId,
          nearPublicKey: key.nearPublicKey,
          credential: created.credential,
          wrappedSeed,
          nep413: {
            accountId: key.accountId,
            publicKey: signed.publicKey,
            signature: signed.signature,
            nonce: challenge.nonce,
            recipient: challenge.recipient,
          },
        }),
      });
      seedRef.current = seed;
      setSession(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : friendlyPasskeyError(err));
    } finally {
      setPasskeyBusy(false);
    }
  }, []);

  const signInWithRecoveryKey = useCallback(
    async (recoveryKey: string, accountId?: string) => {
      setPasskeyBusy(true);
      setError(null);
      try {
        const seed = decodeRecoveryKey(recoveryKey);
        const key = deriveNearKey(seed);
        const target = accountId?.trim() || key.accountId;
        const challenge = await api<{ nonce: string; message: string; recipient: string }>(
          '/auth/challenge',
          {
            method: 'POST',
            body: JSON.stringify({ accountId: target, network: chainNetwork }),
          },
        );
        const signed = signNep413(seed, {
          message: challenge.message,
          recipient: challenge.recipient,
          nonce: base64ToBytes(challenge.nonce),
        });
        const next = await api<Session>('/auth/passkey/recovery/verify', {
          method: 'POST',
          body: JSON.stringify({
            accountId: target,
            publicKey: signed.publicKey,
            signature: signed.signature,
            nonce: challenge.nonce,
            recipient: challenge.recipient,
          }),
        });
        seedRef.current = seed;
        setSession(next);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : friendlyPasskeyError(err));
      } finally {
        setPasskeyBusy(false);
      }
    },
    [],
  );

  const listPasskeys = useCallback(async () => {
    return api<PasskeySummary[]>('/auth/passkey/credentials');
  }, []);

  const ensureWallet = useCallback(async (): Promise<WalletLike> => {
    if (walletRef.current) return walletRef.current;
    const connector = await ensureConnector();
    if (!connector) throw new Error('Wallet connector is unavailable');
    const wallet = (await connector.connect()) as WalletLike;
    walletRef.current = wallet;
    return wallet;
  }, [ensureConnector]);

  /** Signs and sends through the active signer (wallet or passkey-derived key). */
  const sendTransactionsInternal = useCallback(
    async (transactions: PasskeyTransaction[]) => {
      if (session?.authMethod === 'passkey' || session?.authMethod === 'recovery') {
        if (!session.user) throw new Error('Session expired');
        let seed = seedRef.current;
        if (!seed) seed = await unlockSeed();
        // Load near-api-js only when an on-chain signature is actually needed.
        const { PasskeySigner } = await import('./passkey/signer');
        const signer = new PasskeySigner({
          accountId: session.user.accountId,
          seed,
          network: chainNetwork,
        });
        const results = await signer.signAndSendTransactions({ transactions });
        return results.map((result) => ({ hash: result.transaction.hash }));
      }
      const wallet = await ensureWallet();
      const walletAccounts = await wallet.getAccounts();
      const active = walletAccounts[0]?.accountId;
      if (active && session?.user?.accountId && active !== session.user.accountId) {
        throw new Error(
          `This wallet is ${active}, but you are signed in as ${session.user.accountId}. Connect the matching account.`,
        );
      }
      const results = await wallet.signAndSendTransactions({ transactions });
      return (results ?? []).map((result, index) => ({
        hash: result?.transaction?.hash ?? `tx-${index}`,
      }));
    },
    [ensureWallet, session, unlockSeed],
  );

  const addPasskey = useCallback(async () => {
    if (!session?.user) throw new Error('Sign in first');
    setPasskeyBusy(true);
    setError(null);
    try {
      const existing = await listPasskeys();
      let seed: Uint8Array;
      if (existing.length > 0) {
        seed = await unlockSeed();
      } else if (seedRef.current) {
        // Recovery session: bind the passkey to the key the user just entered.
        seed = seedRef.current;
      } else {
        // Wallet account adding its first passkey: register the derived key
        // on-chain with an AddKey transaction before binding the passkey.
        seed = randomSeed();
        const key = deriveNearKey(seed);
        await sendTransactionsInternal([
          {
            receiverId: session.user.accountId,
            actions: [
              {
                type: 'AddKey',
                params: {
                  publicKey: key.nearPublicKey,
                  accessKey: { nonce: 0, permission: 'FullAccess' },
                },
              },
            ],
          },
        ]);
      }
      const key = deriveNearKey(seed);
      const { options } = await api<{ options: Record<string, unknown> }>(
        '/auth/passkey/credentials/options',
        { method: 'POST', body: JSON.stringify({ nearPublicKey: key.nearPublicKey }) },
      );
      const created = await createPasskey(options);
      const wrappedSeed = await wrapSeed(
        seed,
        created.prfOutput,
        session.user.accountId,
        created.credentialId,
      );
      const challenge = await api<{ nonce: string; message: string; recipient: string }>(
        '/auth/challenge',
        {
          method: 'POST',
          body: JSON.stringify({
            accountId: session.user.accountId,
            network: chainNetwork,
          }),
        },
      );
      const signed = signNep413(seed, {
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
      });
      await api('/auth/passkey/credentials', {
        method: 'POST',
        body: JSON.stringify({
          nearPublicKey: key.nearPublicKey,
          credential: created.credential,
          wrappedSeed,
          nep413: {
            accountId: session.user.accountId,
            publicKey: signed.publicKey,
            signature: signed.signature,
            nonce: challenge.nonce,
            recipient: challenge.recipient,
          },
        }),
      });
      seedRef.current = seed;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : friendlyPasskeyError(err));
    } finally {
      setPasskeyBusy(false);
    }
  }, [listPasskeys, sendTransactionsInternal, session, unlockSeed]);

  const removePasskey = useCallback(
    async (id: string, confirmRecovery = false) => {
      setPasskeyBusy(true);
      setError(null);
      try {
        await api(`/auth/passkey/credentials/${id}?confirmRecovery=${confirmRecovery}`, {
          method: 'DELETE',
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : friendlyPasskeyError(err));
      } finally {
        setPasskeyBusy(false);
      }
    },
    [],
  );

  const exportRecoveryKey = useCallback(async () => {
    const seed = await unlockSeed();
    const { encodeRecoveryKey } = await import('./passkey');
    return encodeRecoveryKey(seed);
  }, [unlockSeed]);

  const preloadWallets = useCallback(async () => {
    // Warm the connector and load the wallet manifest while the user is still on
    // /login, so a row click can connect inside the click gesture.
    await loadWallets();
  }, [loadWallets]);

  const sendTransactions = useCallback(
    (transactions: PasskeyTransaction[]) => sendTransactionsInternal(transactions),
    [sendTransactionsInternal],
  );

  const signOut = useCallback(async () => {
    try {
      if (connectorRef.current && walletRef.current) {
        await connectorRef.current.disconnect(walletRef.current);
      }
    } catch {
      /* wallet already detached */
    }
    walletRef.current = null;
    seedRef.current = null;
    setAccounts([]);
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // A failed API logout must not keep the local UI signed in.
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      busy,
      passkeyBusy,
      passkeySupported,
      passkeyReady,
      error,
      signIn,
      signInWithPasskey,
      createPasskeyAccount,
      signInWithRecoveryKey,
      addPasskey,
      removePasskey,
      listPasskeys,
      exportRecoveryKey,
      unlockSeed,
      signOut,
      refresh,
      clearError: () => setError(null),
      sendTransactions,
      preloadWallets,
      wallets,
      walletsLoading,
      activeWalletId,
      signInWithWallet,
      accounts,
      chooseAccount,
      cancelAccountSelection,
    }),
    [
      session,
      loading,
      busy,
      passkeyBusy,
      passkeySupported,
      passkeyReady,
      error,
      signIn,
      signInWithPasskey,
      createPasskeyAccount,
      signInWithRecoveryKey,
      addPasskey,
      removePasskey,
      listPasskeys,
      exportRecoveryKey,
      unlockSeed,
      signOut,
      refresh,
      sendTransactions,
      preloadWallets,
      wallets,
      walletsLoading,
      activeWalletId,
      signInWithWallet,
      accounts,
      chooseAccount,
      cancelAccountSelection,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside NearAuthProvider');
  return ctx;
}
