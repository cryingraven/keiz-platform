'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, RefreshCw, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useConfirm } from '@/components/feedback';
import { Badge, Button, Label, Modal, Select, Spinner } from '@/components/ui';
import type {
  CreatedDocumentShare,
  DocumentShareMeta,
  DocumentType,
} from './types';

const EXPIRY_OPTIONS = [7, 30, 90] as const;

export function ShareDocumentDialog({
  open,
  onClose,
  documentType,
  documentId,
  documentNumber,
}: {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  documentId: string;
  documentNumber: string;
}) {
  const meta = useApi<DocumentShareMeta>(
    open ? `/documents/${documentType}/${documentId}/share` : null,
  );
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [created, setCreated] = useState<CreatedDocumentShare | null>(null);
  const [busy, setBusy] = useState<'create' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) {
      setCreated(null);
      setCopied(false);
      setError(null);
    }
  }, [open]);

  const url = created
    ? `${typeof window === 'undefined' ? '' : window.location.origin}${created.path}`
    : '';

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const result = await api<CreatedDocumentShare>(
        `/documents/${documentType}/${documentId}/share`,
        {
          method: 'POST',
          body: JSON.stringify({ expiresInDays }),
        },
      );
      setCreated(result);
      setCopied(false);
      await meta.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the link');
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const ok = await confirm({
      title: 'Revoke this public link?',
      body: 'Anyone using the old link will lose access immediately. You can create a new link at any time.',
      confirmLabel: 'Revoke link',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('revoke');
    setError(null);
    try {
      await api(`/documents/${documentType}/${documentId}/share`, {
        method: 'DELETE',
      });
      setCreated(null);
      await meta.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the link');
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Could not copy automatically. Select the link and copy it manually.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${documentNumber}`}
      description="Anyone with the link can view this document and download a PDF."
      wide
    >
      <div className="space-y-4">
        <div className="flex gap-2 rounded-control border border-brand/20 bg-brand-soft px-3 py-2.5 text-[12px] leading-relaxed text-brand-deep">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The public view never includes approvals, ledger entries, payment details or other
            documents. You can revoke the link at any time.
          </span>
        </div>

        {meta.loading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-muted">
            <Spinner /> Checking the current link
          </div>
        ) : (
          <>
            {created ? (
              <div className="space-y-2">
                <Label htmlFor="shared-link">Public link</Label>
                <div className="flex gap-2">
                  <input
                    id="shared-link"
                    readOnly
                    value={url}
                    onFocus={(event) => event.target.select()}
                    className="w-full rounded-control border border-line bg-paper px-3 py-2.5 font-num text-[12px] text-ink outline-none"
                  />
                  <Button variant="secondary" onClick={() => void copy()}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[11px] text-amber">
                  Copy this link now. For security, the URL is not shown again after you close
                  this dialog. Expires {formatDate(created.expiresAt)}.
                </p>
              </div>
            ) : meta.data?.active ? (
              <div className="rounded-control border border-line bg-paper/60 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge dot className="border-mint/20 bg-mint-soft text-mint">
                    Link active
                  </Badge>
                  <span className="text-[12px] text-muted">
                    Expires {meta.data.expiresAt ? formatDate(meta.data.expiresAt) : '—'} ·{' '}
                    {meta.data.viewCount} view{meta.data.viewCount === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  For security, the current URL is not readable after the dialog closes. Rotate
                  the link to get a new one and invalidate the old URL.
                </p>
              </div>
            ) : (
              <div className="rounded-control border border-line bg-paper/60 px-4 py-3 text-[12px] text-muted">
                No active public link. Create one to let the recipient view this document outside
                the workspace.
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
              <div>
                <Label htmlFor="share-expiry">Link expires</Label>
                <Select
                  id="share-expiry"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                  className="w-auto min-w-[140px]"
                >
                  {EXPIRY_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days} days
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {meta.data?.active ? (
                  <Button
                    variant="ghost"
                    loading={busy === 'revoke'}
                    onClick={() => void revoke()}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Revoke
                  </Button>
                ) : null}
                <Button loading={busy === 'create'} onClick={() => void create()}>
                  {meta.data?.active ? (
                    <RefreshCw className="h-3.5 w-3.5" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {meta.data?.active ? 'Rotate link' : 'Create public link'}
                </Button>
              </div>
            </div>
          </>
        )}

        {error ? (
          <p className="rounded-control border border-rose/20 bg-rose-soft px-3 py-2 text-[12px] text-rose">
            {error}
          </p>
        ) : null}

        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <Share2 className="h-3.5 w-3.5" /> Share only with the intended recipient.
        </p>
      </div>
    </Modal>
  );
}
