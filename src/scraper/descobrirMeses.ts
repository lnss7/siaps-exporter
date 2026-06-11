/**
 * DESCOBRIR MESES — abre o overlay de competência do SIAPS e lê quais meses
 * estão habilitados em cada ano. Fonte da verdade pra UI.
 *
 * Assume que a página JÁ está logada (use login.ts antes).
 */
import { Page } from 'playwright';
import type { Mes } from '../shared/types';

const NOMES_MES_ABREV = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function rotuloDe(ano: number, indice: number): string {
  return `${NOMES_MES_ABREV[indice - 1]}-${String(ano).slice(-2)}`;
}

// `:visible` evita pegar instâncias zumbi que o Angular deixa no DOM
const SEL = {
  competenciaBtn: 'app-search-bar f-competencia-select > div > button:visible',
  // Esperamos uma tab de ano (#item-0) ficar visível em vez do <p-overlaypanel>
  // — o DOM tem 3 overlays (vários filtros), só o de competência tem #item-N.
  primeiraTabAno: 'f-competencia-select #item-0:visible',
};

/**
 * Espera o overlay de loading do PrimeNG (p-blockui) sair.
 * Se nunca apareceu, retorna na hora. Se apareceu, espera até sumir.
 */
async function esperarLoadingSumir(page: Page, timeoutMs = 60_000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '.p-blockui-document, [aria-busy="true"][data-pc-name="blockui"]',
        );
        if (!el) return true;
        const visible = (el as HTMLElement).offsetParent !== null;
        return !visible;
      },
      { timeout: timeoutMs, polling: 200 },
    );
  } catch {
    throw new Error(
      `Overlay de loading não sumiu em ${timeoutMs / 1000}s — SIAPS pode estar travado`,
    );
  }
}

/**
 * Lê os meses habilitados no overlay de competência da página atual.
 * Funciona pra qualquer ref — usamos a primeira do refs.json como canônica.
 */
export async function descobrirMeses(page: Page, refUrl: string): Promise<Mes[]> {
  console.log('[descobrir] Iniciando descoberta de meses...');

  if (!page.url().includes(refUrl)) {
    await page.goto(refUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1_500);
  }

  await page.waitForSelector(SEL.competenciaBtn, { state: 'visible', timeout: 30_000 });
  // SIAPS mostra um p-blockui durante o carregamento inicial que intercepta cliques
  await esperarLoadingSumir(page);
  await page.click(SEL.competenciaBtn);
  await page.waitForSelector(SEL.primeiraTabAno, { state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500); // animação do accordion

  // Descobre quantas tabs de ano existem (#item-0, #item-1, ...)
  const tabIds: string[] = await page.evaluate(() => {
    const tabs = document.querySelectorAll('f-competencia-select [id^="item-"]');
    return Array.from(tabs).map((t) => t.id);
  });

  console.log(`[descobrir] ${tabIds.length} tab(s) de ano:`, tabIds);

  const meses: Mes[] = [];

  for (const tabId of tabIds) {
    // Garante que esse tab está ativo (alguns ficam fechados por padrão)
    await page.click(`f-competencia-select #${tabId}`).catch(() => {});
    await page.waitForTimeout(400);

    // Lê o ano do header da tab
    const ano = await page.evaluate((id) => {
      const tab = document.getElementById(id);
      if (!tab) return null;
      const text = tab.textContent || '';
      const m = text.match(/20\d{2}/);
      return m ? parseInt(m[0], 10) : null;
    }, tabId);

    if (!ano) {
      console.warn(`[descobrir] Tab ${tabId} sem ano detectável, pulando`);
      continue;
    }

    // Lê os checkboxes do accordion ativo e o estado disabled de cada um.
    // Várias formas possíveis (PrimeNG renderiza diferente conforme versão):
    //   - aria-disabled no p-checkbox
    //   - classe p-disabled / p-checkbox-disabled no próprio cb ou em pais
    //   - input interno disabled
    //   - pointer-events:none / opacity baixa via CSS
    const checkboxes: Array<{
      idx: number;
      disabled: boolean;
      motivos: string[];
      opacity: number;
    }> = await page.evaluate(() => {
      const container = document.querySelector(
        'f-competencia-select .accordion-container.active',
      );
      if (!container) return [];
      const cbs = container.querySelectorAll('p-checkbox');
      return Array.from(cbs).map((cb, idx) => {
        const motivos: string[] = [];

        if (cb.getAttribute('aria-disabled') === 'true') motivos.push('aria-disabled');
        if (cb.classList.contains('p-disabled')) motivos.push('p-disabled');
        if (cb.classList.contains('p-checkbox-disabled')) motivos.push('p-checkbox-disabled');
        if (cb.querySelector('.p-disabled, .p-checkbox-disabled')) motivos.push('child-disabled');
        if (cb.querySelector('input[disabled], input[aria-disabled="true"]'))
          motivos.push('input-disabled');

        // Sobe até 3 níveis pra ver se um ancestral próximo está disabled
        let nivel: Element | null = cb.parentElement;
        for (let i = 0; i < 3 && nivel; i++) {
          if (nivel.classList.contains('p-disabled')) {
            motivos.push(`ancestor-p-disabled-l${i + 1}`);
            break;
          }
          nivel = nivel.parentElement;
        }

        // CSS final aplicado
        const styles = window.getComputedStyle(cb);
        const opacity = parseFloat(styles.opacity);
        if (styles.pointerEvents === 'none') motivos.push('pointer-events-none');
        if (opacity < 0.7) motivos.push(`opacity-${opacity.toFixed(2)}`);

        return { idx, disabled: motivos.length > 0, motivos, opacity };
      });
    });

    const habilitados = checkboxes.filter((c) => !c.disabled);
    console.log(
      `[descobrir] Ano ${ano}: ${checkboxes.length} mes(es) total, ${habilitados.length} habilitado(s)`,
    );
    // Logs detalhados pra iterar caso a detecção esteja errada
    checkboxes.forEach((cb) => {
      const mesNome = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][cb.idx] ?? `?${cb.idx}`;
      console.log(
        `  [${cb.idx}] ${mesNome}/${ano} → ${cb.disabled ? 'DESABILITADO' : 'ok'}  motivos=[${cb.motivos.join(',')}]  opacity=${cb.opacity}`,
      );
    });

    for (const { idx, disabled } of checkboxes) {
      if (!disabled && idx >= 0 && idx < 12) {
        const indice = idx + 1;
        meses.push({ ano, indice, label: rotuloDe(ano, indice) });
      }
    }
  }

  // Fecha o overlay sem aplicar (não queremos marcar nada)
  await page.keyboard.press('Escape').catch(() => {});

  const ordenados = meses.sort(
    (a, b) => a.ano - b.ano || a.indice - b.indice,
  );

  console.log(
    `[descobrir] ✅ ${ordenados.length} meses encontrados:`,
    ordenados.map((m) => m.label).join(', '),
  );

  return ordenados;
}
