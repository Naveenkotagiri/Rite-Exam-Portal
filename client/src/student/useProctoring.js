import { useCallback, useEffect, useRef, useState } from 'react';
import { studentApi } from '../api.js';
import {
  startCamera, cameraLive, getStream, cameraErrorMessage, captureJpeg,
  fullscreenSupported, isFullscreen, enterFullscreen,
} from './camera.js';

/**
 * Watches the candidate during the test:
 *  - leaving the window (tab switch, Alt+Tab, minimise) → reported; the server counts it and may auto-submit
 *  - leaving full screen → test is blocked until they return
 *  - camera turned off / unplugged → test is blocked until it is back
 *  - random-interval camera snapshots
 *  - copy, paste and right-click are blocked
 */
export function useProctoring({ token, proctoring, active, onViolation }) {
  const p = proctoring;
  const enforceFs = p.requireFullscreen && fullscreenSupported();
  const [fsNeeded, setFsNeeded] = useState(() => enforceFs && !isFullscreen());
  const [stream, setStream] = useState(() => (cameraLive() ? getStream() : null));
  const [camError, setCamError] = useState('');
  const away = useRef(false);
  const ignoreBlurUntil = useRef(0);
  const violationCb = useRef(onViolation);
  violationCb.current = onViolation;

  const report = useCallback((type, detail = '') => studentApi.event(token, type, detail).catch(() => null), [token]);

  // Leaving the test window
  useEffect(() => {
    if (!active) return undefined;
    // A refresh also hides the page; that is not leaving the test.
    let unloading = false;
    const onBeforeUnload = () => { unloading = true; };
    const leave = (why) => {
      if (unloading || away.current || Date.now() < ignoreBlurUntil.current) return;
      away.current = true;
      report('left_window', why).then((r) => r && violationCb.current(r));
    };
    const back = () => { away.current = false; };
    const onVisibility = () => (document.hidden ? leave('tab_hidden') : back());
    const onBlur = () => leave('window_blur');
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', back);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', back);
    };
  }, [active, report]);

  // Full screen
  useEffect(() => {
    if (!active || !enforceFs) return undefined;
    const onChange = () => {
      const fs = isFullscreen();
      setFsNeeded(!fs);
      if (!fs) report('fullscreen_exit');
    };
    setFsNeeded(!isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [active, enforceFs, report]);

  const returnToFullscreen = useCallback(async () => {
    await enterFullscreen();
    setFsNeeded(!isFullscreen());
  }, []);

  // Camera health
  const hadCamera = useRef(Boolean(stream));
  useEffect(() => {
    if (!active || !p.cameraRequired) return undefined;
    const check = () => {
      if (cameraLive()) return;
      setStream(null);
      if (hadCamera.current) {
        hadCamera.current = false;
        report('camera_off');
      }
    };
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, [active, p.cameraRequired, report]);

  const restartCamera = useCallback(async () => {
    setCamError('');
    ignoreBlurUntil.current = Date.now() + 15_000; // the permission prompt can steal focus
    try {
      setStream(await startCamera());
      hadCamera.current = true;
      report('camera_on');
    } catch (e) {
      setCamError(cameraErrorMessage(e));
    } finally {
      ignoreBlurUntil.current = Date.now() + 1000;
    }
  }, [report]);

  // Random-interval snapshots: first one shortly after start, then interval ±30%.
  useEffect(() => {
    if (!active || !p.cameraRequired) return undefined;
    let timer;
    let stopped = false;
    const schedule = (ms) => {
      timer = setTimeout(async () => {
        const blob = await captureJpeg().catch(() => null);
        if (blob && !stopped) await studentApi.snapshot(token, blob).catch(() => {});
        if (!stopped) schedule(p.snapshotIntervalSec * 1000 * (0.7 + Math.random() * 0.6));
      }, ms);
    };
    schedule(4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, p.cameraRequired, p.snapshotIntervalSec, token]);

  // No copy / paste / right-click
  useEffect(() => {
    if (!active) return undefined;
    const block = (e) => e.preventDefault();
    const events = ['copy', 'cut', 'paste', 'contextmenu', 'dragstart'];
    events.forEach((ev) => document.addEventListener(ev, block));
    return () => events.forEach((ev) => document.removeEventListener(ev, block));
  }, [active]);

  return {
    stream,
    cameraBlocked: p.cameraRequired && !stream,
    camError,
    restartCamera,
    fsNeeded: enforceFs && fsNeeded,
    returnToFullscreen,
  };
}
