/**
 * AUTH — fluxo OAuth 2.0 desktop com loopback localhost.
 *
 * Como funciona:
 *  1. App abre o navegador padrão na URL do Google de consentimento.
 *  2. Usuária loga com a conta dela e autoriza o app.
 *  3. Google redireciona pra http://127.0.0.1:PORTA/callback?code=XXX
 *  4. Servidor HTTP local (efêmero) captura o code e troca por tokens.
 *  5. Refresh token é salvo criptografado via safeStorage do Electron.
 *
 * Em modo de teste (tsx fora do Electron), cai pra fs simples (sem cripto)
 * e abre o browser via `open`/`xdg-open`/`start`.
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
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const e = require('electron');
  electronApp = e.app ?? null;
  electronSafeStorage = e.safeStorage ?? null;
  electronShell = e.shell ?? null;
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
 * Se nunca logou: dispara o fluxo interativo (abre browser).
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

  return await loginInterativo(clientId, clientSecret);
}

async function loginInterativo(
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
