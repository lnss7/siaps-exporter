/**
 * AUTH — fluxo OAuth 2.0 para apps desktop.
 *
 * Existem DOIS modos, escolhidos automaticamente:
 *
 *  1) Modo Electron (produção e dev do app):
 *     Abre o consent screen do Google dentro de um BrowserWindow embutido
 *     e intercepta a navegação para `http://127.0.0.1/callback`. Não sobe
 *     servidor local, então NÃO depende de firewall/proxy corporativo
 *     permitir conexões loopback — funciona até em PC de órgão público
 *     com proxy restritivo.
 *
 *  2) Modo tsx (testes via `npm run test:sheets`):
 *     Sem Electron disponível, cai para o fluxo tradicional: abre o
 *     navegador padrão e sobe um servidor HTTP efêmero em 127.0.0.1
 *     pra receber o callback. Só funciona se o ambiente local permitir
 *     loopback (caso típico do mac de dev).
 *
 * O refresh token é salvo criptografado via safeStorage do Electron;
 * em modo tsx cai pra texto plano (uso de dev apenas).
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { URL } from 'url';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

// Detecta contexto Electron sem quebrar quando importado via tsx
let electronApp: any = null;
let electronSafeStorage: any = null;
let electronShell: any = null;
let electronBrowserWindow: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const e = require('electron');
  electronApp = e.app ?? null;
  electronSafeStorage = e.safeStorage ?? null;
  electronShell = e.shell ?? null;
  electronBrowserWindow = e.BrowserWindow ?? null;
} catch {
  /* fora do Electron */
}

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const CRED_PATH = path.join(__dirname, '../../config/google-credential.json');

// Loopback IP redirect — aceito pelo Google pra Desktop OAuth clients sem
// precisar registrar nada no Cloud Console. Como interceptamos a navegação
// no BrowserWindow antes da requisição HTTP sair, o endereço não precisa
// estar realmente respondendo.
const ELECTRON_REDIRECT_URI = 'http://127.0.0.1/callback';

interface CredFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

function lerCredenciais(): { clientId: string; clientSecret: string } {
  if (!fs.existsSync(CRED_PATH)) {
    throw new Error(
      `Arquivo de credenciais não encontrado em ${CRED_PATH}.\n` +
        '👉 Baixe o JSON de OAuth (Desktop app) do Google Cloud Console e salve nesse caminho.',
    );
  }
  const raw = JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8')) as CredFile;
  const cfg = raw.installed ?? raw.web;
  if (!cfg?.client_id || !cfg.client_secret) {
    throw new Error(
      `Credencial mal formada em ${CRED_PATH}: faltando client_id ou client_secret.`,
    );
  }
  return { clientId: cfg.client_id, clientSecret: cfg.client_secret };
}

function getUserDataDir(): string {
  if (electronApp?.getPath) return electronApp.getPath('userData');
  // Fallback fora do Electron (testes via tsx)
  return path.join(os.homedir(), '.siaps-exporter');
}

function getTokenFilePath(): string {
  return path.join(getUserDataDir(), 'google-token.bin');
}

function salvarToken(json: string): void {
  const dir = getUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getTokenFilePath();

  if (electronSafeStorage?.isEncryptionAvailable?.()) {
    const buf = electronSafeStorage.encryptString(json);
    fs.writeFileSync(filePath, buf);
    return;
  }
  console.warn(
    '[auth] ⚠️  safeStorage indisponível — salvando token em texto puro (uso de teste apenas).',
  );
  fs.writeFileSync(filePath, json, 'utf-8');
}

function carregarToken(): string | null {
  const filePath = getTokenFilePath();
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);

  if (electronSafeStorage?.isEncryptionAvailable?.()) {
    try {
      return electronSafeStorage.decryptString(buf);
    } catch {
      // Pode ser arquivo plano de teste anterior
    }
  }
  // Fallback: assume texto plano
  return buf.toString('utf-8');
}

function abrirNoBrowser(url: string): void {
  if (electronShell?.openExternal) {
    electronShell.openExternal(url);
    return;
  }
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.error('[auth] Não consegui abrir o browser automaticamente.');
      console.error('[auth] Abra manualmente:', url);
    }
  });
}

