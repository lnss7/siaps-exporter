/**
 * LOGIN — espera o login humano no SIAPS.
 *
 * Estratégia: abre o portal de login (NÃO a URL do indicador) pra evitar
 * mostrar a página 404 do SIAPS quando a sessão expirou. O usuário loga e
 * navega até a tela do indicador; o app só observa a URL.
 *
 * Não armazena senha. Depende da sessão persistente no .chrome-profile/.
 */
import { Page } from 'playwright';

const TIMEOUT_LOGIN_MS = 600_000; // 10 minutos pro humano logar
// Raiz do SIAPS: se não estiver logada, o próprio SIAPS redireciona pro
// fluxo de login do gov; se estiver, cai na home.
const PORTAL_LOGIN_URL = 'https://acesso-egestoraps.saude.gov.br/login';

/**
 * Garante que a página esteja na URL alvo (logado).
 * Sempre começa pelo portal de login — se a sessão ainda estiver válida e
 * o portal redirecionar direto pro indicador, retorna na hora.
 */
export async function garantirLogin(page: Page, urlAlvo: string): Promise<void> {
  console.log('[login] Abrindo portal de login do SIAPS...');

  try {
    await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } catch {}

  await page.waitForTimeout(2_000);

  // Caso raro: portal redirecionou direto pro indicador (sessão válida + sorte).
  if (paginaJaEstaNaUrl(page, urlAlvo)) {
    console.log('[login] ✅ Sessão válida — já no indicador.');
    return;
  }

  console.log('[login] 👉 Faça o login e navegue até a tela do indicador.');
  console.log(`[login] ⏳ Aguardando URL: ${urlAlvo}`);

  // Polling simples: dorme 3s, checa URL, repete. Sem listeners do Playwright
  // (que vazam memória se acumulados em loop por minutos).
  const POLL_INTERVAL_MS = 3_000;
  const deadline = Date.now() + TIMEOUT_LOGIN_MS;
  while (!paginaJaEstaNaUrl(page, urlAlvo)) {
    if (Date.now() > deadline) {
      throw new Error(`Timeout: login não detectado em ${TIMEOUT_LOGIN_MS / 60_000} minutos`);
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  console.log('[login] ✅ Indicador carregado.');
}

function paginaJaEstaNaUrl(page: Page, urlAlvo: string): boolean {
  return page.url().includes(urlAlvo);
}
