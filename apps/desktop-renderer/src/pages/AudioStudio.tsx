import React, { useState, useCallback, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Mic, Music, Zap, Play, Pause, Volume2, Loader2 } from 'lucide-react';
import { listBuiltinAudioGenerationProviders } from '@lucid-fin/contracts';
import type { RootState } from '../store/index.js';
import {
  addAudioTrack,
  updateAudioTrack,
  selectAudioTrack,
  setPlayingTrack,
  type AudioTrackType,
} from '../store/slices/audio.js';
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

const VOICE_PROVIDERS = listBuiltinAudioGenerationProviders('voice');
const MUSIC_PROVIDERS = listBuiltinAudioGenerationProviders('music');
const SFX_PROVIDERS = listBuiltinAudioGenerationProviders('sfx');

function getDefaultProvider(type: AudioTrackType): string {
  const providers =
    type === 'voice' ? VOICE_PROVIDERS : type === 'music' ? MUSIC_PROVIDERS : SFX_PROVIDERS;
  return providers[0]?.id ?? '';
}

export function AudioStudio() {
  const dispatch = useDispatch();
  const { tracks, playingId } = useSelector((s: RootState) => s.audio);
  const [activeTab, setActiveTab] = useState<AudioTrackType>('voice');
  const [text, setText] = useState('');
  const [provider, setProvider] = useState(() => getDefaultProvider('voice'));
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
    setProvider(getDefaultProvider(tab));
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
    } catch (error) {
      dispatch(
        addLog({
          level: 'error',
          category: 'audio',
          message: t('audio.generationFailed'),
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
        }),
      );
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
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60 bg-card">
        <Volume2 className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium">{t('audio.title')}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/60 bg-card">
        {tabConfig.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Input panel */}
        <div className="w-80 border-r border-border/60 bg-card/50 flex flex-col p-3 gap-3">
          {/* Provider select */}
          <div>
            <label className="block text-[10px] text-muted-foreground mb-0.5">
              {t('audio.provider')}
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-md border border-border/60 bg-background"
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
            <label className="block text-[10px] text-muted-foreground mb-0.5">
              {activeTab === 'voice'
                ? t('audio.dialogueText')
                : activeTab === 'music'
                  ? t('audio.musicPrompt')
                  : t('audio.sfxDescription')}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1 w-full p-2.5 text-xs rounded-md border border-border/60 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {t('audio.generate')}
          </button>
        </div>

        {/* Results panel */}
        <div className="flex-1 overflow-y-auto p-3">
          {filteredTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Volume2 className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-xs">{t('audio.empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTracks.map((track) => (
                <div
                  key={track.id}
                  onClick={() => dispatch(selectAudioTrack(track.id))}
                  className="flex items-center gap-2 p-2.5 rounded-md border border-border/60 bg-card cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
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
                    <p className="text-xs truncate">{track.text}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {track.provider} · {track.type}
                    </p>
                  </div>
                  {track.status === 'completed' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch(setPlayingTrack(playingId === track.id ? null : track.id));
                      }}
                      className="p-1 rounded-md hover:bg-muted"
                    >
                      {playingId === track.id ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  {track.status === 'generating' && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
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
