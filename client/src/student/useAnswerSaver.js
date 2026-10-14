import { useCallback, useEffect, useRef, useState } from 'react';
import { studentApi, local } from '../api.js';

/**
 * Saves answers to the server shortly after each change, one request at a time.
 * Unsaved answers are also kept in localStorage, so a refresh or a dropped connection loses nothing.
 * Status: 'saved' | 'saving' | 'offline'.
 */
export function useAnswerSaver(token, { onSubmitted, onSessionLost }) {
  const backupKey = `rite_pending_${token.slice(0, 16)}`;
  const pending = useRef(new Map(Object.entries(local.get(backupKey) || {})));
  const inFlight = useRef(null);
  const retryTimer = useRef(null);
  const debounce = useRef(null);
  const [status, setStatus] = useState(pending.current.size ? 'saving' : 'saved');
  const handlers = useRef({ onSubmitted, onSessionLost });
  handlers.current = { onSubmitted, onSessionLost };

  const backup = () => {
    if (pending.current.size) local.set(backupKey, Object.fromEntries(pending.current));
    else local.del(backupKey);
  };

  const send = useCallback(async () => {
    const batch = [...pending.current.entries()];
    pending.current.clear();
    try {
      await studentApi.saveAnswers(token, batch.map(([qid, v]) => ({ questionId: Number(qid), selected: v.selected ?? null, review: Boolean(v.review) })));
      backup();
    } catch (e) {
      for (const [k, v] of batch) if (!pending.current.has(k)) pending.current.set(k, v); // keep newer edits
      backup();
      if (e.status === 409 && e.data?.submitted) handlers.current.onSubmitted('server');
      else if (e.status === 401) handlers.current.onSessionLost();
      throw e;
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves everything pending; resolves when the server has it, rejects if it could not be saved. */
  const flush = useCallback(async () => {
    clearTimeout(debounce.current);
    clearTimeout(retryTimer.current);
    while (inFlight.current) await inFlight.current.catch(() => {});
    if (!pending.current.size) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    inFlight.current = send();
    try {
      await inFlight.current;
    } catch (e) {
      if (e.status === 0 || e.status >= 500) {
        setStatus('offline');
        retryTimer.current = setTimeout(() => flush().catch(() => {}), 3000);
      }
      throw e;
    } finally {
      inFlight.current = null;
    }
    if (pending.current.size) return flush();
    setStatus('saved');
  }, [send]);

  const queue = useCallback((questionId, value) => {
    pending.current.set(String(questionId), value);
    backup();
    setStatus((s) => (s === 'offline' ? s : 'saving'));
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flush().catch(() => {}), 400);
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pending.current.size) flush().catch(() => {});
    const online = () => flush().catch(() => {});
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      clearTimeout(debounce.current);
      clearTimeout(retryTimer.current);
    };
  }, [flush]);

  /** Answers saved locally but not yet on the server (restored after a refresh). */
  const unsaved = useCallback(() => Object.fromEntries(pending.current), []);

  return { queue, flush, status, unsaved };
}
