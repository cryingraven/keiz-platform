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
import { passkeyEnabled, signInWithPasskey as passkeySignIn } from './passkey';

export interface Session {
  user: { id: string; accountId: string; displayName: string | null } | null;
  org: { id: string; name: string; slug: string } | null;
  role: string | null;
}

export interface WalletAccount {
  accountId: string;
  publicKey?: string;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  busy: boolean;
  passkeyBusy: boolean;
  passkeyEnabled: boolean;
  walletLoginEnabled: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  sendTransactions: (transactions: unknown[]) => Promise<Array<{ hash: string }>>;
  preloadWallets: () => Promise<void>;
  accounts: WalletAccount[];
  chooseAccount: (accountId: string) => Promise<void>;
  cancelAccountSelection: () => void;
}

const walletLoginEnabled = process.env.NEXT_PUBLIC_WALLET_LOGIN === 'true';

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

export function NearAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectorRef = useRef<any>(null);
  const connectorPromiseRef = useRef<Promise<any> | null>(null);
  const walletRef = useRef<WalletLike | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Session>('/auth/me');
      setSession(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setSession(null);
    window.addEventListener('keiz:unauthorized', onUnauthorized);
    return () => window.removeEventListener('keiz:unauthorized', onUnauthorized);
  }, [refresh]);

  /**
   * Load near-connect lazily, on the first wallet action. Passkey-only mode and
   * dashboard pages never import it.
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
          connectorRef.current = connector;
          return connector;
        } catch {
          return null;
        }
      })();
    }
    return connectorPromiseRef.current;
  }, []);

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
      setSession(nextSession);
      setAccounts([]);
    },
    [],
  );

  const signIn = useCallback(async () => {
    if (!walletLoginEnabled) {
      setError('Wallet login is disabled. Use a passkey.');
      return;
    }
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

  const preloadWallets = useCallback(async () => {
    if (!walletLoginEnabled) return;
    // Warm the connector while the user is still on /login so connect() can
    // open the selector inside the click gesture (popup blockers).
    await ensureConnector();
  }, [ensureConnector]);

  const signInWithPasskey = useCallback(async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      const next = await passkeySignIn();
      setSession(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Passkey sign-in failed. Check the Auth0 and relayer configuration.',
      );
    } finally {
      setPasskeyBusy(false);
    }
  }, []);

  const ensureWallet = useCallback(async (): Promise<WalletLike> => {
    if (!walletLoginEnabled) {
      throw new Error('Wallet signing is disabled. Enable NEXT_PUBLIC_WALLET_LOGIN to use it.');
    }
    if (walletRef.current) return walletRef.current;
    const connector = await ensureConnector();
    if (!connector) throw new Error('Wallet connector is unavailable');
    const wallet = (await connector.connect()) as WalletLike;
    walletRef.current = wallet;
    return wallet;
  }, [ensureConnector]);

  /** Signs and sends through the connected wallet, connecting first if needed. */
  const sendTransactions = useCallback(
    async (transactions: unknown[]) => {
      const wallet = await ensureWallet();
      const results = await wallet.signAndSendTransactions({ transactions });
      return (results ?? []).map((result, index) => ({
        hash: result?.transaction?.hash ?? `tx-${index}`,
      }));
    },
    [ensureWallet],
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
      passkeyEnabled,
      walletLoginEnabled,
      error,
      signIn,
      signInWithPasskey,
      signOut,
      refresh,
      clearError: () => setError(null),
      sendTransactions,
      preloadWallets,
      accounts,
      chooseAccount,
      cancelAccountSelection,
    }),
    [
      session,
      loading,
      busy,
      passkeyBusy,
      error,
      signIn,
      signInWithPasskey,
      signOut,
      refresh,
      sendTransactions,
      preloadWallets,
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
