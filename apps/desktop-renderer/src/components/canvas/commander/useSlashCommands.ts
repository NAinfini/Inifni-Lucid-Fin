import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { store } from '../../../store/index.js';
import type { AppDispatch } from '../../../store/index.js';
import {
  newSession,
  addSystemNotice,
  compactLocalContext,
} from '../../../store/slices/commander.js';
import { getAPI } from '../../../utils/api.js';

export interface SlashCommand {
  name: string;
  desc: string;
}

interface UseSlashCommandsOptions {
  t: (key: string) => string;
  input: string;
  setInput: (value: string) => void;
}

export interface UseSlashCommandsReturn {
  slashQuery: string | null;
  slashMenuIndex: number;
  setSlashMenuIndex: React.Dispatch<React.SetStateAction<number>>;
  showSlashMenu: boolean;
  filteredCommands: SlashCommand[];
  slashCommands: SlashCommand[];
  executeSlashCommand: (name: string) => Promise<void>;
  triggerCompact: () => Promise<void>;
}

export function useSlashCommands({
  t,
  input,
  setInput,
}: UseSlashCommandsOptions): UseSlashCommandsReturn {
  const dispatch = useDispatch<AppDispatch>();
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      { name: 'compact', desc: t('commander.slashCommand.compactDesc') },
      { name: 'clear', desc: t('commander.slashCommand.clearDesc') },
      { name: 'context', desc: t('commander.slashCommand.contextDesc') },
      { name: 'status', desc: t('commander.slashCommand.statusDesc') },
      { name: 'help', desc: t('commander.slashCommand.helpDesc') },
    ],
    [t],
  );

  const slashQuery = useMemo(() => {
    if (!input.startsWith('/')) return null;
    return input.slice(1).toLowerCase();
  }, [input]);

  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return [];
    if (slashQuery === '') return slashCommands;
    return slashCommands.filter(
      (cmd) => cmd.name.includes(slashQuery) || cmd.desc.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery, slashCommands]);

  const showSlashMenu = slashQuery !== null && filteredCommands.length > 0;

  // Reset menu index when filtered list changes
  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery]);

  const triggerCompact = useCallback(async () => {
    dispatch(addSystemNotice(t('commander.slashCommand.compacting')));
    // Phase 1: compact local Redux store (truncate old tool results + assistant text)
    dispatch(compactLocalContext());
    // Phase 2: compact backend activeMessages via IPC
    const api = getAPI();
    const canvasId = store.getState().canvas.activeCanvasId;
    if (api?.commander && canvasId) {
      try {
        const result = await api.commander.compact(canvasId) as { freedChars: number; messageCount: number; toolCount: number };
        if (result.freedChars > 0) {
          dispatch(addSystemNotice(
            t('commander.slashCommand.compactResult')
              .replace('{chars}', result.freedChars.toLocaleString())
              .replace('{messages}', String(result.messageCount))
              .replace('{tools}', String(result.toolCount)),
          ));
        } else {
          dispatch(addSystemNotice(t('commander.slashCommand.compactNoopSuggestClear')));
        }
      } catch { /* compact IPC call failed — show noop message as fallback */
        dispatch(addSystemNotice(t('commander.slashCommand.compactNoopSuggestClear')));
      }
    }
  }, [dispatch, t]);

  const executeSlashCommand = useCallback(
    async (cmdName: string) => {
      setInput('');
      switch (cmdName) {
        case 'compact': {
          await triggerCompact();
          break;
        }
        case 'clear':
          dispatch(newSession());
          break;
        case 'status': {
          const msgs = store.getState().commander.messages;
          const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
          dispatch(addSystemNotice(
            t('commander.slashCommand.statusResult')
              .replace('{messages}', String(msgs.length))
              .replace('{chars}', totalChars.toLocaleString()),
          ));
          break;
        }
        case 'context': {
          const msgs = store.getState().commander.messages;
          let uChars = 0, aChars = 0, tcChars = 0, trChars = 0;
          let uCount = 0, aCount = 0, tcCount = 0;
          const toolFreq: Record<string, number> = {};
          // Per-tool token breakdown: args + results
          const toolArgChars: Record<string, number> = {};
          const toolResultChars: Record<string, number> = {};
          for (const m of msgs) {
            const cl = m.content?.length ?? 0;
            if (m.role === 'user') { uChars += cl; uCount++; }
            else { aChars += cl; aCount++; }
            if (m.toolCalls) {
              for (const tc of m.toolCalls) {
                const argLen = JSON.stringify(tc.arguments).length;
                const resLen = tc.result !== undefined ? JSON.stringify(tc.result).length : 0;
                tcChars += argLen;
                trChars += resLen;
                tcCount++;
                toolFreq[tc.name] = (toolFreq[tc.name] ?? 0) + 1;
                toolArgChars[tc.name] = (toolArgChars[tc.name] ?? 0) + argLen;
                toolResultChars[tc.name] = (toolResultChars[tc.name] ?? 0) + resLen;
              }
            }
          }
          const tok = (c: number) => Math.round(c / 4);
          const totalTok = tok(uChars + aChars + tcChars + trChars);
          const budget = store.getState().commander.maxTokens;
          const pctVal = Math.min(100, Math.round((totalTok / budget) * 100));
          const fK = (n: number) => {
            if (n >= 1000) { const v = n / 1000; return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`; }
            return String(n);
          };
          const pctOf = (part: number, whole: number) => whole > 0 ? `${Math.round(part / whole * 100)}%` : '0%';

          const totalCharsAll = uChars + aChars + tcChars + trChars;

          // Top 10 tools by total token usage (args + results)
          const toolTotalChars: Record<string, number> = {};
          for (const name of Object.keys(toolFreq)) {
            toolTotalChars[name] = (toolArgChars[name] ?? 0) + (toolResultChars[name] ?? 0);
          }
          const topBySize = Object.entries(toolTotalChars)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, chars]) => {
              const calls = toolFreq[name];
              const argTok = tok(toolArgChars[name] ?? 0);
              const resTok = tok(toolResultChars[name] ?? 0);
              return `  ${name}: ${fK(tok(chars))} ${t('commander.contextBreakdown.tokens')} (${calls}x) — ${t('commander.contextBreakdown.args')} ${fK(argTok)}, ${t('commander.contextBreakdown.resultsLabel')} ${fK(resTok)}`;
            })
            .join('\n');

          const detail = [
            `${t('commander.contextBreakdown.context')}: ${fK(totalTok)} / ${fK(budget)} ${t('commander.contextBreakdown.tokens')} (${pctVal}%)`,
            ``,
            `${t('commander.contextBreakdown.user')}: ${fK(tok(uChars))} ${t('commander.contextBreakdown.tokens')} (${uCount} ${t('commander.contextBreakdown.msgs')}) — ${pctOf(uChars, totalCharsAll)}`,
            `${t('commander.contextBreakdown.assistant')}: ${fK(tok(aChars))} ${t('commander.contextBreakdown.tokens')} (${aCount} ${t('commander.contextBreakdown.msgs')}) — ${pctOf(aChars, totalCharsAll)}`,
            `${t('commander.contextBreakdown.toolCalls')}: ${fK(tok(tcChars))} ${t('commander.contextBreakdown.tokens')} (${tcCount} ${t('commander.contextBreakdown.calls')}) — ${pctOf(tcChars, totalCharsAll)}`,
            `${t('commander.contextBreakdown.toolResults')}: ${fK(tok(trChars))} ${t('commander.contextBreakdown.tokens')} — ${pctOf(trChars, totalCharsAll)}`,
            ``,
            `${t('commander.contextBreakdown.topToolsBySize')}:`,
            topBySize || `  (${t('commander.contextBreakdown.none')})`,
          ].join('\n');

          dispatch(addSystemNotice(detail));
          break;
        }
        case 'help': {
          const helpLines = slashCommands.map((cmd) => `/${cmd.name} — ${cmd.desc}`).join('\n');
          dispatch(addSystemNotice(`${t('commander.slashCommand.helpTitle')}:\n${helpLines}`));
          break;
        }
        default:
          break;
      }
    },
    [dispatch, t, slashCommands, triggerCompact, setInput],
  );

  return {
    slashQuery,
    slashMenuIndex,
    setSlashMenuIndex,
    showSlashMenu,
    filteredCommands,
    slashCommands,
    executeSlashCommand,
    triggerCompact,
  };
}
