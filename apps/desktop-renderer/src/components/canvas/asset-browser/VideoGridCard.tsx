import React, { useCallback, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';

export interface VideoGridCardProps {
  src: string;
  className?: string;
}

/** Video card that auto-plays on hover. Silently falls back to a placeholder
 * if the source 404s or errors (common when assets are missing from disk). */
export function VideoGridCard({ src, className }: VideoGridCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  const handleMouseEnter = useCallback(() => {
    if (!videoRef.current || failed) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch(() => {
      /* 404/missing asset: silent */
    });
  }, [failed]);

  const handleMouseLeave = useCallback(() => {
    if (!videoRef.current || failed) return;
    videoRef.current.pause();
    videoRef.current.currentTime = 0;
  }, [failed]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className ?? ''}`}>
        <VideoOff className="h-4 w-4 text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={src}
      className={className}
      muted
      preload="metadata"
      loop
      playsInline
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onError={() => setFailed(true)}
    />
  );
}
