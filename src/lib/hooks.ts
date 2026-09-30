import { useCallback, useEffect, useRef, useState } from "react";

// Minimal data fetching: a per-key cache so navigating back renders instantly,
// plus prefix-based invalidation after mutations.

const cache = new Map<string, unknown>();
const listeners = new Set<(prefix: string) => void>();

export function invalidate(...prefixes: string[]) {
  for (const prefix of prefixes) {
    for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
    for (const listener of listeners) listener(prefix);
  }
}

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => Promise<void>;
  mutate: (data: T) => void;
}

export function useResource<T>(key: string | null, loader: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: Error | null; loading: boolean }>(() => ({
    key,
    data: key ? (cache.get(key) as T | undefined) : undefined,
    error: null,
    loading: Boolean(key),
  }));
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!key) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, key, loading: true }));
    try {
      const data = await loaderRef.current();
      if (id !== seq.current) return;
      cache.set(key, data);
      setState({ key, data, error: null, loading: false });
    } catch (err) {
      if (id !== seq.current) return;
      setState((s) => ({ ...s, key, error: err as Error, loading: false }));
    }
  }, [key]);

  useEffect(() => {
    setState({ key, data: key ? (cache.get(key) as T | undefined) : undefined, error: null, loading: Boolean(key) });
    void reload();
  }, [key, reload]);

  useEffect(() => {
    const listener = (prefix: string) => {
      if (key?.startsWith(prefix)) void reload();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key, reload]);

  const mutate = useCallback(
    (data: T) => {
      if (key) cache.set(key, data);
      setState((s) => ({ ...s, data }));
    },
    [key],
  );

  // Never show data that belongs to a previous key.
  const data = state.key === key ? state.data : key ? (cache.get(key) as T | undefined) : undefined;
  return { data, error: state.key === key ? state.error : null, loading: state.key === key ? state.loading : true, reload, mutate };
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Runs an async action with pending state; errors are reported through onError. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>, onError?: (err: Error) => void) {
  const [pending, setPending] = useState(false);
  const actionRef = useRef(action);
  actionRef.current = action;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    try {
      return await actionRef.current(...args);
    } catch (err) {
      errorRef.current?.(err as Error);
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return [run, pending] as const;
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} – Sietch` : "Sietch";
  }, [title]);
}
