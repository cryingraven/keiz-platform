import Link from 'next/link';
import { cn } from '@/lib/utils';

export function KeizMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}

      {/* ledger spine */}
      <path
        d="M7 5v14"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />

      {/* money out */}
      <path
        d="M7 12 17.5 4"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 4h3.5v3.5"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* money in */}
      <path
        d="M7 12 17.5 20"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 20h3.5v-3.5"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ light = false, large = false }: { light?: boolean; large?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="KEIZ home">
      <span
        className={cn(
          'grid shrink-0 place-items-center',
          large ? 'h-9 w-9 rounded-[11px]' : 'h-8 w-8 rounded-[10px]',
          light ? 'bg-white text-ink' : 'bg-ink text-white',
        )}
      >
        <KeizMark className={large ? 'h-[22px] w-[22px]' : 'h-5 w-5'} />
      </span>
      <span
        className={cn(
          'font-semibold tracking-tight',
          large ? 'text-[18px]' : 'text-[15px]',
          light ? 'text-white' : 'text-ink',
        )}
      >
        KEIZ
      </span>
    </Link>
  );
}
