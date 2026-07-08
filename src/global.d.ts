interface ElectronAPI {
  getApiKey: () => Promise<string | null>;
  setApiKey: (key: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  isFirstLaunch: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
