/**
 * TEST CLI — Fase 3: testar Google Sheets isoladamente.
 *
 * Uso:
 *   npm run test:sheets -- <caminho-csv> <setor> <ref> <mes>
 *
 * Exemplo:
 *   npm run test:sheets -- downloads/indicador-110-Fev-26.csv "eSF e eAP" "Mais Acesso" "Fev-26"
 *
 * Sem args → assume os defaults pra ref 110:
 *   downloads/indicador-110-Fev-26.csv → eSF e eAP / Mais Acesso / Fev-26
 *
 * Na primeira execução abre o navegador pra você logar com a conta Google
 * que receberá as planilhas. Token fica salvo pra próximas execuções.
 */
import * as path from 'path';
import * as fs from 'fs';
import { obterClienteOAuth } from './auth';
import { uploadResultado } from './upload';
import { limparCsv } from '../processor/cleanCsv';

interface Args {
  csvPath: string;
  setorNome: string;
  refNome: string;
  mesLabel: string;
}

const CONFIG_PATH = path.join(__dirname, '../../config/refs.json');

interface RefInfo {
  refNome: string;
  setorNome: string;
}

function buscarRefPorId(id: number): RefInfo {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  for (const setor of Object.values(config.setores) as any[]) {
    for (const ref of setor.referencias as { id: number; nome: string }[]) {
      if (ref.id === id) return { refNome: ref.nome, setorNome: setor.nome };
    }
  }
  throw new Error(`Ref ${id} não encontrada em config/refs.json`);
}

/**
 * Extrai refId e mesLabel do nome do arquivo no padrão:
 *   indicador-{refId}-{mesLabel}.csv
 * Ex: "indicador-110-Jan-26.csv" → { refId: 110, mesLabel: "Jan-26" }
 */
function parseNomeArquivo(filename: string): { refId: number; mesLabel: string } | null {
  const base = path.basename(filename, path.extname(filename));
  const m = base.match(/^indicador-(\d+)-(.+)$/);
  if (!m) return null;
  return { refId: Number(m[1]), mesLabel: m[2] };
}

function parseArgs(): Args {
  const a = process.argv.slice(2);

  // Modo 0 args: defaults (ref 110, Fev-26)
  if (a.length === 0) {
    return {
      csvPath: path.join(__dirname, '../../downloads/indicador-110-Fev-26.csv'),
      setorNome: 'eSF e eAP',
      refNome: 'Mais Acesso',
      mesLabel: 'Fev-26',
    };
  }

  // Modo 1 arg (só CSV): infere ref e mês do nome do arquivo
  if (a.length === 1) {
    const csvPath = a[0];
    const parsed = parseNomeArquivo(csvPath);
    if (!parsed) {
      console.error(
        `Não consegui extrair ref/mês do nome "${path.basename(csvPath)}".\n` +
          'Esperado padrão: indicador-{refId}-{mes}.csv (ex: indicador-110-Jan-26.csv)\n' +
          'Ou passe os 4 args: <csv> <setor> <ref> <mes>',
      );
      process.exit(1);
    }
    const { refNome, setorNome } = buscarRefPorId(parsed.refId);
    return { csvPath, setorNome, refNome, mesLabel: parsed.mesLabel };
  }

  // Modo 4 args: tudo explícito
  if (a.length >= 4) {
    return { csvPath: a[0], setorNome: a[1], refNome: a[2], mesLabel: a[3] };
  }

  console.error('Uso:');
  console.error('  npm run test:sheets                    # defaults (ref 110, Fev-26)');
  console.error('  npm run test:sheets -- <csv>           # extrai ref/mês do nome do CSV');
  console.error('  npm run test:sheets -- <csv> <setor> <ref> <mes>  # explícito');
  process.exit(1);
}

async function main() {
  const { csvPath, setorNome, refNome, mesLabel } = parseArgs();

  const csvAbs = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(csvAbs)) {
    throw new Error(`CSV não encontrado: ${csvAbs}`);
  }

  console.log('[test:sheets] 📄 CSV:', csvAbs);
  console.log('[test:sheets] 🗂  Destino:', `SIAPS Exporter / ${setorNome} / ${refNome} / ${mesLabel}`);

  // 1. Limpa o CSV (Fase 2)
  console.log('[test:sheets] 🧹 Processando CSV...');
  const limpo = limparCsv(csvAbs);

  // 2. Autentica no Google
  console.log('[test:sheets] 🔐 Autenticando...');
  const client = await obterClienteOAuth();

  // 3. Sobe pro Drive (Fase 3)
  console.log('[test:sheets] ☁️  Subindo pro Google Sheets...');
  const inicio = Date.now();
  const resultado = await uploadResultado(client, {
    setorNome,
    refNome,
    mesLabel,
    dados: { colunas: limpo.colunas, linhas: limpo.linhas },
  });
  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log('');
  console.log('[test:sheets] 🎉 Pronto em', duracao, 's!');
  console.log('[test:sheets]    Planilha:', resultado.url);
  console.log('[test:sheets]    Aba:', resultado.abaCriada ? 'criada agora' : 'já existia (sobrescrita)');
}

main().catch((err) => {
  console.error('[test:sheets] ❌ Erro:', err.message ?? err);
  if (err.errors || err.response?.data) {
    console.error('[test:sheets]    Detalhes:', JSON.stringify(err.errors ?? err.response?.data, null, 2));
  }
  process.exit(1);
});