/**
 * Apaga o arquivo de token salvo. Idempotente — não falha se não existe.
 * Usado tanto pelo deslogar() público quanto pela recuperação automática
 * quando o token está corrompido ou foi revogado pelo Google.
 */
function apagarTokenSalvo(): void {
  const filePath = getTokenFilePath();
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.warn('[auth] ⚠️  Falha ao apagar token corrompido:', (err as Error).message);
    }
  }
}

/**
 * Retorna um OAuth2Client autenticado.
 * Se já tem refresh token salvo: usa direto (silencioso).
 * Se token foi revogado/expirado/corrompido: limpa o arquivo e refaz o fluxo.
 * Se nunca logou: dispara o fluxo interativo (BrowserWindow no Electron, ou
 * navegador padrão + servidor localhost no modo tsx).
 */
export async function obterClienteOAuth(): Promise<OAuth2Client> {
  const { clientId, clientSecret } = lerCredenciais();

  const tokenJson = carregarToken();
  if (tokenJson) {
    try {
      const tokens = JSON.parse(tokenJson);
      const client = new google.auth.OAuth2(clientId, clientSecret);
      client.setCredentials(tokens);
      // Força refresh pra validar que o token ainda funciona e tem os scopes certos.
      // Falha aqui = invalid_grant (revogado/expirado), JSON malformado, ou rede.
      await client.getAccessToken();
      return client;
    } catch (err) {
      // Token salvo não serve mais — apaga pra não reusar em execuções futuras.
      // Sem isso, app fica num loop tentando o mesmo refresh token quebrado.
      console.warn(
        '[auth] ⚠️  Token salvo inválido/revogado, refazendo login:',
        (err as Error).message,
      );
      apagarTokenSalvo();
    }
  }

  if (electronBrowserWindow) {
    return await loginInterativoEletron(clientId, clientSecret);
  }
  return await loginInterativoLocalhost(clientId, clientSecret);
}

/**
 * Login OAuth dentro de um BrowserWindow embutido do Electron.
 * Não depende de servidor localhost — intercepta a navegação ao redirect_uri
 * direto pela API do Electron, então funciona mesmo em PC com proxy/firewall
 * corporativo bloqueando conexões loopback.
 */
async function loginInterativoEletron(
  clientId: string,
  clientSecret: string,
): Promise<OAuth2Client> {
  return new Promise((resolve, reject) => {
    const client = new google.auth.OAuth2(clientId, clientSecret, ELECTRON_REDIRECT_URI);
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // garante refresh_token mesmo se já consentiu antes
    });

    const authWindow = new electronBrowserWindow({
      width: 520,
      height: 720,
      title: 'Login Google — SIAPS Exporter',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Partition isolada — não mistura cookies com o resto do app, e a cada
        // login interativo começa limpo (evita "logado no Google numa conta
        // errada" persistindo entre tentativas).
        partition: 'siaps-google-auth',
      },
    });

    let concluido = false;

    const finalizarSucesso = async (code: string) => {
      if (concluido) return;
      concluido = true;
      try {
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);
        salvarToken(JSON.stringify(tokens));
        if (!authWindow.isDestroyed()) authWindow.destroy();
        console.log('[auth] ✅ Tokens salvos.');
        resolve(client);
      } catch (err) {
        if (!authWindow.isDestroyed()) authWindow.destroy();
        reject(err);
      }
    };

    const finalizarFalha = (err: Error) => {
      if (concluido) return;
      concluido = true;
      if (!authWindow.isDestroyed()) authWindow.destroy();
      reject(err);
    };

    const interceptar = (event: { preventDefault: () => void }, url: string): void => {
      // Só interessa o redirect final pro callback. Tudo que for navegação
      // interna do Google (escolher conta, consent screen) passa direto.
      if (!url.startsWith(ELECTRON_REDIRECT_URI)) return;

      event.preventDefault();
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        const erro = parsed.searchParams.get('error');
        if (erro) {
          finalizarFalha(new Error(`OAuth: ${erro}`));
          return;
        }
        if (!code) {
          finalizarFalha(new Error('OAuth: callback sem código de autorização'));
          return;
        }
        finalizarSucesso(code);
      } catch (err) {
        finalizarFalha(err as Error);
      }
    };

    authWindow.webContents.on('will-redirect', interceptar);
    authWindow.webContents.on('will-navigate', interceptar);

    authWindow.on('closed', () => {
      if (!concluido) {
        concluido = true;
        reject(new Error('Janela de login fechada antes de concluir'));
      }
    });

    // Timeout de segurança: 10 minutos pro humano logar
    const timeoutId = setTimeout(
      () => finalizarFalha(new Error('Timeout: login OAuth não completado em 10 minutos')),
      10 * 60 * 1000,
    );
    // Limpa o timer quando concluir (sucesso ou falha) pra não vazar handle
    authWindow.on('closed', () => clearTimeout(timeoutId));

    console.log('[auth] 🌐 Abrindo janela embutida de login Google...');
    authWindow.loadURL(authUrl);
  });
}

