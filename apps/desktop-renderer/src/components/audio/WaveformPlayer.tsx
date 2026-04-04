import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
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

export const WaveformPlayer = forwardRef<WaveformPlayerRef, WaveformPlayerProps>(
  ({ audioUrl, onReady, onSeek, onFinish, height = 64, waveColor, progressColor }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    useImperativeHandle(ref, () => ({
      play: () => wsRef.current?.play(),
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
        setDuration(ws.getDuration());
        onReady?.();
      });

      ws.on('audioprocess', () => setCurrentTime(ws.getCurrentTime()));
      ws.on('seeking', () => {
        setCurrentTime(ws.getCurrentTime());
        onSeek?.(ws.getCurrentTime());
      });
      ws.on('play', () => setPlaying(true));
      ws.on('pause', () => setPlaying(false));
      ws.on('finish', () => {
        setPlaying(false);
        onFinish?.();
      });

      wsRef.current = ws;

      return () => {
        ws.destroy();
        wsRef.current = null;
      };
    }, [audioUrl, height, waveColor, progressColor]);

    const togglePlay = useCallback(() => {
      wsRef.current?.playPause();
    }, []);

    const restart = useCallback(() => {
      wsRef.current?.seekTo(0);
      wsRef.current?.play();
    }, []);

    const formatTime = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };

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
          <span className="text-xs text-muted-foreground font-mono ml-auto">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    );
  },
);

WaveformPlayer.displayName = 'WaveformPlayer';
