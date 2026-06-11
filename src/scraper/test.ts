/**
 * TEST CLI — Fase 1: testar scraper isoladamente.
 *
 * Uso:
 *   npm run test:scraper -- <refId> [meses] [--debug]
 *
 * Exemplos:
 *   npm run test:scraper -- 110                      → baixa todos os meses do catálogo da ref 110
 *   npm run test:scraper -- 105 Fev-26               → baixa só fevereiro/26 da ref 105 (Diabetes)
 *   npm run test:scraper -- 111 Jul-25,Ago-25 --debug → baixa 2 meses da ref 111 com screenshot em caso de erro
 *
 * Refs estratégicas pra validar a generalização:
 *   105 (Diabetes) — mesmo setor da 110, valida se seletores se repetem
 *   111 (1ª Consulta Odontológica) — outro setor (BUCAL), valida UI entre setores
 *   117 (eMulti) — setor mais novo, possível UI diferente
 */
import * as path from 'path';
import * as fs from 'fs';
import { abrirBrowser } from './browser';
import { garantirLogin } from './login';
import { baixarIndicador, Ref, Mes } from './download';

const CONFIG_PATH = path.join(__dirname, '../../config/refs.json');

const MESES_DISPONIVEIS: Record<string, Mes> = {
  'Jul-25': { label: 'Jul-25', ano: 2025, indice: 7 },
  'Ago-25': { label: 'Ago-25', ano: 2025, indice: 8 },
  'Set-25': { label: 'Set-25', ano: 2025, indice: 9 },
  'Out-25': { label: 'Out-25', ano: 2025, indice: 10 },
  'Nov-25': { label: 'Nov-25', ano: 2025, indice: 11 },
  'Dez-25': { label: 'Dez-25', ano: 2025, indice: 12 },
  'Jan-26': { label: 'Jan-26', ano: 2026, indice: 1 },
  'Fev-26': { label: 'Fev-26', ano: 2026, indice: 2 },
};

function buscarRef(id: number): Ref {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  for (const setor of Object.values(config.setores) as any[]) {
    for (const ref of setor.referencias as Ref[]) {
      if (ref.id === id) return ref;
    }
  }
  throw new Error(`Referência ${id} não encontrada em config/refs.json`);
}

function parseMeses(arg: string | undefined): Mes[] {
  if (!arg) {
    // default: todos os meses do catálogo
    return Object.values(MESES_DISPONIVEIS);
  }
  const labels = arg.split(',').map((s) => s.trim()).filter(Boolean);
  const meses: Mes[] = [];
  for (const label of labels) {
    const mes = MESES_DISPONIVEIS[label];
    if (!mes) {
      const disponiveis = Object.keys(MESES_DISPONIVEIS).join(', ');
      throw new Error(`Mês inválido: "${label}". Disponíveis: ${disponiveis}`);
    }
    meses.push(mes);
  }
  return meses;
}

async function main() {
  const args = process.argv.slice(2);
  const debug = args.includes('--debug');
  const positionals = args.filter((a) => !a.startsWith('--'));

  const refIdRaw = positionals[0];
  if (!refIdRaw) {
    console.error('Uso: npm run test:scraper -- <refId> [meses] [--debug]');
    console.error('Exemplo: npm run test:scraper -- 105 Fev-26');
    process.exit(1);
  }

  const refId = Number(refIdRaw);
  if (Number.isNaN(refId)) {
    throw new Error(`refId inválido: "${refIdRaw}" (precisa ser número)`);
  }

  const ref = buscarRef(refId);
  const meses = parseMeses(positionals[1]);

  console.log(`[test] 🎯 Ref ${ref.id} — ${ref.nome}`);
  console.log(`[test] 📅 ${meses.length} mês(es): ${meses.map((m) => m.label).join(', ')}`);
  if (debug) console.log('[test] 🐛 Modo debug ligado (screenshots em caso de erro)');

  const { context, page } = await abrirBrowser();
  try {
    await garantirLogin(page, ref.url);
    const arquivos = await baixarIndicador(page, ref, meses, { debug });
    console.log(`[test] 🎉 ${arquivos.length} arquivo(s) baixado(s):`);
    arquivos.forEach((a) => console.log(`         ${a}`));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[test] ❌ Erro:', err.message);
  process.exit(1);
});
