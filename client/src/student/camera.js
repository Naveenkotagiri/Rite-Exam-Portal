// One camera stream for the whole test, shared by the camera check, the preview and the snapshot timer.

let stream = null;
let video = null;

const cameraSupported = () => Boolean(navigator.mediaDevices?.getUserMedia);

export function cameraLive() {
  return Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled));
}

export function getStream() {
  return stream;
}

export async function startCamera() {
  if (cameraLive()) return stream;
  if (!cameraSupported()) {
    throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video = null;
}

export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was blocked. Click the camera icon in the address bar, choose "Allow", then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Please use a device with a working camera.';
    case 'NotReadableError':
      return 'The camera is being used by another app (for example Zoom or Teams). Close that app and try again.';
    case 'NotSupportedError':
      return 'This browser cannot use the camera. Please use the latest Chrome or Edge, and make sure the link starts with https://.';
    default:
      return 'The camera could not be started. Please try again.';
  }
}

/** Grabs a small JPEG from the live camera, or null if the camera is not ready. */
export async function captureJpeg() {
  if (!cameraLive() || !video || !video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  const w = 320;
  canvas.width = w;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * w);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.6));
}

// ---- Full screen ----

export const fullscreenSupported = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

export async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else el.webkitRequestFullscreen?.();
  } catch { /* the overlay asks again */ }
}

export function exitFullscreen() {
  if (!isFullscreen()) return;
  try {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  } catch { /* ignore */ }
}
