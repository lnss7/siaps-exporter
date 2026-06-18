/**
 * AUTH — fluxo OAuth 2.0 para apps desktop.
 *
 * Existem DOIS modos, escolhidos automaticamente:
 *
 *  1) Modo Electron (produção e dev do app) — Device Flow / RFC 8628:
 *     App pede um par (device_code, user_code) ao Google, mostra o user_code
 *     pra usuária digitar em google.com/device (em qualquer aparelho), e faz
 *     polling em oauth2.googleapis.com até a autorização completar.
 *     Nenhum servidor local, nenhum redirect de browser, só HTTPS standard
 *     pra googleapis.com — funciona em PC corporativo com firewall pesado.
 *
 *  2) Modo tsx (testes via `npm run test:sheets`):
 *     Sem Electron disponível, cai pro fluxo loopback tradicional: abre o
 *     navegador padrão e sobe um servidor HTTP efêmero em 127.0.0.1 pra
 *     receber o callback. Só funciona em ambiente local permissivo.
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
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const e = require('electron');
  electronApp = e.app ?? null;
  electronSafeStorage = e.safeStorage ?? null;
  electronShell = e.shell ?? null;
} catch {
  /* fora do Electron */
}

// Device Flow só suporta um subconjunto de scopes — `spreadsheets` NÃO está
// na lista oficial. Como o app só CRIA planilhas novas (nunca edita arquivos
// pré-existentes), `drive.file` é suficiente: ele dá permissão completa
// (incluindo via Sheets API) para qualquer arquivo criado por este app.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const CRED_PATH = path.join(__dirname, '../../config/google-credential.json');

const DEVICE_CODE_ENDPOINT = 'https://oauth2.googleapis.com/device/code';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface CredFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

