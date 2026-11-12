import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function NearProtocolIcon({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M13.9017 0.646973C13.3462 0.646973 12.8304 0.929357 12.5394 1.39357L9.40403 5.95741C9.30186 6.10784 9.34331 6.31059 9.49675 6.41075C9.6211 6.49202 9.78561 6.48196 9.89889 6.38645L12.9851 3.76201C13.0364 3.71677 13.1154 3.72137 13.1616 3.77165C13.1825 3.79469 13.1937 3.82444 13.1937 3.85502V12.0719C13.1937 12.1397 13.1377 12.1942 13.0684 12.1942C13.0312 12.1942 12.9962 12.1783 12.9727 12.1502L3.6435 1.20169C3.33966 0.850174 2.89352 0.647392 2.42388 0.646973H2.09782C1.21536 0.646973 0.5 1.34833 0.5 2.2135V13.7863C0.5 14.6515 1.21536 15.3528 2.09782 15.3528C2.65336 15.3528 3.16915 15.0704 3.46017 14.6062L6.59558 10.0424C6.69769 9.89194 6.65624 9.68919 6.50279 9.58903C6.37845 9.50776 6.21394 9.51782 6.10071 9.61334L3.01446 12.2378C2.96318 12.283 2.88412 12.2784 2.83797 12.2281C2.81703 12.2051 2.80592 12.1753 2.80634 12.1447V3.92583C2.80634 3.85796 2.86232 3.80349 2.93155 3.80349C2.96831 3.80349 3.00377 3.81941 3.02728 3.84748L12.3552 14.7981C12.659 15.1496 13.1052 15.3524 13.5749 15.3528H13.9009C14.7833 15.3532 15.4992 14.6523 15.5 13.7871V2.2135C15.5 1.34833 14.7842 0.646973 13.9017 0.646973Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function NearProtocolLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logos/near-protocol-wordmark.svg"
      alt="NEAR Protocol"
      className={cn('h-4 w-auto sm:h-5', className)}
      loading="eager"
      decoding="async"
    />
  );
}

export function NearIntentsLogo({
  variant = 'light',
  className,
}: {
  variant?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <img
      src={`/logos/near-intents-${variant}.svg`}
      alt="NEAR Intents"
      className={cn('h-5 w-auto', className)}
      loading="eager"
      decoding="async"
    />
  );
}

export function NearAiLogo({
  variant = 'color',
  className,
}: {
  variant?: 'color' | 'white';
  className?: string;
}) {
  return (
    <img
      src={variant === 'white' ? '/logos/near-ai-white-color.svg' : '/logos/near-ai-color.svg'}
      alt="NEAR AI"
      className={cn('h-6 w-auto', className)}
      loading="eager"
      decoding="async"
    />
  );
}

export function OutLayerLogo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="OutLayer">
      <span
        className={`grid h-7 w-7 place-items-center rounded-lg p-1 ${
          dark ? 'bg-white/10' : 'bg-ink'
        }`}
      >
        <img
          src="/logos/outlayer-mark.png"
          alt=""
          className="h-5 w-5"
          loading="eager"
          decoding="async"
        />
      </span>
      <span
        className={`text-[14px] font-semibold tracking-tight ${
          dark ? 'text-white' : 'text-ink'
        }`}
      >
        Out<span className="text-brand">Layer</span>
      </span>
    </span>
  );
}

export function NearCredit({
  dark = false,
  className,
}: {
  dark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-meta',
        dark ? 'text-white/65' : 'text-muted',
        className,
      )}
    >
      <NearProtocolIcon className="h-3.5 w-3.5" />
      Built on NEAR
    </span>
  );
}

function LogoLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="inline-flex items-center opacity-90 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {children}
    </a>
  );
}

export function LogoStrip() {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <p className="text-[13px] text-muted">Runs on</p>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <LogoLink href="https://near.org" label="NEAR Protocol">
          <NearProtocolLogo />
        </LogoLink>
        <LogoLink href="https://near-intents.org" label="NEAR Intents">
          <NearIntentsLogo />
        </LogoLink>
        <LogoLink href="https://near.ai" label="NEAR AI">
          <NearAiLogo />
        </LogoLink>
        <LogoLink href="https://app.outlayer.ai" label="OutLayer">
          <OutLayerLogo />
        </LogoLink>
      </div>
    </div>
  );
}
