/**
 * `commander/state/compactor.ts` — Phase E split-1.
 *
 * Local-context compactor for Commander's in-memory message list. Called
 * from the `compactLocalContext` reducer; mutates `state.messages` in place
 * (the reducer is already under Immer so mutation is safe).
 *
 * Strategy (all applied unconditionally, in order):
 *  1. Mutation tools -> one-line summary, remove tool call entirely.
 *  2. Read/list tools -> merge all calls into ONE deduplicated list.
 *  3. Log-style tools -> paginate to last 20 entries.
 *  4. Remaining large results -> truncate.
 *  5. Old assistant text -> truncate.
 *  6. Still over budget -> drop oldest messages.
 *
 * Pure logic — no Redux or localStorage imports. Extracted verbatim from
 * the original slice so the behavior is bit-for-bit identical.
 */

import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import type { CommanderMessage, CommanderState, CommanderToolCall } from './types.js';

export function compactCommanderMessages(state: CommanderState): void {
  const msgs = state.messages;
  if (msgs.length === 0) return;

  const msgChars = (m: CommanderMessage) => {
    let c = m.content.length;
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        c += JSON.stringify(tc.arguments).length;
        if (tc.result != null) {
          c += typeof tc.result === 'string' ? tc.result.length : JSON.stringify(tc.result).length;
        }
      }
    }
    return c;
  };
  const totalChars = () => state.messages.reduce((s, m) => s + msgChars(m), 0);

  const ctxWindowTokens = state.maxTokens || 200_000;
  const targetChars = Math.floor(ctxWindowTokens * 4 * 0.5);
  if (totalChars() <= targetChars) return;

  // Protect only the last user + last assistant message.
  const protectedIndices = new Set<number>();
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && !protectedIndices.has(i)) {
      protectedIndices.add(i);
    }
    if (msgs[i].role === 'user' && !protectedIndices.has(i)) {
      protectedIndices.add(i);
      break;
    }
  }

  // --- classify tools via typed lookup ---
  const classify = (name: string) => getToolCompactionCategory(name);

  // =================================================================
  // Step 1: Mutation tools -> one-line summary, remove tool call
  // =================================================================
  const summarize = (tc: CommanderToolCall): string => {
    const a = tc.arguments;
    const id = a.id ?? a.nodeId ?? a.snapshotId ?? a.presetId ?? '';
    const status = tc.status === 'error' ? 'FAILED' : 'done';
    const details: string[] = [];
    for (const [k, v] of Object.entries(a)) {
      if (['id', 'nodeId', 'snapshotId', 'presetId'].includes(k)) continue;
      if (v == null) continue;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      if (s.length > 60) continue;
      details.push(`${k}=${s}`);
      if (details.length >= 3) break;
    }
    const d = details.length > 0 ? ` (${details.join(', ')})` : '';
    return `[${status}] ${tc.name}${id ? ` ${id}` : ''}${d}`;
  };

  for (let i = 0; i < msgs.length; i++) {
    if (protectedIndices.has(i) || !msgs[i].toolCalls) continue;
    const summaries: string[] = [];
    msgs[i].toolCalls = msgs[i].toolCalls!.filter((tc) => {
      if (classify(tc.name) === 'mutation' && tc.result !== undefined) {
        summaries.push(summarize(tc));
        return false;
      }
      return true;
    });
    if (summaries.length > 0) {
      const block = summaries.join('\n');
      msgs[i].content = msgs[i].content ? `${msgs[i].content}\n${block}` : block;
    }
  }

  // =================================================================
  // Shared helpers
  // =================================================================
  const RESULT_TRIM_LIMIT = 400;
  const trimValue = (val: unknown, depth: number): unknown => {
    if (depth > 3) return '[…]';
    if (typeof val === 'string') return val.length > 200 ? val.slice(0, 150) + '…' : val;
    if (Array.isArray(val)) {
      if (val.length > 5)
        return [
          ...val.slice(0, 5).map((v) => trimValue(v, depth + 1)),
          `… +${val.length - 5} more`,
        ];
      return val.map((v) => trimValue(v, depth + 1));
    }
    if (val && typeof val === 'object') {
      const r = val as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      let kept = 0;
      for (const [k, v] of Object.entries(r)) {
        out[k] = trimValue(v, depth + 1);
        kept++;
        if (kept >= 8) {
          out['…'] = `+${Object.keys(r).length - kept} fields`;
          break;
        }
      }
      return out;
    }
    return val;
  };

  // =================================================================
  // Step 2: List tools -> merge all calls into ONE deduplicated list
  // =================================================================
  const extractList = (result: unknown): unknown[] | null => {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    // Try .data first, then walk all values
    if (Array.isArray(r.data)) return r.data;
    if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
      for (const v of Object.values(r.data as Record<string, unknown>)) {
        if (Array.isArray(v)) return v;
      }
    }
    for (const v of Object.values(r)) {
      if (Array.isArray(v)) return v;
    }
    return null;
  };
  const itemKey = (item: unknown): string | null => {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    const k = o.id ?? o.hash ?? o.name ?? o.code;
    return k != null ? String(k) : null;
  };
  const isListTool = (n: string) => classify(n) === 'list';
  const isGetTool = (n: string) => {
    const c = classify(n);
    return c === 'get' || c === 'query';
  };
  const isLogTool = (n: string) => classify(n) === 'log';

  // 2a: Merge list-tool results (deduplicated)
  const mergedLists = new Map<string, Map<string, unknown>>();
  const listLocs = new Map<string, Array<{ mi: number; ti: number }>>();

  for (let i = 0; i < msgs.length; i++) {
    if (!msgs[i].toolCalls) continue;
    for (let j = 0; j < msgs[i].toolCalls!.length; j++) {
      const tc = msgs[i].toolCalls![j];
      if (!isListTool(tc.name) || isLogTool(tc.name) || tc.result === undefined) continue;
      if (!listLocs.has(tc.name)) listLocs.set(tc.name, []);
      listLocs.get(tc.name)!.push({ mi: i, ti: j });

      const list = extractList(tc.result);
      if (!list) continue;
      if (!mergedLists.has(tc.name)) mergedLists.set(tc.name, new Map());
      const merged = mergedLists.get(tc.name)!;
      for (const item of list) {
        const k = itemKey(item) || `_idx_${merged.size}`;
        merged.set(k, item);
      }
    }
  }

  for (const [toolName, locations] of listLocs) {
    if (locations.length <= 1 && !mergedLists.has(toolName)) continue;
    const merged = mergedLists.get(toolName);
    if (!merged || merged.size === 0) continue;
    const arr = [...merged.values()];

    const last = locations[locations.length - 1];
    const removeKeys = new Set(locations.slice(0, -1).map((l) => `${l.mi}:${l.ti}`));
    for (let i = 0; i < msgs.length; i++) {
      if (!msgs[i].toolCalls) continue;
      msgs[i].toolCalls = msgs[i].toolCalls!.filter((_, j) => !removeKeys.has(`${i}:${j}`));
    }

    const lastMsg = msgs[last.mi];
    if (lastMsg?.toolCalls) {
      const tc = lastMsg.toolCalls.find((t) => t.name === toolName);
      if (tc) {
        tc.result = { success: true, data: arr.map((v) => trimValue(v, 0)), total: arr.length };
        tc.arguments = {};
      }
    }
  }

  // 2b: Get/read tools -> merge all results per tool name into ONE
  //     deduplicated collection (same strategy as list tools).
  //     e.g. 40 canvas.getNode calls → 1 tool call with merged array of nodes.
  //     Each entity keyed by id; later calls overwrite earlier ones (freshest wins).
  const extractEntity = (result: unknown): unknown => {
    if (!result || typeof result !== 'object') return result;
    const r = result as Record<string, unknown>;
    if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) return r.data;
    return result;
  };

  const mergedGets = new Map<string, Map<string, unknown>>();
  const getLocs = new Map<string, Array<{ mi: number; tcId: string }>>();

  for (let i = 0; i < msgs.length; i++) {
    if (!msgs[i].toolCalls) continue;
    for (const tc of msgs[i].toolCalls!) {
      if (!isGetTool(tc.name) || isLogTool(tc.name) || tc.result === undefined) continue;
      if (!getLocs.has(tc.name)) getLocs.set(tc.name, []);
      getLocs.get(tc.name)!.push({ mi: i, tcId: tc.id });

      const entity = extractEntity(tc.result);
      if (!entity || typeof entity !== 'object') continue;
      const ent = entity as Record<string, unknown>;
      const k = itemKey(ent) || tc.id;

      if (!mergedGets.has(tc.name)) mergedGets.set(tc.name, new Map());
      mergedGets.get(tc.name)!.set(k, ent);
    }
  }

  for (const [toolName, locations] of getLocs) {
    if (locations.length <= 1 && !mergedGets.has(toolName)) continue;
    const merged = mergedGets.get(toolName);
    if (!merged || merged.size === 0) continue;
    const arr = [...merged.values()].map((v) => trimValue(v, 0));

    // Remove all but the last call
    const removeIds = new Set(locations.slice(0, -1).map((l) => l.tcId));
    if (removeIds.size > 0) {
      for (let i = 0; i < msgs.length; i++) {
        if (!msgs[i].toolCalls) continue;
        msgs[i].toolCalls = msgs[i].toolCalls!.filter((tc) => !removeIds.has(tc.id));
      }
    }

    // Replace the last call's result with merged + trimmed collection
    const lastTcId = locations[locations.length - 1].tcId;
    for (const m of msgs) {
      if (!m.toolCalls) continue;
      const tc = m.toolCalls.find((t) => t.id === lastTcId);
      if (tc) {
        tc.result = { success: true, data: arr, total: arr.length };
        tc.arguments = {};
        break;
      }
    }
  }

  // =================================================================
  // Step 3: Log-style tools -> deduplicate calls + paginate to 20
  // =================================================================
  // 3a: Keep only the last call per log tool name
  const logToolCalls = new Map<string, Array<{ mi: number; tcId: string }>>();
  for (let i = 0; i < msgs.length; i++) {
    if (!msgs[i].toolCalls) continue;
    for (const tc of msgs[i].toolCalls!) {
      if (!isLogTool(tc.name) || tc.result === undefined) continue;
      if (!logToolCalls.has(tc.name)) logToolCalls.set(tc.name, []);
      logToolCalls.get(tc.name)!.push({ mi: i, tcId: tc.id });
    }
  }
  for (const [, locs] of logToolCalls) {
    if (locs.length <= 1) continue;
    const removeIds = new Set(locs.slice(0, -1).map((l) => l.tcId));
    for (let i = 0; i < msgs.length; i++) {
      if (!msgs[i].toolCalls) continue;
      msgs[i].toolCalls = msgs[i].toolCalls!.filter((tc) => !removeIds.has(tc.id));
    }
  }

  // 3b: Paginate remaining log tools to last 20 entries + trim each entry
  for (let i = 0; i < msgs.length; i++) {
    if (protectedIndices.has(i) || !msgs[i].toolCalls) continue;
    for (const tc of msgs[i].toolCalls!) {
      if (!isLogTool(tc.name) || tc.result === undefined) continue;
      const list = extractList(tc.result);
      if (!list) continue;
      const trimmed = list.slice(-20).map((entry) => trimValue(entry, 0));
      tc.result = {
        success: true,
        data: trimmed,
        total: list.length,
        showing: Math.min(list.length, 20),
      };
    }
  }

  // =================================================================
  // Step 4: Truncate large results + deeply trim nested objects
  // =================================================================
  for (let i = 0; i < msgs.length; i++) {
    if (protectedIndices.has(i) || !msgs[i].toolCalls) continue;
    for (const tc of msgs[i].toolCalls!) {
      if (tc.result !== undefined) {
        const len = (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)).length;
        if (len > RESULT_TRIM_LIMIT) {
          tc.result = trimValue(tc.result, 0);
        }
      }
      if (JSON.stringify(tc.arguments).length > 200) {
        tc.arguments = { _compacted: true };
      }
    }
  }

  // =================================================================
  // Step 5: Truncate old assistant text
  // =================================================================
  for (let i = 0; i < msgs.length; i++) {
    if (protectedIndices.has(i)) continue;
    if (msgs[i].role === 'assistant' && msgs[i].content.length > 300) {
      msgs[i].content = msgs[i].content.slice(0, 200) + '… [compacted]';
    }
  }

  // =================================================================
  // Step 6: Drop oldest messages if still over budget
  // =================================================================
  let current = totalChars();
  if (current > targetChars) {
    const toRemove: number[] = [];
    for (let i = 0; i < state.messages.length && current > targetChars; i++) {
      if (protectedIndices.has(i)) continue;
      current -= msgChars(state.messages[i]);
      toRemove.push(i);
    }
    if (toRemove.length > 0) {
      const removeSet = new Set(toRemove);
      state.messages = state.messages.filter((_, idx) => !removeSet.has(idx));
    }
  }
}
