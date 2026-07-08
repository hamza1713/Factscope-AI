import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  Tray,
  nativeImage,
  dialog,
} from 'electron';
import path from 'path';
import net from 'net';
import { createServer } from '../server/index';
import { setDbPath } from '../server/db';

// Disable GPU acceleration and sandboxing to prevent "Access is denied" cache errors
// that cause the sandboxed renderer bundle to crash on some Windows environments.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-device-discovery-notifications');

// ─── electron-store (ES module — we use dynamic import) ────────────────────
let store: any = null;

async function getStore() {
  if (!store) {
    const { default: Store } = await import('electron-store');
    store = new Store({
      name: 'factscope-config',
      encryptionKey: 'factscope-ai-secure-key-2024', // basic obfuscation
    });
  }
  return store;
}

// ─── State ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let expressServer: ReturnType<typeof createServer> | null = null;
let actualServerPort = 3001;

// In development, NODE_ENV=development is set explicitly by electron:dev script.
// In preview/build mode (electron:preview), NODE_ENV=production is set by cross-env.
// When packaged by electron-builder, app.isPackaged is true.
const isDev = process.env.NODE_ENV === 'development';

// Helper to find a free port starting from a given port
function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

// ─── Express Server ─────────────────────────────────────────────────────────
async function startExpressServer() {
  const s = await getStore();
  const apiKey = s.get('geminiApiKey', '') as string;

  // Inject API key into process.env so server/index.ts can read it
  if (apiKey) {
    process.env.GEMINI_API_KEY = apiKey;
  }

  // Point the database to the OS user data directory so data persists
  // across app updates and lives in the right OS location:
  //   Windows: %APPDATA%/factscope-ai/
  //   macOS:   ~/Library/Application Support/factscope-ai/
  //   Linux:   ~/.config/factscope-ai/
  const userDataPath = app.getPath('userData');
  setDbPath(userDataPath);

  console.log('[Electron] Finding an available port...');
  actualServerPort = await findFreePort(3001);
  console.log(`[Electron] Selected port: ${actualServerPort}`);

  console.log('[Electron] Starting embedded Express server...');
  expressServer = createServer(actualServerPort);
  console.log(`[Electron] Express server started on port ${actualServerPort}`);
  return expressServer;
}


// ─── Window creation ────────────────────────────────────────────────────────
function createWindow() {
  // Resolve icon path depending on execution context
  let iconPath: string;
  if (app.isPackaged) {
    iconPath = path.join(process.resourcesPath, 'assets', 'icon.png');
  } else {
    // Both dev and preview mode: project root assets/
    // __dirname = dist-electron/electron/ → go up 2 levels
    iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Factscope AI',
    icon: iconPath,
    backgroundColor: '#0a0f1e',
    show: false, // show after ready-to-show to prevent flash
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // security: isolate renderer from Node
      nodeIntegration: false,  // security: no Node in renderer
      webSecurity: true,
      sandbox: false, // needed so preload can use IPC
    },
  });

  // Load the app
  if (isDev) {
    // Development: load from Vite dev server with proxy (hot-reload)
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else if (app.isPackaged) {
    // Packaged production: load from embedded Express server
    mainWindow.loadURL(`http://localhost:${actualServerPort}`);
  } else {
    // Preview mode (electron:preview): load from embedded Express server
    mainWindow.loadURL(`http://localhost:${actualServerPort}`);
    mainWindow.webContents.openDevTools();
  }

  // Show window after it's fully loaded (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    setTimeout(async () => {
      try {
        if (mainWindow) {
          const html = await mainWindow.webContents.executeJavaScript("document.body.innerHTML");
          console.log("=== DOM INNER HTML ===");
          console.log(html);
          console.log("======================");

          const image = await mainWindow.webContents.capturePage();
          const buffer = image.toPNG();
          const fs = require('fs');
          const artifactPath = 'C:\\Users\\Hamza Ali\\.gemini\\antigravity\\brain\\b1179070-ebd8-4e49-8015-af44f518f42f\\screenshot.png';
          fs.writeFileSync(artifactPath, buffer);
          console.log("[Electron] Screenshot saved to:", artifactPath);
        }
      } catch (err) {
        console.error("Failed to get DOM HTML/Screenshot:", err);
      }
    }, 5000);
  });

  // Handle window close — hide to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (process.platform !== 'darwin' && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in the system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    const appUrl = isDev ? 'http://localhost:3000' : 'file://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return mainWindow;
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icon.png')
    : path.join(__dirname, '..', '..', 'assets', 'icon.png');

  let trayIcon: Electron.NativeImage;
  try {
    trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Factscope AI',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.exit(0);
      },
    },
  ]);

  tray.setToolTip('Factscope AI — News Fact Checker');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ─── Application Menu ────────────────────────────────────────────────────────
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow?.webContents.send('open-settings');
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Factscope AI',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About Factscope AI',
              message: 'Factscope AI',
              detail: `Version: ${app.getVersion()}\nAI-powered news fact-checking desktop application.\n\nPowered by Google Gemini AI.`,
              icon: nativeImage.createFromPath(
                app.isPackaged
                  ? path.join(process.resourcesPath, 'assets', 'icon.png')
                  : path.join(__dirname, '..', '..', 'assets', 'icon.png')
              ),
            });
          },
        },
        {
          label: 'Get Gemini API Key',
          click: () => {
            shell.openExternal('https://aistudio.google.com/app/apikey');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
async function registerIpcHandlers() {
  const s = await getStore();

  ipcMain.handle('get-api-key', async () => {
    return s.get('geminiApiKey', null) as string | null;
  });

  ipcMain.handle('set-api-key', async (_event, key: string) => {
    s.set('geminiApiKey', key);
    // Update running process environment so server picks it up immediately
    process.env.GEMINI_API_KEY = key;
    console.log('[Electron] API key updated.');
  });

  ipcMain.handle('clear-api-key', async () => {
    s.delete('geminiApiKey');
    delete process.env.GEMINI_API_KEY;
  });

  ipcMain.handle('is-first-launch', async () => {
    const key = s.get('geminiApiKey', null);
    return !key || (key as string).trim() === '';
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-server-url', () => {
    return `http://localhost:${actualServerPort}`;
  });

  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });
}

// ─── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await registerIpcHandlers();
  await startExpressServer();
  createMenu();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On Windows/Linux, keep the app running in the tray
  // Only quit on macOS when all windows are closed and no tray
  if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Allow the window to close fully on explicit quit
  if (mainWindow) {
    mainWindow.removeAllListeners('close');
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.on('new-window' as any, (event: Event) => {
    event.preventDefault();
  });
});