/**
 * Login OAuth via navegador padrão + servidor HTTP local (fluxo legado).
 * Usado quando o módulo é importado fora do Electron (tsx, scripts de teste).
 * Não funciona em PC com proxy corporativo bloqueando loopback — por isso o
 * app de produção usa loginInterativoEletron.
 */
async function loginInterativoLocalhost(
  clientId: string,
  clientSecret: string,
): Promise<OAuth2Client> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'string' || !addr) {
        reject(new Error('Falha ao subir servidor de callback'));
        return;
      }
      const port = addr.port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent', // garante refresh_token mesmo se já consentiu antes
      });

      console.log('[auth] 🌐 Abrindo navegador pra autorização...');
      console.log('[auth]    Se não abrir sozinho, cole esta URL:');
      console.log('[auth]   ', authUrl);

      // Timeout de segurança: 10 minutos pro humano logar
      const timeoutId = setTimeout(
        () => {
          server.close();
          reject(new Error('Timeout: login OAuth não completado em 10 minutos'));
        },
        10 * 60 * 1000,
      );

      server.on('request', async (req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '/', redirectUri);
          if (!reqUrl.pathname.startsWith('/callback')) {
            res.statusCode = 404;
            res.end();
            return;
          }

          const code = reqUrl.searchParams.get('code');
          const erro = reqUrl.searchParams.get('error');

          if (erro) {
            responderHtml(res, 400, `<h1>Erro: ${escapeHtml(erro)}</h1>`);
            clearTimeout(timeoutId);
            server.close();
            reject(new Error(`OAuth: ${erro}`));
            return;
          }
          if (!code) {
            responderHtml(res, 400, '<h1>Faltando o código de autorização</h1>');
            return;
          }

          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          salvarToken(JSON.stringify(tokens));

          responderHtml(
            res,
            200,
            `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-align:center;padding:64px 24px;color:#0f172a">
              <div style="font-size:64px">✅</div>
              <h1 style="margin:16px 0 8px">Autorização concluída!</h1>
              <p style="color:#475569">Pode fechar essa aba e voltar pro SIAPS Exporter.</p>
            </div>`,
          );

          clearTimeout(timeoutId);
          server.close();
          console.log('[auth] ✅ Tokens salvos.');
          resolve(client);
        } catch (err) {
          responderHtml(res, 500, '<h1>Erro interno</h1>');
          clearTimeout(timeoutId);
          server.close();
          reject(err);
        }
      });

      server.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      abrirNoBrowser(authUrl);
    });
  });
}

function responderHtml(res: http.ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><body>${body}</body></html>`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Retorna informações do perfil do usuário logado.
 */
export interface InfoUsuario {
  email: string;
  nome: string;
}

export async function obterInfoUsuario(client: OAuth2Client): Promise<InfoUsuario> {
  // Garante que o access_token esteja válido antes de chamar a API
  await client.getAccessToken();
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  return {
    email: data.email ?? '',
    nome: data.given_name ?? data.name ?? data.email?.split('@')[0] ?? '',
  };
}

/**
 * Apaga o token salvo. Próxima chamada a obterClienteOAuth() vai pedir login.
 */
export function deslogar(): void {
  apagarTokenSalvo();
  console.log('[auth] 🚪 Token removido.');
}
