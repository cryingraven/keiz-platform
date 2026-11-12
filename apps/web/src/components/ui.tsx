'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Check, CircleAlert, Info, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { humanize, toneFor } from '@/lib/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-white hover:bg-ink-soft disabled:bg-ink/40',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-ink/30 hover:bg-surface-raised',
  ghost: 'text-muted hover:text-ink hover:bg-ink/[0.04]',
  danger: 'bg-rose text-white hover:bg-rose/90',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-small gap-1.5',
  md: 'h-10 px-3.5 text-ui gap-2',
  lg: 'h-11 px-5 text-ui gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('panel', className)}>{children}</div>;
}

/** A link that looks like a button, without nesting a button inside an anchor. */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Badge({
  children,
  className,
  dot,
}: {
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-meta font-medium',
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <Badge dot className={toneFor(status)}>
      {humanize(status)}
    </Badge>
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-small font-medium text-ink">
      {children}
      {hint ? <span className="ml-1.5 font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

const fieldClasses =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-ui text-ink placeholder:text-muted outline-none transition focus:border-brand/60 focus:ring-[3px] focus:ring-brand/10 disabled:bg-surface-raised disabled:text-muted';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(fieldClasses, 'h-10', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClasses, 'select-chevron h-10 pr-10', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea className={cn(fieldClasses, 'min-h-24 resize-y', className)} {...props} />;
}

/**
 * One field wrapper: label, hint, error and the aria wiring that goes with them.
 * Prefer this over a bare Label + Input pair so validation reads the same everywhere.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-small text-rose">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const alertTones: Record<AlertTone, { wrap: string; icon: ReactNode }> = {
  info: { wrap: 'border-line bg-surface-raised text-ink', icon: <Info className="h-4 w-4 text-muted" /> },
  success: { wrap: 'border-mint/25 bg-mint-soft text-ink', icon: <Check className="h-4 w-4 text-mint" /> },
  warning: { wrap: 'border-amber/25 bg-amber-soft text-ink', icon: <CircleAlert className="h-4 w-4 text-amber" /> },
  danger: { wrap: 'border-rose/25 bg-rose-soft text-ink', icon: <AlertTriangle className="h-4 w-4 text-rose" /> },
};

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const styles = alertTones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-control border px-3.5 py-3 text-small leading-relaxed', styles.wrap, className)}
    >
      <span className="mt-px shrink-0">{styles.icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className={cn('text-ink/80', title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-muted transition hover:text-ink"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Start in the form body, not on the header close button. Falling back to
    // the panel itself keeps screen readers inside the dialog.
    const initial = contentRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (initial && initial.length > 0) {
      initial[0].focus();
    } else {
      panel?.focus();
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/35">
      <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cn(
            'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-xl outline-none sm:max-h-[calc(100dvh-4rem)]',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              <h2 id={titleId} className="text-[15px] font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-small leading-relaxed text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              onClick={onClose}
              type="button"
              className="rounded-control p-1.5 text-muted transition hover:bg-surface-raised hover:text-ink"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div
            ref={contentRef}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin sm:px-6 sm:py-5"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="rounded-full bg-surface-raised p-3 text-muted">{icon}</div> : null}
      <div>
        <p className="text-ui font-medium text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-small leading-relaxed text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-control', className)} aria-hidden />;
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      <div className="flex items-center gap-4 px-5 py-3">
        {Array.from({ length: cols }).map((_, index) => (
          <Skeleton key={index} className={cn('h-2.5', index === 0 ? 'w-24' : 'w-16')} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-4">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton
              key={col}
              className={cn('h-3.5', col === 0 ? 'w-28' : col === cols - 1 ? 'ml-auto w-16' : 'w-20')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ProgressSteps({
  labels,
  current,
}: {
  labels: string[];
  current: number;
}) {
  const active = Math.max(0, Math.min(current, labels.length - 1));
  return (
    <ol className="flex items-center gap-1.5 sm:gap-3" aria-label="Progress">
      {labels.map((label, index) => {
        const done = index < active;
        const isCurrent = index === active;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2">
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-meta font-semibold transition',
                done && 'border-mint bg-mint text-white',
                isCurrent && 'border-ink bg-ink text-white',
                !done && !isCurrent && 'border-line-strong bg-surface text-muted',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {done ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <span
              className={cn(
                'truncate text-small',
                isCurrent ? 'font-medium text-ink' : 'text-muted',
              )}
            >
              {label}
            </span>
            {index < labels.length - 1 ? (
              <span
                className={cn('mx-0.5 hidden h-px flex-1 sm:block sm:w-10', done ? 'bg-mint/40' : 'bg-line')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A load failure must never be mistaken for an empty workspace. */
export function ErrorState({
  message,
  onRetry,
  title = 'Could not load this data',
}: {
  message?: string | null;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-rose-soft p-3 text-rose">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <p className="text-ui font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-small leading-relaxed text-muted">
          {message ?? 'The request failed. Check your connection and try again.'}
        </p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-ui font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-small text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}
