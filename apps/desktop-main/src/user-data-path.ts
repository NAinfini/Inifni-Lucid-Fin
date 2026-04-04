import fs from 'node:fs';
import path from 'node:path';

type AppPathAPI = {
  getPath: (name: 'appData' | 'userData') => string;
  setPath: (name: 'userData', value: string) => void;
};

type FileOps = Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'renameSync'>;

export interface UserDataPaths {
  targetUserDataPath: string;
  legacyUserDataPath: string;
}

export function resolveUserDataPaths(
  appDataPath: string,
  appName = 'Lucid Fin',
  legacyAppName = 'Electron',
): UserDataPaths {
  return {
    targetUserDataPath: path.join(appDataPath, appName),
    legacyUserDataPath: path.join(appDataPath, legacyAppName),
  };
}

export function migrateLegacyUserData(
  fileOps: FileOps,
  paths: UserDataPaths,
): void {
  const { targetUserDataPath, legacyUserDataPath } = paths;
  const targetSettingsPath = path.join(targetUserDataPath, 'settings.json');
  const legacySettingsPath = path.join(legacyUserDataPath, 'settings.json');
  const targetLogsPath = path.join(targetUserDataPath, 'logs');
  const legacyLogsPath = path.join(legacyUserDataPath, 'logs');

  fileOps.mkdirSync(targetUserDataPath, { recursive: true });

  if (!fileOps.existsSync(targetSettingsPath) && fileOps.existsSync(legacySettingsPath)) {
    fileOps.renameSync(legacySettingsPath, targetSettingsPath);
  }

  if (!fileOps.existsSync(targetLogsPath) && fileOps.existsSync(legacyLogsPath)) {
    fileOps.renameSync(legacyLogsPath, targetLogsPath);
  }
}

export function configureUserDataPath(
  appPathAPI: AppPathAPI,
  fileOps: FileOps = fs,
): UserDataPaths {
  const paths = resolveUserDataPaths(appPathAPI.getPath('appData'));
  migrateLegacyUserData(fileOps, paths);
  appPathAPI.setPath('userData', paths.targetUserDataPath);
  return paths;
}
