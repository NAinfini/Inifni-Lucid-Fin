/**
 * Resolves the two Codex custom providers at runtime from the main-process
 * `settings.json` that Electron writes alongside the LevelDB store. We match
 * by display name ("Codex Team" / "Codex Plus") so the harness keeps working
 * even if the user recreates a provider (which re-issues a new timestamp id).
 *
 * The keychain is keyed by provider id, so id still has to come from
 * settings.json — we just don't hardcode it.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import type { LLMProviderRuntimeConfig } from '@lucid-fin/contracts';

export interface CodexProviderSpec {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'openai-compatible';
  authStyle: 'bearer';
}

interface SettingsProviderRaw {
  id: string;
  name: string;
  baseUrl?: string;
  model?: string;
  isCustom?: boolean;
  hasKey?: boolean;
  protocol?: string;
  authStyle?: string;
}

interface SettingsFile {
  llm?: { providers?: SettingsProviderRaw[] };
}

function getSettingsJsonPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Lucid Fin', 'settings.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Lucid Fin', 'settings.json');
  }
  return path.join(os.homedir(), '.config', 'Lucid Fin', 'settings.json');
}

function loadSettings(): SettingsFile {
  const file = getSettingsJsonPath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `Could not locate Lucid Fin settings.json at ${file}. Launch the app once to create it.`,
    );
  }
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text) as SettingsFile;
}

function findCustomLLMByName(name: string): CodexProviderSpec {
  const settings = loadSettings();
  const p = settings.llm?.providers?.find((x) => x.name === name && x.isCustom);
  if (!p) {
    throw new Error(
      `Provider "${name}" not found in settings.json. ` +
      `Configure it in Settings → Providers first so the keychain key lands.`,
    );
  }
  if (!p.baseUrl || !p.model) {
    throw new Error(`Provider "${name}" is missing baseUrl or model in settings.json.`);
  }
  if (p.protocol && p.protocol !== 'openai-compatible') {
    throw new Error(`Provider "${name}" uses protocol=${p.protocol}, harness expects openai-compatible.`);
  }
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    protocol: 'openai-compatible',
    authStyle: (p.authStyle as 'bearer') ?? 'bearer',
  };
}

let _team: CodexProviderSpec | null = null;
let _plus: CodexProviderSpec | null = null;
let _hiCode: CodexProviderSpec | null = null;

export function getCodexTeam(): CodexProviderSpec {
  _team ??= findCustomLLMByName('Codex Team');
  return _team;
}
export function getCodexPlus(): CodexProviderSpec {
  _plus ??= findCustomLLMByName('Codex Plus');
  return _plus;
}
export function getHiCode(): CodexProviderSpec {
  _hiCode ??= findCustomLLMByName('Hi code');
  return _hiCode;
}
export function getCodexProviders(): CodexProviderSpec[] {
  return [getCodexTeam(), getCodexPlus()];
}

export function toRuntimeConfig(spec: CodexProviderSpec): LLMProviderRuntimeConfig {
  return {
    id: spec.id,
    name: spec.name,
    baseUrl: spec.baseUrl,
    model: spec.model,
    protocol: spec.protocol,
    authStyle: spec.authStyle,
  };
}
