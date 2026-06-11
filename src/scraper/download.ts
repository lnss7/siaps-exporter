/**
 * DOWNLOAD — baixa CSVs do SIAPS pra uma referência e lista de meses.
 *
 * Função principal: baixarIndicador(page, ref, meses, opts)
 * Assume que a página JÁ está logada (use login.ts antes).
 *
 * Seletores semânticos: usamos nomes de componentes Angular (app-search-bar,
 * f-competencia-select, app-exportacao-relatorio) que são estáveis entre
 * páginas, em vez de IDs gerados dinamicamente (#pn_id_4_content) ou classes
 * com hash do build (ng-tns-c2421636214-4) que mudam.
 */
import { Page, Locator } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface Ref {
  id: number;
  nome: string;
  url: string;
}

export interface Mes {
  label: string;  // ex: 'Jul-25'
  ano: number;    // ex: 2025
  indice: number; // 1-12 (mês do ano)
}

export interface OpcoesDownload {
  pastaDestino?: string;
  debug?: boolean;
}

/**
 * Erro lançado quando o SIAPS responde com qualquer URL diferente da esperada
 * após uma navegação. Sinal de que a sessão caiu (ou nunca esteve ativa).
 * O orquestrador captura esse erro pra reabrir a janela visível.
 */
export class SessaoSiapsExpirada extends Error {
  constructor(
    public urlAlvo: string,
    public urlAtual: string,
  ) {
    super(`Sessão SIAPS inválida. Esperava ${urlAlvo}, estou em ${urlAtual}`);
    this.name = 'SessaoSiapsExpirada';
  }
}

// Em produção (asar) o __dirname é read-only, então o orquestrador sempre
// passa `pastaDestino` apontando pra `app.getPath('userData')/downloads`.
// Esses defaults só são usados em testes via tsx, ou fallback de segurança.
const DOWNLOAD_DIR_DEFAULT = (() => {
  const repoRoot = path.join(__dirname, '../..');
  // tsx em dev: usa a pasta do repo. Em prod isso aponta pra dentro do asar
  // mas o orquestrador SEMPRE passa pastaDestino, então nunca cai aqui.
  if (fs.existsSync(repoRoot)) return path.join(repoRoot, 'downloads');
  return path.join(os.tmpdir(), 'siaps-exporter-downloads');
})();
const DEBUG_DIR = path.join(DOWNLOAD_DIR_DEFAULT, '_debug');

// `:visible` em todos os botões evita pegar instâncias zumbi que o Angular
// deixa no DOM entre navegações SPA (Playwright tava pegando a primeira do
// querySelectorAll que muitas vezes era a stale, não a ativa).
const SEL = {
  // Botão que abre o painel de seleção de competência
  competenciaBtn: 'app-search-bar f-competencia-select > div > button:visible',
  // Tabs de ano dentro do overlay (mantemos #item-N pois é o ID estável da p-accordion)
  anoTab: (ano: number) =>
    `f-competencia-select p-overlaypanel #item-${ano === 2025 ? 0 : 1}`,
  // Lista de checkboxes de mês dentro do ano ativo (nth() escolhe o índice 1-12)
  mesCheckboxes: 'f-competencia-select .accordion-container.active p-checkbox',
  // Botão "OK" do overlay (única ação primária)
  okBtn: 'f-competencia-select p-overlaypanel button.primary:visible',
  // Botão "Aplicar filtro" da barra de busca
  aplicarFiltroBtn: 'app-search-bar > div > button:visible',
  // Botão "Baixar" — direct child garante que pegamos só o trigger,
  // não os itens do dropdown que ele abre
  baixarBtn: 'app-exportacao-relatorio > button:visible',
  // Overlay de loading do PrimeNG que cobre a tela durante requisições
  blockUI: '.p-blockui-document, [aria-busy="true"][data-pc-name="blockui"]',
  // Item "CSV" no menu que abre depois de clicar em Baixar (busca por texto)
  csvBtn: 'button:has-text("CSV"):visible',
};

/**
 * Baixa todos os meses pedidos de uma referência.
 * Retorna a lista de caminhos dos CSVs salvos.
 */
