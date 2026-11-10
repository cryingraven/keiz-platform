'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { downloadApiFile } from '@/lib/download';
import { useToast } from '@/components/feedback';
import { Button, Spinner } from '@/components/ui';
import type { ReportTab } from './types';

const TAB_LABELS: Record<ReportTab, string> = {
  'cash-flow': 'Cash flow',
  'profit-and-loss': 'Profit & loss',
  'balance-sheet': 'Balance sheet',
};

type ReportFormat = 'pdf' | 'xlsx' | 'csv';

export function ReportExportMenu({
  query,
  activeTab,
  disabled,
}: {
  query: string;
  activeTab: ReportTab;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function run(format: ReportFormat, statement: ReportTab | 'all') {
    setOpen(false);
    setBusy(`${format}:${statement}`);
    try {
      await downloadApiFile(
        `/accounting/reports/export?${query}&format=${format}&report=${statement}`,
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Could not export the report',
        'error',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <Button
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        loading={Boolean(busy)}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? null : <Download className="h-3.5 w-3.5" />} Export
        <ChevronDown className="h-3 w-3 text-muted" />
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label="Export report"
          className="absolute right-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-panel border border-line bg-surface p-1.5 shadow-xl"
        >
          <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
            Current report · {TAB_LABELS[activeTab]}
          </p>
          {(
            [
              ['pdf', 'PDF', FileText],
              ['xlsx', 'Excel', FileSpreadsheet],
              ['csv', 'CSV', FileText],
            ] as const
          ).map(([format, label, Icon]) => {
            const key = `${format}:${activeTab}`;
            return (
              <button
                key={format}
                type="button"
                role="menuitem"
                onClick={() => void run(format, activeTab)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-paper"
              >
                {busy === key ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5 text-muted" />
                )}
                <span className="flex-1">{label}</span>
              </button>
            );
          })}

          <div className="my-1 h-px bg-line" />
          <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
            All statements
          </p>
          {(
            [
              ['pdf', 'Full report pack · PDF', FileText],
              ['xlsx', 'Full report pack · Excel', FileSpreadsheet],
            ] as const
          ).map(([format, label, Icon]) => {
            const key = `${format}:all`;
            return (
              <button
                key={`all-${format}`}
                type="button"
                role="menuitem"
                onClick={() => void run(format, 'all')}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-paper"
              >
                {busy === key ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5 text-muted" />
                )}
                <span className="flex-1">{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
