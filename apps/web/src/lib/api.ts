export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  allowRefresh = true,
): Promise<T> {
  const hasBody = init?.body !== undefined;
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // A proxy error page (502/504) is HTML, not JSON. Keep the status.
      data = null;
    }
  }

  if (!response.ok) {
    // Access cookie expired mid-session: rotate once, then replay the request.
    // The refresh is single-flight: several parallel 401s must share one call,
    // otherwise the losers trip the server's token-reuse detector and log the
    // whole workspace out.
    if (response.status === 401 && allowRefresh && !path.startsWith('/auth/')) {
      const refreshed = await refreshSession();
      if (refreshed) return api<T>(path, init, false);
    }
    if (response.status === 401) {
      window.dispatchEvent(new Event('keiz:unauthorized'));
    }
    const payload = data as {
      message?: string | { message?: string; issues?: Array<{ path: string; message: string }> };
      issues?: Array<{ path: string; message: string }>;
    } | null;
    const rawMessage = payload?.message;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : rawMessage?.message ?? `Request failed (${response.status})`;
    const issues =
      payload?.issues ?? (typeof rawMessage === 'object' ? rawMessage?.issues : undefined);
    throw new ApiError(message, response.status, issues);
  }

  return data as T;
}

let refreshInFlight: Promise<boolean> | null = null;

/** One shared refresh request for every 401 that happens at the same time. */
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}