export async function baixarIndicador(
  page: Page,
  ref: Ref,
  meses: Mes[],
  opts: OpcoesDownload = {},
): Promise<string[]> {
  const pastaDestino = opts.pastaDestino ?? DOWNLOAD_DIR_DEFAULT;
  if (!fs.existsSync(pastaDestino)) fs.mkdirSync(pastaDestino, { recursive: true });

  // Garante que estamos na página da ref (caso o caller ainda não tenha navegado)
  if (!page.url().includes(ref.url)) {
    console.log(`[scraper] Navegando pra ${ref.url}`);
    await page.goto(ref.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1_500); // dá tempo pro SPA fazer redirects internos

    // Se o SIAPS redirecionou pra qualquer outra URL (página de erro, login, home),
    // sinaliza sessão expirada. O orquestrador trata esse caso reabrindo o visível.
    if (!page.url().includes(ref.url)) {
      throw new SessaoSiapsExpirada(ref.url, page.url());
    }
  }

  await esperar(page, SEL.competenciaBtn, 'botão de competência', 30_000);

  // SIAPS carrega com 2026 selecionado por padrão
  let anoAtivo = 2026;
  const arquivosBaixados: string[] = [];

  for (const mes of meses) {
    console.log(`[scraper] 📅 ${ref.id}/${ref.nome} — selecionando ${mes.label}`);
    try {
      anoAtivo = await selecionarMes(page, mes, anoAtivo);
      const arquivo = await baixarCSV(page, ref, mes.label, pastaDestino);
      console.log(`[scraper] ✅ Salvo: ${arquivo}`);
      arquivosBaixados.push(arquivo);
    } catch (err) {
      if (opts.debug) await tirarScreenshotDebug(page, ref, mes.label);
      throw new Error(
        `Falha ao baixar ${ref.nome} ${mes.label}: ${(err as Error).message}`,
      );
    }
  }

  return arquivosBaixados;
}

async function selecionarMes(page: Page, mes: Mes, anoAtivo: number): Promise<number> {
  // Todo click crítico passa pelo clickRobusto: tem retry com espera estável
  // do blockUI + fallback JS pros casos onde o overlay persiste.
  await clickRobusto(page, SEL.competenciaBtn, 'botão de competência');
  await esperar(page, SEL.anoTab(2025), 'tab de ano 2025', 10_000);

  if (mes.ano !== anoAtivo) {
    await clickRobusto(page, SEL.anoTab(mes.ano), `tab de ano ${mes.ano}`);
    await page.waitForTimeout(500); // animação do accordion
  }

  // O painel mostra os 12 meses; pegamos pelo índice (1-12 → nth 0-11).
  // p-checkbox tem handler num child interno, por isso o fallback JS
  // também procura .p-checkbox-box / input internos.
  const checkbox = page.locator(SEL.mesCheckboxes).nth(mes.indice - 1);
  await checkbox.waitFor({ state: 'visible', timeout: 10_000 });
  await clickRobusto(page, checkbox, `checkbox do mês ${mes.label}`);

  await clickRobusto(page, SEL.okBtn, 'botão OK do overlay');
  await esperar(page, SEL.aplicarFiltroBtn, 'botão Aplicar filtro', 10_000);
  await clickRobusto(page, SEL.aplicarFiltroBtn, 'botão Aplicar filtro');

  // Após o filtro, o SIAPS mostra um overlay de loading que bloqueia cliques.
  // Esperamos o overlay sair antes de tentar baixar.
  await esperarLoadingSumir(page);
  await esperar(page, SEL.baixarBtn, 'botão Baixar (após filtro)', 30_000);

  return mes.ano;
}

/**
 * Click robusto pra elementos que podem ser cobertos pelo p-blockui do SIAPS.
 *
 * Aceita seletor string OU Locator (pros casos onde já temos um locator
 * resolvido, tipo `page.locator(...).nth(N)`).
 *
 * Filosofia: SIAPS tem dias muito lentos. Preferimos esperar a errar —
 * demorar é tolerável, dar erro não.
 *
 * Estratégia em 3 níveis:
 *   1. Espera blockUI sumir (estável) e tenta click normal — 60s pra completar
 *   2. Se falhar, espera mais demoradamente (4s estável) e tenta de novo (60s)
 *   3. Último recurso: dispara click via JS no próprio elemento. Pra p-checkbox
 *      do PrimeNG (handler num child), também tenta `.p-checkbox-box` e `input`.
 */
