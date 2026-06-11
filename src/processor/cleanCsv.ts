/**
 * PROCESSOR — FASE 2
 *
 * Lê um CSV baixado do SIAPS e remove as colunas configuradas em refs.json.
 *
 * Uso como biblioteca:
 *   import { limparCsv } from './cleanCsv';
 *   const linhas = await limparCsv('./downloads/ref110.csv');
 */
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../config/refs.json'), 'utf-8')
);

const COLUNAS_REMOVER: string[] = CONFIG.processamento.colunas_para_remover;

export interface ResultadoLimpeza {
  colunas: string[];
  linhas: Record<string, string>[];
  csv: string;
}

/**
 * Remove colunas indesejadas de um CSV.
 * Comparação é case-insensitive e ignora espaços extras.
 */
export function limparCsv(caminhoArquivo: string): ResultadoLimpeza {
  let conteudo = fs.readFileSync(caminhoArquivo, 'utf-8');

  // 1. Remove BOM UTF-8 se houver
  if (conteudo.charCodeAt(0) === 0xfeff) {
    conteudo = conteudo.slice(1);
  }

  // 2. SIAPS antepõe ~17 linhas de metadados (Ministério, filtros, etc.) antes do CSV real.
  //    Procura a primeira linha que parece ser cabeçalho de tabela: muitos `;` ou `,`
  //    e começa com "CNES" (campo padrão SIAPS).
  const linhas = conteudo.split(/\r?\n/);
  let inicioCsv = linhas.findIndex(
    (l) => /^CNES[;,]/i.test(l.trim()) || (l.match(/;/g)?.length ?? 0) >= 4,
  );
  if (inicioCsv === -1) inicioCsv = 0; // CSV bruto sem metadados — usa do começo
  const conteudoCsv = linhas.slice(inicioCsv).join('\n');

  // 3. Detecta separador no cabeçalho real
  const linhaHeader = linhas[inicioCsv] ?? '';
  const semicolons = (linhaHeader.match(/;/g) ?? []).length;
  const commas = (linhaHeader.match(/,/g) ?? []).length;
  const delimitador = semicolons > commas ? ';' : ',';

  const registros = parse(conteudoCsv, {
    columns: true,
    delimiter: delimitador,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (registros.length === 0) {
    throw new Error('CSV vazio ou sem cabeçalho');
  }

  // Normaliza nomes pra comparar
  const normalizar = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const alvos = new Set(COLUNAS_REMOVER.map(normalizar));

  const colunasOriginais = Object.keys(registros[0]);
  const colunasMantidas = colunasOriginais.filter(
    (c) => !alvos.has(normalizar(c))
  );

  const linhasLimpas = registros.map((linha) => {
    const nova: Record<string, string> = {};
    for (const c of colunasMantidas) {
      nova[c] = linha[c];
    }
    return nova;
  });

  const csvLimpo = stringify(linhasLimpas, {
    header: true,
    columns: colunasMantidas,
  });

  console.log(
    `[processor] ${colunasOriginais.length - colunasMantidas.length} coluna(s) removida(s). ` +
    `Restaram ${colunasMantidas.length} colunas e ${linhasLimpas.length} linhas.`
  );

  return {
    colunas: colunasMantidas,
    linhas: linhasLimpas,
    csv: csvLimpo,
  };
}

// Modo CLI pra testar
if (require.main === module) {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error('Uso: tsx src/processor/cleanCsv.ts <caminho-do-csv>');
    process.exit(1);
  }
  const resultado = limparCsv(caminho);
  const saida = caminho.replace(/\.csv$/, '_limpo.csv');
  fs.writeFileSync(saida, resultado.csv);
  console.log(`[processor] ✅ Salvo em: ${saida}`);
}
