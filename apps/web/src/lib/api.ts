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
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // Access cookie expired mid-session: rotate once, then replay the request.
    if (response.status === 401 && allowRefresh && !path.startsWith('/auth/')) {
      const refreshed = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (refreshed.ok) return api<T>(path, init, false);
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
