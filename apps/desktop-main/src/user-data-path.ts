import path from 'node:path';

type AppPathAPI = {
  getPath: (name: 'appData' | 'userData') => string;
  setPath: (name: 'userData', value: string) => void;
};

export function resolveUserDataPath(appDataPath: string, appName = 'Lucid Fin'): string {
  return path.join(appDataPath, appName);
}

export function configureUserDataPath(appPathAPI: AppPathAPI): string {
  const userDataPath = resolveUserDataPath(appPathAPI.getPath('appData'));
  appPathAPI.setPath('userData', userDataPath);
  return userDataPath;
}
