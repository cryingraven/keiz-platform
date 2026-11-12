'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

const LINKS = [
  ['How it works', '#how'],
  ['Ledger', '#ledger'],
  ['Trust', '#trust'],
  ['FAQ', '#faq'],
] as const;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('a')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="relative md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="landing-navigation"
        className="flex h-11 w-11 items-center justify-center rounded-control text-muted transition-colors hover:bg-ink/[0.04] hover:text-ink"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id="landing-navigation"
          className="absolute left-0 top-full z-40 mt-2 w-64 rounded-card border border-line bg-surface p-2 shadow-panel"
        >
          {LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-control px-3 text-[14px] text-muted transition-colors hover:bg-surface-raised hover:text-ink"
            >
              {label}
            </a>
          ))}
          <div className="mt-2 space-y-1 border-t border-line pt-2">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-control px-3 text-[14px] font-medium text-ink transition-colors hover:bg-surface-raised"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center justify-center rounded-control bg-ink px-3 text-[14px] font-medium text-white transition-colors hover:bg-ink-soft"
            >
              Try the demo
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
