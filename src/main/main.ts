/**
 * MAIN — processo principal do Electron.
 * Cria a janela e registra os handlers IPC.
 */
import { app, BrowserWindow, ipcMain, shell, Notification, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ScrapeOptions } from '../shared/types';
import { executarExportacao, solicitarCancelamento } from './orquestrador';
import { obterClienteOAuth, obterInfoUsuario, deslogar } from '../sheets/auth';
import { abrirBrowser, minimizarJanela, restaurarJanela } from '../scraper/browser';
import { garantirLogin } from '../scraper/login';
import { descobrirMeses } from '../scraper/descobrirMeses';
import { lerCacheMeses, salvarCacheMeses } from './cacheMeses';
import { autoUpdater } from 'electron-updater';

const isDev = !app.isPackaged;

// Bloqueia segunda instância — se o app for aberto duas vezes, a segunda
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

app.whenReady().then(async () => {
  await detectarESetarProxy();
  registrarHandlers();
  createWindow();
  if (!isDev) inicializarAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Detecta o proxy HTTP do sistema (via stack do Chromium) e seta as env vars
 * HTTPS_PROXY/HTTP_PROXY. A biblioteca googleapis (gaxios) honra essas vars
 * automaticamente — sem isso, chamadas a Sheets/Drive API falhariam com
 * `fetch failed` em PCs corporativos com proxy.
 *
 * Roda uma vez no boot. Se a usuária mudar de rede sem reabrir o app, fica
 * com o proxy antigo — é OK pra esse caso (gestora abre/fecha pra exportar).
 */
async function detectarESetarProxy(): Promise<void> {
  try {
    const proxy = await session.defaultSession.resolveProxy('https://oauth2.googleapis.com');
    if (!proxy || proxy === 'DIRECT') {
      console.log('[proxy] ✅ Conexão direta (sem proxy do sistema)');
      return;
    }
    // Formato típico do Chromium: "PROXY host:port" ou "HTTPS host:port"
    // Pode vir cadeia separada por ';' — pegamos só a primeira opção.
    const match = proxy.match(/^(PROXY|HTTPS|HTTP)\s+([^;\s]+)/i);
    if (!match) {
      console.warn(`[proxy] ⚠️  Formato desconhecido, ignorando: ${proxy}`);
      return;
    }
    const proxyUrl = `http://${match[2]}`;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.HTTP_PROXY = proxyUrl;
    process.env.https_proxy = proxyUrl;
    process.env.http_proxy = proxyUrl;
    console.log(`[proxy] 🔌 Proxy do sistema detectado: ${proxyUrl}`);
  } catch (err) {
    console.warn('[proxy] ⚠️  Falha ao detectar proxy:', (err as Error).message);
  }
}

/**
 * Configura o auto-update via GitHub Releases.
 * Roda só em produção (app empacotado). Em dev, electron-updater não funciona
 * porque não há `app-update.yml` gerado pelo builder.
 *
 * Fluxo:
 *  - App abre → consulta `latest.yml` no GitHub Releases
 *  - Se versão remota > local: baixa em background, sem interromper o uso
 *  - Quando o app for fechado: instala automaticamente; próxima abertura tem a nova versão
 *
 * Erros são logados mas não interrompem o app — atualização é "bom ter", não crítica.
 */
function inicializarAutoUpdate(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] 🔍 Procurando atualização...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] ⬇️  Nova versão ${info.version} disponível, baixando...`);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] ✅ Já está na versão mais recente.');
  });
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] 📦 ${p.percent.toFixed(0)}% baixado (${(p.bytesPerSecond / 1024).toFixed(0)} KB/s)`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] ✅ Versão ${info.version} pronta. Será instalada ao fechar o app.`);
    // Notifica discretamente — instalação acontece sozinha no próximo fechamento
    if (Notification.isSupported() && mainWindow && !mainWindow.isDestroyed()) {
      try {
        new Notification({
          title: '✨ Atualização disponível',
          body: `Versão ${info.version} foi baixada. Será aplicada quando você fechar o app.`,
          silent: true,
        }).show();
      } catch {
        /* silent */
      }
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] ⚠️  Falha ao verificar atualização (não crítico):', err.message);
  });

  // Dispara a primeira verificação. Não bloqueia o boot do app.
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[updater] ⚠️  Verificação inicial falhou:', err.message);
  });
}

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
    // Passa um callback que repassa o device_code pra UI via IPC,
    // pra ela mostrar o modal "vá em google.com/device e digite XYZ".
    const client = await obterClienteOAuth((info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:device-code', info);
      }
    });
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
