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
import { passkeyEnabled, signInWithPasskey as passkeySignIn } from './passkey';

export interface Session {
  user: { id: string; accountId: string; displayName: string | null } | null;
  org: { id: string; name: string; slug: string } | null;
  role: string | null;
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
}

const walletLoginEnabled = process.env.NEXT_PUBLIC_WALLET_LOGIN === 'true';

const AuthContext = createContext<AuthContextValue | null>(null);

type WalletLike = {
  getAccounts: () => Promise<Array<{ accountId: string }>>;
  signMessage: (payload: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
  }) => Promise<{ signature: string; publicKey: string }>;
  signAndSendTransactions: (payload: {
    transactions: unknown[];
  }) => Promise<Array<{ transaction?: { hash?: string } }>>;
};

export function NearAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    // Passkey-only mode must never load the wallet connector: importing it
    // fetches the wallet manifest and can surface the wallet picker.
    if (!walletLoginEnabled) return;
    let cancelled = false;
    connectorPromiseRef.current = (async () => {
      try {
        const { NearConnector } = await import('@hot-labs/near-connect');
        const connector = new NearConnector({
          network: (process.env.NEXT_PUBLIC_NEAR_NETWORK as 'mainnet' | 'testnet') ?? 'mainnet',
          features: { signMessage: true },
          footerBranding: null,
        });
        if (!cancelled) connectorRef.current = connector;
        return connector;
      } catch {
        // Wallet connector is optional until the user tries to sign in.
        return null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!walletLoginEnabled) {
      setError('Wallet login is disabled. Use a passkey.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const connector = connectorRef.current ?? (await connectorPromiseRef.current);
      if (!connector) throw new Error('Wallet connector is unavailable');
      const wallet = (await connector.connect()) as WalletLike;
      walletRef.current = wallet;
      const accounts = await wallet.getAccounts();
      const accountId = accounts[0]?.accountId;
      if (!accountId) throw new Error('No account returned by the wallet');

      const challenge = await api<{
        nonce: string;
        message: string;
        recipient: string;
      }>('/auth/challenge', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      });

      const signed = await wallet.signMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
      });

      // Wallets disagree: some return base64 strings, others Uint8Array / key objects.
      const rawSignature = signed.signature as unknown;
      const signature =
        typeof rawSignature === 'string'
          ? rawSignature
          : bytesToBase64(new Uint8Array(rawSignature as ArrayLike<number>));
      const publicKey =
        typeof signed.publicKey === 'string' ? signed.publicKey : String(signed.publicKey);

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
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Sign in failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, []);

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
    const connector = connectorRef.current ?? (await connectorPromiseRef.current);
    if (!connector) throw new Error('Wallet connector is unavailable');
    const wallet = (await connector.connect()) as WalletLike;
    walletRef.current = wallet;
    return wallet;
  }, []);

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
    await api('/auth/logout', { method: 'POST' });
    setSession(null);
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
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside NearAuthProvider');
  return ctx;
}
