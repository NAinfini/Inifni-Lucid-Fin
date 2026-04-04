import React, { useState, useCallback, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Mic, Music, Zap, Play, Pause, Volume2, Loader2 } from 'lucide-react';
import type { RootState } from '../store/index.js';
import {
  addAudioTrack,
  updateAudioTrack,
  selectAudioTrack,
  setPlayingTrack,
  type AudioTrackType,
} from '../store/slices/audio.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

const VOICE_PROVIDERS = [
  { id: 'elevenlabs-v2', name: 'ElevenLabs' },
  { id: 'openai-tts-1-hd', name: 'OpenAI TTS' },
  { id: 'fish-audio-v1', name: 'Fish Audio' },
];
const MUSIC_PROVIDERS = [
  { id: 'suno-v4', name: 'Suno AI' },
  { id: 'udio-v1', name: 'Udio' },
];
const SFX_PROVIDERS = [{ id: 'stability-audio-v2', name: 'Stability Audio' }];

export function AudioStudio() {
  const dispatch = useDispatch();
  const { tracks, playingId } = useSelector((s: RootState) => s.audio);
  const [activeTab, setActiveTab] = useState<AudioTrackType>('voice');
  const [text, setText] = useState('');
  const [provider, setProvider] = useState('elevenlabs-v2');
  const [loading, setLoading] = useState(false);

  const providers =
    activeTab === 'voice'
      ? VOICE_PROVIDERS
      : activeTab === 'music'
        ? MUSIC_PROVIDERS
        : SFX_PROVIDERS;

  const filteredTracks = tracks.filter((t) => t.type === activeTab);

  const handleTabChange = useCallback((tab: AudioTrackType) => {
    setActiveTab(tab);
    setProvider(
      tab === 'voice' ? 'elevenlabs-v2' : tab === 'music' ? 'suno-v4' : 'stability-audio-v2',
    );
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    const id = crypto.randomUUID();
    dispatch(
      addAudioTrack({
        id,
        sceneId: '',
        type: activeTab,
        provider,
        text,
        assetHash: null,
        duration: 0,
        volume: 1,
        startTime: 0,
        status: 'generating',
        jobId: null,
      }),
    );

    try {
      const api = getAPI();
      if (api?.workflow) {
        const workflowType =
          activeTab === 'voice'
            ? 'tts.generate'
            : activeTab === 'music'
              ? 'music.generate'
              : 'sfx.generate';
        const result = await api.workflow.start({ type: workflowType, prompt: text, provider });
        dispatch(
          updateAudioTrack({
            id,
            data: { status: 'completed', jobId: result.workflowRunId },
          }),
        );
      }
    } catch {
      dispatch(updateAudioTrack({ id, data: { status: 'failed' } }));
    } finally {
      setLoading(false);
    }
  }, [text, provider, activeTab, loading, dispatch]);

  // Listen for completed audio jobs and update assetHash
  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    const unsub = api.job.onComplete((job) => {
      const jobRecord = job as Record<string, unknown>;
      const params = jobRecord.params as Record<string, unknown> | undefined;
      const audioTrackId = params?.audioTrackId as string | undefined;
      if (!audioTrackId) return;
      const result = jobRecord.result as Record<string, unknown> | undefined;
      const assetHash = (result?.assetHash ?? result?.url) as string | undefined;
      if (assetHash) {
        dispatch(updateAudioTrack({ id: audioTrackId, data: { assetHash, status: 'completed' } }));
      }
    });
    return unsub;
  }, [dispatch]);

  const tabConfig = [
    { key: 'voice' as const, icon: Mic, label: t('audio.voice') },
    { key: 'music' as const, icon: Music, label: t('audio.music') },
    { key: 'sfx' as const, icon: Zap, label: t('audio.sfx') },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-card">
        <Volume2 className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t('audio.title')}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-card">
        {tabConfig.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Input panel */}
        <div className="w-96 border-r bg-card/50 flex flex-col p-4 gap-4">
          {/* Provider select */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t('audio.provider')}
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-2 py-1.5 text-sm rounded border bg-background"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Text input */}
          <div className="flex-1 flex flex-col">
            <label className="block text-xs text-muted-foreground mb-1">
              {activeTab === 'voice'
                ? t('audio.dialogueText')
                : activeTab === 'music'
                  ? t('audio.musicPrompt')
                  : t('audio.sfxDescription')}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1 w-full p-3 text-sm rounded border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={
                activeTab === 'voice'
                  ? t('audio.placeholders.voice')
                  : activeTab === 'music'
                    ? t('audio.placeholders.music')
                    : t('audio.placeholders.sfx')
              }
            />
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !text.trim()}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {t('audio.generate')}
          </button>
        </div>

        {/* Results panel */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Volume2 className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">{t('audio.empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTracks.map((track) => (
                <div
                  key={track.id}
                  onClick={() => dispatch(selectAudioTrack(track.id))}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card cursor-pointer hover:border-primary/50"
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      track.status === 'generating'
                        ? 'bg-amber-400 animate-pulse'
                        : track.status === 'completed'
                          ? 'bg-emerald-400'
                          : track.status === 'failed'
                            ? 'bg-destructive'
                            : 'bg-muted-foreground'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{track.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {track.provider} · {track.type}
                    </p>
                  </div>
                  {track.status === 'completed' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch(setPlayingTrack(playingId === track.id ? null : track.id));
                      }}
                      className="p-1.5 rounded hover:bg-muted"
                    >
                      {playingId === track.id ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  {track.status === 'generating' && (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
