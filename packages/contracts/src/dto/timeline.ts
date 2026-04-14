export interface TimelineClip {
  id: string;
  trackId: string;
  assetHash: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  transition?: { type: string; duration: number };
}

export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio' | 'subtitle' | 'title';
  name: string;
  clips: TimelineClip[];
  muted: boolean;
  locked: boolean;
  volume?: number;
}

export interface Timeline {
  tracks: TimelineTrack[];
  totalDuration: number;
  fps: number;
  updatedAt: number;
}
