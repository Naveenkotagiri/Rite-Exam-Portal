import { useEffect, useRef } from 'react';

export default function CameraPreview({ stream, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  if (!stream) return null;
  return <video ref={ref} className={`camera-preview ${className}`} muted playsInline aria-label="Your camera" />;
}
