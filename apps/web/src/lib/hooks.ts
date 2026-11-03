'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export function useApi<T>(path: string | null, options?: { pollMs?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api<T>(path);
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof ApiError ? err.message : 'Could not load data');
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  useEffect(() => {
    if (!options?.pollMs || !path) return;
    const id = setInterval(() => void reload(), options.pollMs);
    return () => clearInterval(id);
  }, [options?.pollMs, path, reload]);

  return { data, loading, error, reload, setData };
}
