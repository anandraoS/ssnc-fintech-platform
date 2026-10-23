import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { isApiProblem } from './models';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string;
  /** HTTP status of the failure (0 for network errors, -1 for non-API errors), or null when there is no error. */
  errorStatus: number | null;
  /** Re-runs the loader (keeps showing the previous data until the new result arrives). */
  reload: () => void;
}

/**
 * Runs an async loader whenever `deps` change and exposes loading / error / data. A result that arrives after the inputs
 * changed (or after unmount) is ignored, so a slow earlier request can never overwrite a newer one.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList, fallbackError = 'Something went wrong.'): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setErrorStatus(null);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(isApiProblem(e) ? e.message : fallbackError);
          setErrorStatus(isApiProblem(e) ? e.status : -1);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, errorStatus, reload };
}

/** Sets the document title for the current page. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
