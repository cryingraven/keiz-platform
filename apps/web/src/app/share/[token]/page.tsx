'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { downloadApiFile } from '@/lib/download';
import { useApi } from '@/lib/hooks';
import { Logo } from '@/components/logo';
import { PublicDocumentView } from '@/components/documents/public-document';
import { Button, Card, Spinner } from '@/components/ui';
import type { PublicDocument } from '@/components/documents/types';

export default function SharedDocumentPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const document = useApi<PublicDocument>(
    token ? `/public/documents/${encodeURIComponent(token)}` : null,
  );
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function download() {
    if (!token) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadApiFile(`/public/documents/${encodeURIComponent(token)}/pdf`);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : 'Could not download the PDF',
      );
    } finally {
      setDownloading(false);
    }
  }

  if (document.loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading shared document
        </div>
      </div>
    );
  }

  if (document.error || !document.data) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-soft text-rose">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-base font-semibold">This link is no longer available</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {document.error ??
              'The link may have expired, been revoked, or the document is no longer available. Ask the sender for a new link.'}
          </p>
          <div className="mt-5 flex justify-center">
            <Logo />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PublicDocumentView
        document={document.data}
        onDownload={() => void download()}
        downloading={downloading}
      />
      {downloadError ? (
        <p className="fixed inset-x-4 bottom-4 mx-auto max-w-md rounded-control border border-rose/20 bg-rose-soft px-4 py-3 text-center text-[12px] text-rose shadow-lg">
          {downloadError}
        </p>
      ) : null}
    </div>
  );
}
