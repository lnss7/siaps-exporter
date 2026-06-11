/**
 * MAIN — processo principal do Electron.
 * Cria a janela e registra os handlers IPC.
 */
import { app, BrowserWindow, ipcMain, shell, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ScrapeOptions } from '../shared/types';
import { executarExportacao, solicitarCancelamento } from './orquestrador';
import { obterClienteOAuth, obterInfoUsuario, deslogar } from '../sheets/auth';
import { abrirBrowser, minimizarJanela, restaurarJanela } from '../scraper/browser';
import { garantirLogin } from '../scraper/login';
import { descobrirMeses } from '../scraper/descobrirMeses';
import { lerCacheMeses, salvarCacheMeses } from './cacheMeses';

const isDev = !app.isPackaged;

// Bloqueia segunda instância — se a gestora abrir o app duas vezes, a segunda
// fecha sozinha e a primeira foca em vez de criar dois orquestradores brigando
// pelo mesmo Chrome profile.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

app.on('second-instance', () => {
  // Alguém tentou abrir uma segunda janela — traz a existente pra frente
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registrarHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registrarHandlers() {
  ipcMain.handle('config:listar-refs', () => {
    const configPath = path.join(__dirname, '../../config/refs.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  });

  ipcMain.handle('app:abrir-url', (_evt, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('scrape:iniciar', async (_evt, opts: ScrapeOptions) => {
    if (!mainWindow) throw new Error('Janela principal não disponível');
    await executarExportacao(opts, mainWindow);
  });

  ipcMain.handle('scrape:cancelar', () => {
    solicitarCancelamento();
  });

  ipcMain.handle('auth:login', async () => {
    const client = await obterClienteOAuth();
    const info = await obterInfoUsuario(client);
    return info;
  });

  ipcMain.handle('auth:deslogar', () => {
    deslogar();
  });

  ipcMain.handle('meses:obter', () => {
    return lerCacheMeses();
  });

  ipcMain.handle('meses:descobrir', async () => {
    if (!mainWindow) throw new Error('Janela principal não disponível');
    const configPath = path.join(__dirname, '../../config/refs.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const primeiroSetor = Object.values(config.setores)[0] as any;
    const primeiraRef = primeiroSetor.referencias[0];
    const refUrl = primeiraRef.url as string;

    const handle = await abrirBrowser();
    try {
      mainWindow.webContents.send('meses:status', { fase: 'aguardando-login' });
      await restaurarJanela(handle);
      await garantirLogin(handle.page, refUrl);
      await minimizarJanela(handle);

      mainWindow.webContents.send('meses:status', { fase: 'descobrindo' });
      const meses = await descobrirMeses(handle.page, refUrl);
      const cache = salvarCacheMeses(meses);
      mainWindow.webContents.send('meses:status', { fase: 'concluido' });
      return cache;
    } finally {
      await handle.context.close().catch(() => {});
    }
  });
}