function lerCredenciais(): { clientId: string; clientSecret: string } {
  if (!fs.existsSync(CRED_PATH)) {
    throw new Error(
      `Arquivo de credenciais não encontrado em ${CRED_PATH}.\n` +
        '👉 Baixe o JSON de OAuth (TVs and Limited Input devices) do Google Cloud Console e salve nesse caminho.',
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
 * Info entregue pra UI quando o Device Flow começa, pra mostrar pra usuária.
 */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUrl: string;
  expiraEm: number; // timestamp absoluto em ms
}

export type CallbackDeviceCode = (info: DeviceCodeInfo) => void;

/**
 * Retorna um OAuth2Client autenticado.
 * Se já tem refresh token salvo: usa direto (silencioso).
 * Se token foi revogado/expirado/corrompido: limpa o arquivo e refaz o fluxo.
 * Se nunca logou: dispara o fluxo interativo (Device Flow no Electron, ou
 * navegador padrão + servidor localhost no modo tsx).
 *
 * @param onDeviceCode callback chamado quando o Device Flow inicia e tem o
 *   user_code pra mostrar pra usuária. Só é invocado em modo Electron.
 */
export async function obterClienteOAuth(
  onDeviceCode?: CallbackDeviceCode,
): Promise<OAuth2Client> {
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

  // Em Electron usamos Device Flow (funciona com firewall corporativo).
  // Em tsx caímos no fluxo loopback (rede local permissiva).
  if (electronApp) {
    return await loginInterativoDeviceFlow(clientId, clientSecret, onDeviceCode);
  }
  return await loginInterativoLocalhost(clientId, clientSecret);
}

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Fluxo:
 *  1. POST /device/code → recebe device_code, user_code, verification_url, interval
 *  2. Mostra user_code pra usuária via callback
 *  3. Polling em /token até o Google confirmar a autorização
 *
 * Não depende de servidor local, redirect de browser, ou qualquer comunicação
 * loopback — toda a conversa é HTTPS standard com googleapis.com. Funciona
 * em PC com firewall corporativo que bloqueia loopback.
 */
async function loginInterativoDeviceFlow(
  clientId: string,
  clientSecret: string,
  onDeviceCode?: CallbackDeviceCode,
): Promise<OAuth2Client> {
  console.log('[auth] 🔐 Iniciando OAuth Device Flow...');

  // 1. Pedir device_code
  const inicioResp = await fetch(DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: SCOPES.join(' '),
    }).toString(),
  });

  const inicioRaw = await inicioResp.text();
  let inicioData: any;
  try {
    inicioData = JSON.parse(inicioRaw);
  } catch {
    throw new Error(`Resposta inválida do Google: ${inicioRaw.slice(0, 200)}`);
  }

  if (!inicioResp.ok) {
    // Se a credencial não suporta Device Flow, o Google responde com erro claro
    if (inicioData.error === 'invalid_client' || inicioData.error === 'unauthorized_client') {
      throw new Error(
        'CredencialIncompativel: a credencial OAuth precisa ser do tipo ' +
          '"TVs and Limited Input devices" no Google Cloud Console. ' +
          'Crie uma nova credencial desse tipo e atualize config/google-credential.json.',
      );
    }
    throw new Error(
      `Falha ao iniciar Device Flow (${inicioResp.status}): ${inicioData.error_description || inicioData.error || inicioRaw}`,
    );
  }

  const deviceCode: string = inicioData.device_code;
  const userCode: string = inicioData.user_code;
  // Google retorna `verification_url` (legado) e `verification_uri` (RFC) — aceita ambos
  const verificationUrl: string =
    inicioData.verification_url || inicioData.verification_uri || 'https://www.google.com/device';
  const expiresIn: number = inicioData.expires_in ?? 1800;
  const initialInterval: number = inicioData.interval ?? 5;

  console.log(`[auth] 🔢 user_code=${userCode} | url=${verificationUrl} | expira em ${expiresIn}s`);

  // Notifica a UI pra mostrar o código
  onDeviceCode?.({
    userCode,
    verificationUrl,
    expiraEm: Date.now() + expiresIn * 1000,
  });

  // 2. Polling em /token
  const deadline = Date.now() + expiresIn * 1000;
  let intervaloMs = initialInterval * 1000;

  while (Date.now() < deadline) {
    await sleep(intervaloMs);

    const tokenResp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });

    const tokenData = await tokenResp.json().catch(() => ({}));

    if (tokenResp.ok && tokenData.access_token) {
      const client = new google.auth.OAuth2(clientId, clientSecret);
      const credentials: any = {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        scope: tokenData.scope,
        expiry_date: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
      };
      // Device Flow só retorna refresh_token se o scope incluir offline access,
      // que o Google considera padrão pra esse grant. Salva se vier.
      if (tokenData.refresh_token) credentials.refresh_token = tokenData.refresh_token;

      client.setCredentials(credentials);
      salvarToken(JSON.stringify(credentials));
      console.log('[auth] ✅ Tokens salvos.');
      return client;
    }

    const erro = tokenData.error;
    if (erro === 'authorization_pending') {
      // Usuária ainda não autorizou — continua polling no intervalo atual
      continue;
    }
    if (erro === 'slow_down') {
      // Google pediu pra reduzir frequência — soma 5s ao intervalo (recomendação RFC)
      intervaloMs += 5000;
      continue;
    }
    if (erro === 'access_denied') {
      throw new Error('Você negou o acesso. Tente fazer login de novo.');
    }
    if (erro === 'expired_token') {
      throw new Error('O código expirou antes de ser usado. Tente de novo.');
    }
    // Qualquer outro erro: aborta com mensagem do Google
    throw new Error(tokenData.error_description || erro || 'Falha desconhecida no login');
  }

  throw new Error('Tempo expirado. Tente fazer login de novo.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Login OAuth via navegador padrão + servidor HTTP local (fluxo legado).
 * Usado quando o módulo é importado fora do Electron (tsx, scripts de teste).
 * Não funciona em PC com proxy corporativo bloqueando loopback — por isso o
 * app de produção usa Device Flow.
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
