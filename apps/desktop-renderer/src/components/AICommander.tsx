import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { MessageSquare, Send, Trash2, Wrench, CheckCircle, XCircle, Zap } from 'lucide-react';
import type { RootState } from '../store/index.js';
import {
  addMessage,
  appendStream,
  flushStream,
  setLoading,
  clearMessages,
  addToolCall,
  updateToolCall,
  clearToolCalls,
} from '../store/slices/ai.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

const QUICK_ACTIONS: Record<string, string[]> = {
  script: [
    'ai.commander.quickActions.script.breakdown',
    'ai.commander.quickActions.script.extractCharacters',
  ],
  character: ['ai.commander.quickActions.character.generateDescription'],
  orchestrator: [
    'ai.commander.quickActions.orchestrator.generateStoryboard',
    'ai.commander.quickActions.orchestrator.optimizeShot',
  ],
  storyboard: ['ai.commander.quickActions.storyboard.generateVisualDescription'],
};

export function AICommander() {
  const dispatch = useDispatch();
  const {
    messages,
    loading,
    streamBuffer,
    toolCalls,
    contextPage,
    contextSceneId,
    contextSegmentId,
    contextCharacterId,
  } = useSelector((s: RootState) => s.ai);
  const [input, setInput] = useState('');
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to AI stream
  useEffect(() => {
    const api = getAPI();
    if (!api?.ai) return;
    const unsub = api.ai.onStream((chunk: unknown) => {
      if (typeof chunk === 'string') dispatch(appendStream(chunk));
    });
    return unsub;
  }, [dispatch]);

  // Subscribe to ai:event for tool call tracking
  useEffect(() => {
    const api = getAPI();
    if (!api?.ai?.onEvent) return;
    const unsub = api.ai.onEvent((event: Record<string, unknown>) => {
      if (event.type === 'tool_call') {
        dispatch(
          addToolCall({
            id: event.toolCallId as string,
            name: event.toolName as string,
            arguments: (event.arguments ?? {}) as Record<string, unknown>,
          }),
        );
      } else if (event.type === 'tool_result') {
        dispatch(
          updateToolCall({
            id: event.toolCallId as string,
            status: 'success',
            result: event.result,
          }),
        );
      } else if (event.type === 'error' && event.toolCallId) {
        dispatch(
          updateToolCall({
            id: event.toolCallId as string,
            status: 'error',
            error: event.error as string,
          }),
        );
      } else if (event.type === 'done') {
        dispatch(clearToolCalls());
      }
    });
    return unsub;
  }, [dispatch]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamBuffer, toolCalls]);

  // Auto-expand textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get correct scrollHeight
    textarea.style.height = 'auto';

    // Set height to scrollHeight, but not exceeding maxHeight (400px)
    const maxHeight = 400;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Enable scrollbar if content exceeds max
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  const sendText = useCallback(
    async (text: string) => {
      if (!text || loading) return;
      const api = getAPI();
      if (!api?.ai) return;

      const context = {
        page: contextPage ?? undefined,
        sceneId: contextSceneId ?? undefined,
        segmentId: contextSegmentId ?? undefined,
        characterId: contextCharacterId ?? undefined,
      };

      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: text,
        timestamp: Date.now(),
      };
      dispatch(addMessage(userMsg));
      dispatch(setLoading(true));

      try {
        await api.ai.chat(text, context);
        dispatch(flushStream());
      } catch { /* AI request failed — error message dispatched to UI below */
        dispatch(
          addMessage({
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: t('ai.commander.requestFailed'),
            timestamp: Date.now(),
          }),
        );
      } finally {
        dispatch(setLoading(false));
      }
    },
    [loading, dispatch, contextPage, contextSceneId, contextSegmentId, contextCharacterId],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendText(text);
  }, [input, sendText]);

  const handleQuickAction = useCallback(
    (label: string) => {
      sendText(label);
    },
    [sendText],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickActionKeys = contextPage ? (QUICK_ACTIONS[contextPage] ?? []) : [];

  return (
    <aside className="flex flex-col h-full bg-card border-l">
      {/* Header */}
      <div className="flex items-center gap-2 h-8 px-3 border-b text-xs font-medium text-muted-foreground">
        <MessageSquare className="w-3 h-3" />
        {t('ai.commander.title')}
        {contextPage && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
            {contextPage}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => dispatch(clearMessages())}
          className="p-0.5 rounded hover:bg-muted"
          aria-label={t('ai.commander.clearConversation')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !streamBuffer && (
          <div className="text-xs text-muted-foreground text-center mt-8">
            {t('ai.commander.emptyHint')}
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`text-xs ${msg.role === 'user' ? 'text-right' : ''}`}>
            <div
              className={`inline-block max-w-[90%] px-3 py-2 rounded-lg whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {streamBuffer && (
          <div className="text-xs">
            <div className="inline-block max-w-[90%] px-3 py-2 rounded-lg bg-muted text-foreground whitespace-pre-wrap">
              {streamBuffer}
              <span className="animate-pulse">▊</span>
            </div>
          </div>
        )}
        {/* Tool calls */}
        {toolCalls.length > 0 && (
          <div className="text-[10px] border rounded px-2 py-1 bg-muted/50">
            <button
              className="flex items-center gap-1 text-muted-foreground w-full"
              onClick={() => setToolsCollapsed((c) => !c)}
            >
              <Wrench className="w-2.5 h-2.5" />
              <span>
                {t('ai.commander.toolCalls')} ({toolCalls.length})
              </span>
              <span className="ml-auto">{toolsCollapsed ? '▸' : '▾'}</span>
            </button>
            {!toolsCollapsed && (
              <div className="mt-1 space-y-0.5">
                {toolCalls.map((tc) => (
                  <div key={tc.id} className="flex items-center gap-1.5">
                    {tc.status === 'calling' && (
                      <span className="w-2.5 h-2.5 rounded-full border border-primary border-t-transparent animate-spin inline-block" />
                    )}
                    {tc.status === 'success' && (
                      <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                    )}
                    {tc.status === 'error' && <XCircle className="w-2.5 h-2.5 text-destructive" />}
                    <span className="text-foreground">{tc.name}</span>
                    {tc.status === 'error' && tc.error && (
                      <span className="text-destructive truncate">{tc.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-2 space-y-1.5">
        {/* Quick actions */}
        {quickActionKeys.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <Zap className="w-3 h-3 text-muted-foreground self-center" />
            {quickActionKeys.map((key) => {
              const label = t(key);
              return (
                <button
                  key={key}
                  onClick={() => handleQuickAction(label)}
                  disabled={loading}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ai.commander.inputPlaceholder')}
            className="flex-1 px-2 py-1.5 text-xs rounded border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ minHeight: '40px', maxHeight: '400px' }}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="self-end p-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            aria-label={t('ai.commander.send')}
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </aside>
  );
}
