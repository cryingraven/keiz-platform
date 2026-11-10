'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

const LINKS = [
  ['Product', '#product'],
  ['Accounting', '#accounting'],
  ['Payments', '#payments'],
  ['Security', '#security'],
  ['FAQ', '#faq'],
] as const;

export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="landing-navigation"
        className="flex h-9 w-9 items-center justify-center rounded-control text-muted transition hover:bg-ink/5 hover:text-ink"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open ? (
        <div
          id="landing-navigation"
          className="absolute left-0 top-full z-40 mt-2 w-56 rounded-panel border border-line bg-surface p-2 shadow-xl"
        >
          {LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-[14px] text-muted transition hover:bg-paper hover:text-ink"
            >
              {label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
