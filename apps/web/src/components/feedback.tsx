'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, Modal } from './ui';

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type ToastTone = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside FeedbackProvider');
  return confirm;
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside FeedbackProvider');
  return toast;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setConfirmState(options);
    });
  }, []);

  const closeConfirm = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setConfirmState(null);
  }, []);

  const closeConfirmDialog = useCallback(() => closeConfirm(false), [closeConfirm]);

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      <ToastContext.Provider value={toast}>
        {children}

        <Modal
          open={Boolean(confirmState)}
          onClose={closeConfirmDialog}
          title={confirmState?.title ?? ''}
          description={confirmState?.body}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => closeConfirm(false)}>
              {confirmState?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={confirmState?.tone === 'danger' ? 'danger' : 'primary'}
              onClick={() => closeConfirm(true)}
            >
              {confirmState?.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </Modal>

        <div
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:px-0"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((item) => (
            <div
              key={item.id}
              role="status"
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-control border bg-surface px-3.5 py-3 text-[13px] shadow-lg',
                item.tone === 'error' && 'border-rose/20 text-rose',
                item.tone === 'success' && 'border-mint/20 text-ink',
                item.tone === 'info' && 'border-line text-ink',
              )}
            >
              {item.tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
              ) : item.tone === 'error' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              )}
              <p className="min-w-0 flex-1 leading-snug">{item.message}</p>
              <button
                type="button"
                onClick={() =>
                  setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))
                }
                className="shrink-0 rounded p-0.5 text-muted transition hover:bg-paper hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </ConfirmContext.Provider>
  );
}