async function clickRobusto(
  page: Page,
  alvo: string | Locator,
  descricao: string,
): Promise<void> {
  const locator = typeof alvo === 'string' ? page.locator(alvo) : alvo;
  await esperarLoadingSumir(page);

  // Tentativa 1: click normal com 60s — dá tempo pro SIAPS terminar requests
  try {
    await locator.click({ timeout: 60_000 });
    return;
  } catch {
    console.warn(`[scraper] ⚠️  click em "${descricao}" bloqueado, tentando de novo...`);
  }

  // Tentativa 2: espera blockUI sumir bem demoradamente (4s estável) e retry
  try {
    await esperarLoadingSumir(page, 180_000, 4_000);
    await locator.click({ timeout: 60_000 });
    return;
  } catch {
    console.warn(`[scraper] ⚠️  click em "${descricao}" ainda bloqueado, fallback JS...`);
  }

  // Tentativa 3: dispara click via JS direto no elemento. Pra p-checkbox o
  // handler real fica no .p-checkbox-box ou no input filho, então tentamos
  // os 3 lugares — o primeiro que disparar handler resolve.
  try {
    await locator.evaluate((el: HTMLElement) => {
      const inner =
        el.querySelector<HTMLElement>('.p-checkbox-box') ??
        el.querySelector<HTMLElement>('input') ??
        null;
      el.click();
      if (inner) inner.click();
    });
    return;
  } catch (err3) {
    throw new Error(
      `Não consegui clicar em "${descricao}" (3 tentativas, incluindo fallback JS): ${(err3 as Error).message}`,
    );
  }
}

/**
 * Espera o overlay de loading do PrimeNG (p-blockui) sair de forma ESTÁVEL.
 *
 * "Estável" = ausente por `estabilidadeMs` seguidos. Isso evita o seguinte race:
 * SIAPS faz vários ciclos curtos de loading e nosso wait pegava um buraco entre
 * eles. Quando tentávamos clicar, o overlay voltava bem no meio da ação.
 *
 * Defaults BEM generosos — SIAPS tem dias horríveis. Só cuspimos erro depois
 * de 5min preso, preferindo esperar a falhar prematuramente.
 */
async function esperarLoadingSumir(
  page: Page,
  timeoutMs = 300_000,
  estabilidadeMs = 2_000,
): Promise<void> {
  try {
    await page.waitForFunction(
      ({ estabilidadeMs }) => {
        const w = window as any;
        const blockUiVisivel = () => {
          const el = document.querySelector(
            '.p-blockui-document, [aria-busy="true"][data-pc-name="blockui"]',
          );
          if (!el) return false;
          return (el as HTMLElement).offsetParent !== null;
        };
        if (blockUiVisivel()) {
          w.__siapsLoadingAusenteDesde = 0;
          return false;
        }
        if (!w.__siapsLoadingAusenteDesde) {
          w.__siapsLoadingAusenteDesde = Date.now();
          return false;
        }
        return Date.now() - w.__siapsLoadingAusenteDesde >= estabilidadeMs;
      },
      { estabilidadeMs },
      { timeout: timeoutMs, polling: 200 },
    );
  } catch {
    throw new Error(
      `Overlay de loading não sumiu (estável por ${estabilidadeMs}ms) em ${timeoutMs / 1000}s — SIAPS pode estar travado`,
    );
  }
}

async function baixarCSV(
  page: Page,
  ref: Ref,
  label: string,
  pastaDestino: string,
): Promise<string> {
  // 5min no waitForEvent — em dias horríveis, refs com muitos dados podem
  // demorar minutos pra gerar o arquivo. Os clicks são robustos por dentro.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300_000 }),
    (async () => {
      await clickRobusto(page, SEL.baixarBtn, 'botão Baixar');
      await esperar(page, SEL.csvBtn, 'botão CSV no menu de exportação', 10_000);
      await clickRobusto(page, SEL.csvBtn, 'botão CSV');
    })(),
  ]);

  const ext = path.extname(download.suggestedFilename()) || '.csv';
  const filePath = path.join(pastaDestino, `indicador-${ref.id}-${label}${ext}`);
  await download.saveAs(filePath);
  return filePath;
}

/**
 * Wrapper de waitForSelector com mensagem de erro humana.
 * Quando algo quebra, sabemos exatamente qual elemento o scraper não achou.
 */
async function esperar(
  page: Page,
  seletor: string,
  descricao: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await page.waitForSelector(seletor, { state: 'visible', timeout: timeoutMs });
  } catch {
    throw new Error(
      `Elemento não encontrado: ${descricao} (seletor: "${seletor}", timeout ${timeoutMs}ms)`,
    );
  }
}

async function tirarScreenshotDebug(page: Page, ref: Ref, label: string): Promise<void> {
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const arquivo = path.join(DEBUG_DIR, `erro-${ref.id}-${label}-${Date.now()}.png`);
  try {
    await page.screenshot({ path: arquivo, fullPage: true });
    console.error(`[scraper] 📸 Screenshot do erro salvo em: ${arquivo}`);
  } catch (e) {
    console.error('[scraper] ⚠️  Não consegui tirar screenshot:', (e as Error).message);
  }
}
