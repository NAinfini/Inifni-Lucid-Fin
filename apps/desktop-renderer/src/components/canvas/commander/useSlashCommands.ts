import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { store } from '../../../store/index.js';
import type { AppDispatch } from '../../../store/index.js';
import { addSystemNotice } from '../../../store/slices/commander.js';
import {
  readCommanderTelemetry,
  resetCommanderTelemetry,
} from '../../../commander/service/telemetry.js';
import { getAPI } from '../../../utils/api.js';

export interface SlashCommand {
  name: string;
  label: string;
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
  triggerCompact: (options?: { silent?: boolean }) => Promise<void>;
}

export function useSlashCommands({
  t,
  input,
  setInput,
}: UseSlashCommandsOptions): UseSlashCommandsReturn {
  const dispatch = useDispatch<AppDispatch>();
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const addNotice = useCallback(
    (content: string) => {
      const sessionId = store.getState().commander.activeSessionId;
      if (sessionId) dispatch(addSystemNotice({ sessionId, content }));
    },
    [dispatch],
  );

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        name: 'compact',
        label: t('commander.slashCommand.compact'),
        desc: t('commander.slashCommand.compactDesc'),
      },
      {
        name: 'context',
        label: t('commander.slashCommand.context'),
        desc: t('commander.slashCommand.contextDesc'),
      },
      {
        name: 'status',
        label: t('commander.slashCommand.status'),
        desc: t('commander.slashCommand.statusDesc'),
      },
      {
        name: 'telemetry',
        label: t('commander.slashCommand.telemetry'),
        desc: t('commander.slashCommand.telemetryDesc'),
      },
      {
        name: 'help',
        label: t('commander.slashCommand.help'),
        desc: t('commander.slashCommand.helpDesc'),
      },
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
      (cmd) =>
        cmd.name.includes(slashQuery) ||
        cmd.label.toLowerCase().includes(slashQuery) ||
        cmd.desc.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery, slashCommands]);

  const showSlashMenu = slashQuery !== null && filteredCommands.length > 0;

  // Reset menu index when filtered list changes
  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery]);

  const triggerCompact = useCallback(
    async (options: { silent?: boolean } = {}) => {
      // Compact only the backend's model projection. Redux and SQLite retain the
      // complete, immutable transcript for restart, audit, and later re-projection.
      let backendFreed = 0;
      let backendMsgCount = 0;
      let backendToolCount = 0;
      const api = getAPI();
      const state = store.getState();
      const sessionId = state.commander.activeSessionId;
      const runId = sessionId
        ? state.commanderTimeline.currentRunIdBySessionId[sessionId]
        : undefined;
      let compactError: unknown = null;
      if (api?.commander && runId) {
        try {
          const result = (await api.commander.compact({ runId })) as {
            freedChars: number;
            messageCount: number;
            toolCount: number;
          };
          backendFreed = result.freedChars;
          backendMsgCount = result.messageCount;
          backendToolCount = result.toolCount;
        } catch (error) {
          compactError = error;
        }
      }

      if (options.silent) return;

      if (compactError) {
        addNotice(
          compactError instanceof Error
            ? compactError.message
            : t('commander.slashCommand.compactFailed'),
        );
      } else if (backendFreed > 0) {
        addNotice(
          t('commander.slashCommand.compactResult')
            .replace('{chars}', backendFreed.toLocaleString())
            .replace('{messages}', String(backendMsgCount))
            .replace('{tools}', String(backendToolCount)),
        );
      } else {
        addNotice(t('commander.slashCommand.compactNoop'));
      }
    },
    [addNotice, t],
  );

  const executeSlashCommand = useCallback(
    async (cmdName: string) => {
      setInput('');
      switch (cmdName) {
        case 'compact': {
          await triggerCompact();
          break;
        }
        case 'status': {
          const state = store.getState();
          const msgs =
            state.commander.sessions.find(
              (session) => session.id === state.commander.activeSessionId,
            )?.messages ?? [];
          const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
          addNotice(
            t('commander.slashCommand.statusResult')
              .replace('{messages}', String(msgs.length))
              .replace('{chars}', totalChars.toLocaleString()),
          );
          break;
        }
        case 'context': {
          const state = store.getState();
          const msgs =
            state.commander.sessions.find(
              (session) => session.id === state.commander.activeSessionId,
            )?.messages ?? [];
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
                const argLen = JSON.stringify({
                  summary: tc.summary,
                  details: tc.details,
                }).length;
                const resLen = JSON.stringify({
                  artifacts: tc.artifacts,
                  errorCode: tc.errorCode,
                }).length;
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
          const budget = store.getState().commander.contextWindowTokens;
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

          addNotice(detail);
          break;
        }
        case 'help': {
          const helpLines = slashCommands.map((cmd) => `/${cmd.name} — ${cmd.desc}`).join('\n');
          addNotice(`${t('commander.slashCommand.helpTitle')}:\n${helpLines}`);
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
          addNotice(['**Commander telemetry**', '```', body, '```'].join('\n'));
          resetCommanderTelemetry();
          break;
        }
        default:
          break;
      }
    },
    [addNotice, t, slashCommands, triggerCompact, setInput],
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
