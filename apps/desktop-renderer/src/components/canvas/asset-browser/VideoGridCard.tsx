import React, { useCallback, useRef } from 'react';

export interface VideoGridCardProps {
  src: string;
  className?: string;
}

/** Video card that auto-plays on hover */
export function VideoGridCard({ src, className }: VideoGridCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => {/* ignore */});
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

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
    />
  );
}
