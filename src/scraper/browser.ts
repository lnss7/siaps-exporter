/**
 * BROWSER — abre Chrome persistente com sessão salva.
 *
 * Usa um perfil em .chrome-profile/ pra manter o login entre execuções.
 * O Chrome abre em modo visível (headless: false) porque o SIAPS exige
 * login humano interativo.
 */
import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Detecta Electron (sem quebrar quando importado fora dele, ex: tsx scripts).
// Em prod o profile vai pra `userData` (writable); em dev/test fica no repo.
function obterUserDataDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'chrome-profile');
  } catch {
    /* não está em Electron */
  }
  // Fallback dev (tsx): pasta do repo
  const repoRoot = path.join(__dirname, '../..');
  if (fs.existsSync(repoRoot)) return path.join(repoRoot, '.chrome-profile');
  return path.join(os.tmpdir(), 'siaps-exporter-chrome-profile');
}

const USER_DATA_DIR = obterUserDataDir();

export interface BrowserHandle {
  context: BrowserContext;
  page: Page;
}

/**
 * Apaga diretórios de cache do Chrome se acima de `limiteMb`.
 *
 * Por que: o Chrome guarda cache de assets HTTP (Cache/), bytecode JS (Code Cache/)
 * e GPU (GPUCache/) que crescem indefinidamente. Em 6 meses passa de 1GB.
 * Nada disso é login/cookie/preferência — Chrome reconstrói tudo sob demanda.
 *
 * Roda no startup. Usa um limite (default 200MB) pra não apagar toda vez —
 * cache vazio também tem custo (Chrome rebaixa páginas mais devagar).
 */
function limparCacheChromeSeGrande(limiteMb = 200): void {
  if (!fs.existsSync(USER_DATA_DIR)) return;

  const dirsCache = [
    path.join(USER_DATA_DIR, 'Default', 'Cache'),
    path.join(USER_DATA_DIR, 'Default', 'Code Cache'),
    path.join(USER_DATA_DIR, 'Default', 'GPUCache'),
    path.join(USER_DATA_DIR, 'Default', 'DawnGraphiteCache'),
    path.join(USER_DATA_DIR, 'Default', 'DawnWebGPUCache'),
    path.join(USER_DATA_DIR, 'Default', 'Service Worker', 'CacheStorage'),
  ];

  let totalBytes = 0;
  for (const d of dirsCache) {
    totalBytes += tamanhoDir(d);
  }
  const totalMb = totalBytes / (1024 * 1024);

  if (totalMb < limiteMb) return;

  console.log(
    `[browser] 🧹 Cache do Chrome em ${totalMb.toFixed(0)}MB (>limite ${limiteMb}MB), limpando...`,
  );
  for (const d of dirsCache) {
    try {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[browser] ⚠️  Falha ao limpar ${path.basename(d)}:`, (err as Error).message);
    }
  }
}

function tamanhoDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += tamanhoDir(p);
      } else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* arquivo pode ter sido removido entre listdir e stat */
        }
      }
    }
  } catch {
    /* sem permissão ou dir sumiu */
  }
  return total;
}

/**
 * Limpa resíduos da execução anterior caso o app tenha crashado/sido morto.
 *
 * 1. Locks de processo (Singleton*) — se o Chrome anterior morreu mal, eles
 *    ficam órfãos e o próximo launch trava em "Chrome is already running".
 *    São symlinks no macOS/Linux e arquivos no Windows; tratamos os dois casos.
 *
 * 2. Flag de crash no Preferences — se exit_type for "Crashed", o Chrome
 *    mostra a barrinha "O Chrome não foi encerrado corretamente. Restaurar?"
 *    Forçamos exit_type=Normal antes de abrir pra suprimir esse popup.
 */
function limparResiduosDePerfil(): void {
  if (!fs.existsSync(USER_DATA_DIR)) return;

  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const nome of locks) {
    const arq = path.join(USER_DATA_DIR, nome);
    try {
      // lstat (não stat) pra pegar symlinks sem dereferenciar
      if (fs.lstatSync(arq, { throwIfNoEntry: false })) {
        fs.unlinkSync(arq);
      }
    } catch {
      /* já não existe ou sem permissão — segue o jogo */
    }
  }

  // Suprime o popup "Restore tabs" / "Chrome didn't shut down correctly"
  const prefsPath = path.join(USER_DATA_DIR, 'Default', 'Preferences');
  if (fs.existsSync(prefsPath)) {
    try {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      const profile = (prefs.profile ??= {});
      if (profile.exit_type !== 'Normal' || profile.exited_cleanly !== true) {
        profile.exit_type = 'Normal';
        profile.exited_cleanly = true;
        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
      }
    } catch {
      /* Preferences pode estar corrompido — Chrome se vira na próxima */
    }
  }
}

export async function abrirBrowser(): Promise<BrowserHandle> {
  limparResiduosDePerfil();
  limparCacheChromeSeGrande();

  console.log('[browser] Abrindo Chrome com sessão persistente...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    viewport: null,
    acceptDownloads: true,
  });

  // Auto-aceita beforeunload/confirm/alert. Sem isso, Playwright dispensa
  // os dialogs por padrão e bloqueia a navegação na página de 404 do SIAPS.
  context.on('page', (p) => {
    p.on('dialog', (d) => d.accept().catch(() => {}));
  });

  // Abre uma aba nova e fecha as restauradas da sessão anterior — elas
  // podem estar em página de erro com handlers de beforeunload travando tudo.
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  for (const p of context.pages()) {
    if (p !== page) await p.close({ runBeforeUnload: false }).catch(() => {});
  }

  return { context, page };
}

/**
 * Minimiza a janela do Chrome via CDP.
 * Mantém o browser vivo (cookies preservados) mas tira a janela da frente.
 * Vai pro dock no macOS / barra de tarefas no Windows.
 */
export async function minimizarJanela(handle: BrowserHandle): Promise<void> {
  try {
    const cdp = await handle.context.newCDPSession(handle.page);
    try {
      const alvo = (await cdp.send('Browser.getWindowForTarget' as any)) as {
        windowId: number;
      };
      await cdp.send('Browser.setWindowBounds' as any, {
        windowId: alvo.windowId,
        bounds: { windowState: 'minimized' },
      });
      console.log('[browser] 👻 Janela minimizada.');
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch (err) {
    console.warn('[browser] ⚠️  Não consegui minimizar:', (err as Error).message);
  }
}

/**
 * Restaura a janela do Chrome (traz pra frente).
 * Usado quando precisa de intervenção humana (ex.: login expirou).
 */
export async function restaurarJanela(handle: BrowserHandle): Promise<void> {
  try {
    const cdp = await handle.context.newCDPSession(handle.page);
    try {
      const alvo = (await cdp.send('Browser.getWindowForTarget' as any)) as {
        windowId: number;
      };
      await cdp.send('Browser.setWindowBounds' as any, {
        windowId: alvo.windowId,
        bounds: { windowState: 'normal' },
      });
      await handle.page.bringToFront();
      console.log('[browser] 🪟 Janela restaurada.');
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch (err) {
    console.warn('[browser] ⚠️  Não consegui restaurar:', (err as Error).message);
  }
}
