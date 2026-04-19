import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, RotateCcw } from 'lucide-react';

export interface WaveformPlayerProps {
  audioUrl: string;
  onReady?: () => void;
  onSeek?: (time: number) => void;
  onFinish?: () => void;
  height?: number;
  waveColor?: string;
  progressColor?: string;
}

export interface WaveformPlayerRef {
  play: () => void;
  pause: () => void;
  seekTo: (progress: number) => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const WaveformPlayer = forwardRef<WaveformPlayerRef, WaveformPlayerProps>(
  ({ audioUrl, onReady, onSeek, onFinish, height = 64, waveColor, progressColor }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const timeDisplayRef = useRef<HTMLSpanElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const [playing, setPlaying] = useState(false);
    const durationRef = useRef(0);
    const rafIdRef = useRef(0);

    // Keep callback refs stable so WaveSurfer is only recreated when
    // audioUrl or visual config changes, not when parent re-renders.
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onSeekRef = useRef(onSeek);
    onSeekRef.current = onSeek;
    const onFinishRef = useRef(onFinish);
    onFinishRef.current = onFinish;

    const updateTimeDisplay = useCallback(() => {
      const el = timeDisplayRef.current;
      const ws = wsRef.current;
      if (el && ws) {
        el.textContent = `${formatTime(ws.getCurrentTime())} / ${formatTime(durationRef.current)}`;
      }
    }, []);

    useImperativeHandle(ref, () => ({
      play: () => {
        const result = wsRef.current?.play();
        if (result && typeof (result as { catch?: unknown }).catch === 'function') {
          (result as Promise<unknown>).catch(() => { /* 404/missing asset: silent */ });
        }
      },
      pause: () => wsRef.current?.pause(),
      seekTo: (progress: number) => wsRef.current?.seekTo(progress),
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        height,
        waveColor: waveColor ?? 'hsl(var(--muted-foreground))',
        progressColor: progressColor ?? 'hsl(var(--primary))',
        cursorColor: 'hsl(var(--primary))',
        cursorWidth: 1,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
      });

      ws.load(audioUrl);

      ws.on('ready', () => {
        durationRef.current = ws.getDuration();
        updateTimeDisplay();
        onReadyRef.current?.();
      });

      // Use RAF-throttled time display updates instead of setState per audio frame
      ws.on('audioprocess', () => {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(updateTimeDisplay);
      });
      ws.on('seeking', () => {
        updateTimeDisplay();
        onSeekRef.current?.(ws.getCurrentTime());
      });
      ws.on('play', () => setPlaying(true));
      ws.on('pause', () => {
        setPlaying(false);
        updateTimeDisplay();
      });
      ws.on('finish', () => {
        setPlaying(false);
        updateTimeDisplay();
        onFinishRef.current?.();
      });

      wsRef.current = ws;

      return () => {
        cancelAnimationFrame(rafIdRef.current);
        ws.destroy();
        wsRef.current = null;
      };
    }, [audioUrl, height, progressColor, updateTimeDisplay, waveColor]);

    const togglePlay = useCallback(() => {
      const result = wsRef.current?.playPause();
      if (result && typeof (result as { catch?: unknown }).catch === 'function') {
        (result as Promise<unknown>).catch(() => { /* 404/missing asset: silent */ });
      }
    }, []);

    const restart = useCallback(() => {
      wsRef.current?.seekTo(0);
      const result = wsRef.current?.play();
      if (result && typeof (result as { catch?: unknown }).catch === 'function') {
        (result as Promise<unknown>).catch(() => { /* 404/missing asset: silent */ });
      }
    }, []);

    return (
      <div className="flex flex-col gap-2 p-3 rounded-lg border bg-card">
        <div ref={containerRef} className="w-full" />
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="p-1.5 rounded hover:bg-muted"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={restart} className="p-1.5 rounded hover:bg-muted" aria-label="Restart">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <span ref={timeDisplayRef} className="text-xs text-muted-foreground font-mono ml-auto">
            00:00 / 00:00
          </span>
        </div>
      </div>
    );
  },
);

WaveformPlayer.displayName = 'WaveformPlayer';
