/**
 * Meses (competências) disponíveis pra download.
 *
 * Gerado dinamicamente: do MES_INICIAL até o mês ANTERIOR ao atual
 * (o SIAPS só libera competências completas, então o mês corrente nunca
 * está disponível). Assim, na virada do mês a UI já mostra o novo mês
 * automaticamente, sem precisar editar código.
 *
 * Compartilhado entre UI (mostra os chips) e scraper (resolve label → ano/indice).
 */
import type { Mes } from './types';

const NOMES_MES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

// Primeiro mês que o SIAPS disponibiliza. Se um dia o sistema começar a
// liberar histórico mais antigo (ou mais recente como início), ajustar aqui.
const MES_INICIAL = { ano: 2025, indice: 7 };

function rotuloDe(ano: number, indice: number): string {
  return `${NOMES_MES[indice - 1]}-${String(ano).slice(-2)}`;
}

/**
 * Gera o mapa de meses entre MES_INICIAL e o mês anterior à data passada.
 * Recebe `agora` como parâmetro pra facilitar teste; em produção usa `new Date()`.
 */
export function gerarMesesDisponiveis(agora: Date = new Date()): Record<string, Mes> {
  // Mês alvo = mês anterior ao corrente. Ex.: maio/2026 → abril/2026.
  let anoFim = agora.getFullYear();
  let mesFim = agora.getMonth(); // 0-11, então isso já é "mês anterior" em 1-base
  if (mesFim === 0) {
    mesFim = 12;
    anoFim -= 1;
  }

  const meses: Record<string, Mes> = {};
  let ano = MES_INICIAL.ano;
  let indice = MES_INICIAL.indice;
  while (ano < anoFim || (ano === anoFim && indice <= mesFim)) {
    const label = rotuloDe(ano, indice);
    meses[label] = { label, ano, indice };
    indice += 1;
    if (indice > 12) {
      indice = 1;
      ano += 1;
    }
  }
  return meses;
}

export const MESES_DISPONIVEIS: Record<string, Mes> = gerarMesesDisponiveis();

export const MESES_POR_ANO: Record<number, Mes[]> = (() => {
  const grupos: Record<number, Mes[]> = {};
  for (const m of Object.values(MESES_DISPONIVEIS)) {
    if (!grupos[m.ano]) grupos[m.ano] = [];
    grupos[m.ano].push(m);
  }
  return grupos;
})();
