import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { store } from '../../../store/index.js';
import type { AppDispatch } from '../../../store/index.js';
import {
  newSession,
  addSystemNotice,
  compactLocalContext,
} from '../../../store/slices/commander.js';
import {
  readCommanderTelemetry,
  resetCommanderTelemetry,
} from '../../../commander/service/telemetry.js';
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
      { name: 'telemetry', desc: t('commander.slashCommand.telemetryDesc') },
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

    // Measure chars before Phase 1
    const measureChars = (msgs: typeof msgsBefore) =>
      msgs.reduce((sum, m) => {
        let c = m.content.length;
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            c += JSON.stringify(tc.arguments).length;
            if (tc.result != null) {
              c +=
                typeof tc.result === 'string' ? tc.result.length : JSON.stringify(tc.result).length;
            }
          }
        }
        return sum + c;
      }, 0);
    const msgsBefore = store.getState().commander.messages;
    const charsBefore = measureChars(msgsBefore);

    // Phase 1: compact local Redux store (truncate old tool results + assistant text)
    dispatch(compactLocalContext());

    const msgsAfter = store.getState().commander.messages;
    const charsAfter = measureChars(msgsAfter);
    const localFreed = Math.max(0, charsBefore - charsAfter);

    // Phase 2: compact backend activeMessages via IPC (only works during active session)
    let backendFreed = 0;
    let backendMsgCount = 0;
    let backendToolCount = 0;
    const api = getAPI();
    const canvasId = store.getState().canvas.activeCanvasId;
    if (api?.commander && canvasId) {
      try {
        const result = (await api.commander.compact(canvasId)) as {
          freedChars: number;
          messageCount: number;
          toolCount: number;
        };
        backendFreed = result.freedChars;
        backendMsgCount = result.messageCount;
        backendToolCount = result.toolCount;
      } catch {
        /* IPC call failed — use local results only */
      }
    }

    const totalFreed = localFreed + backendFreed;
    if (totalFreed > 0) {
      // Persist compacted session to SQLite so restart preserves the savings
      const freshState = store.getState() as {
        commander: {
          activeSessionId: string | null;
          sessions: Array<{
            id: string;
            title: string;
            messages: unknown[];
            createdAt: number;
            updatedAt: number;
          }>;
          messages: unknown[];
        };
        canvas: { activeCanvasId: string | null };
      };
      const sid = freshState.commander.activeSessionId;
      if (sid && api?.session) {
        const sess = freshState.commander.sessions.find((s) => s.id === sid);
        if (sess) {
          api.session
            .upsert({
              id: sess.id,
              canvasId: freshState.canvas.activeCanvasId ?? null,
              title: sess.title,
              messages: JSON.stringify(sess.messages),
              createdAt: sess.createdAt,
              updatedAt: sess.updatedAt,
            })
            .catch(() => {});
        }
      }

      dispatch(
        addSystemNotice(
          t('commander.slashCommand.compactResult')
            .replace('{chars}', totalFreed.toLocaleString())
            .replace('{messages}', String(backendMsgCount || msgsAfter.length))
            .replace('{tools}', String(backendToolCount)),
        ),
      );
    } else {
      dispatch(addSystemNotice(t('commander.slashCommand.compactNoopSuggestClear')));
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
          dispatch(
            addSystemNotice(
              t('commander.slashCommand.statusResult')
                .replace('{messages}', String(msgs.length))
                .replace('{chars}', totalChars.toLocaleString()),
            ),
          );
          break;
        }
        case 'context': {
          const msgs = store.getState().commander.messages;
          let uChars = 0,
            aChars = 0,
            tcChars = 0,
            trChars = 0;
          let uCount = 0,
            aCount = 0,
            tcCount = 0;
          const toolFreq: Record<string, number> = {};
          const toolArgChars: Record<string, number> = {};
          const toolResultChars: Record<string, number> = {};
          for (const m of msgs) {
            const cl = m.content?.length ?? 0;
            if (m.role === 'user') {
              uChars += cl;
              uCount++;
            } else {
              aChars += cl;
              aCount++;
            }
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
          const totalCharsAll = uChars + aChars + tcChars + trChars;
          const totalTok = tok(totalCharsAll);
          const budget = store.getState().commander.maxTokens;
          const pctVal = Math.min(100, Math.round((totalTok / budget) * 100));
          const fK = (n: number) => {
            if (n >= 1000) {
              const v = n / 1000;
              return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
            }
            return String(n);
          };
          const pctOf = (part: number) =>
            totalCharsAll > 0 ? Math.round((part / totalCharsAll) * 100) : 0;

          const cb = (key: string) => t(`commander.contextBreakdown.${key}`);

          // === Category breakdown rows ===
          const catRows = [
            {
              label: cb('user'),
              tok: tok(uChars),
              detail: `${uCount} ${cb('msgs')}`,
              pct: pctOf(uChars),
            },
            {
              label: cb('assistant'),
              tok: tok(aChars),
              detail: `${aCount} ${cb('msgs')}`,
              pct: pctOf(aChars),
            },
            {
              label: cb('toolCalls'),
              tok: tok(tcChars),
              detail: `${tcCount} ${cb('calls')}`,
              pct: pctOf(tcChars),
            },
            { label: cb('toolResults'), tok: tok(trChars), detail: '', pct: pctOf(trChars) },
          ];
          const maxCatLabel = Math.max(...catRows.map((r) => r.label.length));
          const catLines = catRows.map((r) => {
            const lbl = r.label.padEnd(maxCatLabel);
            const tokStr = fK(r.tok).padStart(6);
            const pctStr = `${r.pct}%`.padStart(4);
            const det = r.detail ? `  (${r.detail})` : '';
            return `${lbl}  ${tokStr}  ${pctStr}${det}`;
          });

          // === Tool ranking rows ===
          const toolTotalChars: Record<string, number> = {};
          for (const name of Object.keys(toolFreq)) {
            toolTotalChars[name] = (toolArgChars[name] ?? 0) + (toolResultChars[name] ?? 0);
          }
          const topTools = Object.entries(toolTotalChars)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

          let toolSection: string;
          if (topTools.length === 0) {
            toolSection = `(${cb('none')})`;
          } else {
            const maxName = Math.max(...topTools.map(([n]) => n.length));
            toolSection = topTools
              .map(([name, chars]) => {
                const calls = toolFreq[name];
                const argTok = fK(tok(toolArgChars[name] ?? 0));
                const resTok = fK(tok(toolResultChars[name] ?? 0));
                const totalStr = fK(tok(chars)).padStart(6);
                const pctStr = `${pctOf(chars)}%`.padStart(4);
                return `${name.padEnd(maxName)}  ${totalStr}  ${pctStr}  ×${calls}  ${cb('args')} ${argTok} / ${cb('resultsLabel')} ${resTok}`;
              })
              .join('\n');
          }

          const detail = [
            `**${cb('context')}**: ${fK(totalTok)} / ${fK(budget)} tokens (${pctVal}%)`,
            '',
            '```',
            ...catLines,
            '```',
            '',
            `**${cb('topToolsBySize')}**:`,
            '```',
            toolSection,
            '```',
          ].join('\n');

          dispatch(addSystemNotice(detail));
          break;
        }
        case 'help': {
          const helpLines = slashCommands.map((cmd) => `/${cmd.name} — ${cmd.desc}`).join('\n');
          dispatch(addSystemNotice(`${t('commander.slashCommand.helpTitle')}:\n${helpLines}`));
          break;
        }
        case 'telemetry': {
          const telem = readCommanderTelemetry();
          const rows: Array<[string, string | number | null]> = [
            ['parseFailureCount', telem.parseFailureCount],
            ['unknownKindCount', telem.unknownKindCount],
            ['stallWarningCount', telem.stallWarningCount],
            ['llmRetryCount', telem.llmRetryCount],
            ['stepAbortCount', telem.stepAbortCount],
            ['runAbortCount', telem.runAbortCount],
            ['coalescedDeltaCount', telem.coalescedDeltaCount],
            ['flushCount', telem.flushCount],
            ['maxBatchSize', telem.maxBatchSize],
            ['renderLagMsP50', telem.renderLagMsP50 ?? '—'],
            ['renderLagMsP95', telem.renderLagMsP95 ?? '—'],
          ];
          const maxKey = Math.max(...rows.map(([k]) => k.length));
          const body = rows.map(([k, v]) => `${k.padEnd(maxKey)}  ${v}`).join('\n');
          dispatch(addSystemNotice(['**Commander telemetry**', '```', body, '```'].join('\n')));
          resetCommanderTelemetry();
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
