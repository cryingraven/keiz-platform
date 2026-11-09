import { ApiError } from './api';

/** Download a binary API response (PDF/XLSX) through the same-origin proxy. */
export async function downloadApiFile(path: string): Promise<void> {
  const response = await fetch(`/api${path}`, { credentials: 'include' });
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) message = payload.message;
    } catch {
      // A proxy error page is HTML, not JSON.
    }
    throw new ApiError(message, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? 'keiz-report';

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
