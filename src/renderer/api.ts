/** Thin typed client over the preload bridge + async helpers. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DentivaBridge } from './env.d';

export const api: DentivaBridge = typeof window !== 'undefined' && window.dentiva
  ? window.dentiva
  : (new Proxy({} as DentivaBridge, {
      get: () => async () => {
        throw new Error('Dentiva bridge is unavailable.');
      },
    }) as DentivaBridge);

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T)) => void;
}

/** Small data-loading hook with reload + race protection. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts?: { immediate?: boolean }): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(opts?.immediate !== false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (opts?.immediate === false) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((res) => {
        if (generation.current !== gen) return;
        setDataState(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (generation.current !== gen) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, opts?.immediate]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: T | ((prev: T | null) => T)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T)(prev) : updater));
  }, []);

  return { data, error, loading, reload, setData };
}

/** Run an async action with pending state + error capture (forms/buttons). */
export function useAction<Args extends any[], R>(
  fn: (...args: Args) => Promise<R>,
): { run: (...args: Args) => Promise<R | undefined>; pending: boolean; error: Error | null; clearError: () => void } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: Args): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(null) };
}

/** Poll interval respecting page visibility. */
export function useInterval(callback: () => void, ms: number): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') saved.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
