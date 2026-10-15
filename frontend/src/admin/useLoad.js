import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data with a loader function; `reload()` fetches again. `loadedAt` is when the shown data arrived. */
export function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);

  const reload = useCallback(async () => {
    const n = ++latest.current;
    try {
      const result = await run();
      if (n !== latest.current) return; // a newer request was started; never show older data over it
      setData(result);
      setLoadedAt(new Date());
      setError('');
    } catch (e) {
      if (n === latest.current) setError(e.message);
    } finally {
      if (n === latest.current) setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { data, error, loading, loadedAt, reload, setData };
}
