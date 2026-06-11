/**
 * UPLOAD — orquestra o caminho completo:
 *   SIAPS Exporter / {setor} / {ref} → aba {mes}
 *
 * Estratégia idempotente: se a planilha já existe, reusa.
 * Se a aba já existe, sobrescreve o conteúdo (limpa + escreve).
 * Se não existe, cria.
 */
import { google, sheets_v4 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { garantirPasta, garantirPlanilha, urlPlanilha, NOME_PASTA_RAIZ } from './drive';

export interface DadosTabela {
  /** Cabeçalho (1ª linha) */
  colunas: string[];
  /** Linhas de dados (cada linha é um objeto coluna→valor) */
  linhas: Record<string, string>[];
}

export interface ParametrosUpload {
  setorNome: string; // ex: "eMulti"
  refNome: string; // ex: "Média de Atendimentos da eMulti por Pessoa"
  mesLabel: string; // ex: "Fev-26"
  dados: DadosTabela;
}

export interface ResultadoUpload {
  spreadsheetId: string;
  url: string;
  abaCriada: boolean;
}

/**
 * Sobe os dados pro Drive da pessoa autenticada.
 * Cria toda a hierarquia se necessário (pasta-raiz, pasta do setor, planilha).
 * A aba do mês é criada ou sobrescrita.
 */
export async function uploadResultado(
  client: OAuth2Client,
  params: ParametrosUpload,
): Promise<ResultadoUpload> {
  const { setorNome, refNome, mesLabel, dados } = params;

  // 1. Hierarquia de pastas
  const idRaiz = await garantirPasta(client, NOME_PASTA_RAIZ, null);
  const idSetor = await garantirPasta(client, setorNome, idRaiz);

  // 2. Planilha da referência
  const spreadsheetId = await garantirPlanilha(client, refNome, idSetor);

  // 3. Aba do mês — cria se não existe, limpa se existe
  const sheets = google.sheets({ version: 'v4', auth: client });
  const abaCriada = await garantirAba(sheets, spreadsheetId, mesLabel);

  // 4. Escreve os dados
  await escreverDados(sheets, spreadsheetId, mesLabel, dados);

  // 5. Limpa a aba "Página1" / "Sheet1" padrão se ela existir e não estiver sendo usada
  await removerAbaDefaultSeOciosa(sheets, spreadsheetId, mesLabel);

  return {
    spreadsheetId,
    url: urlPlanilha(spreadsheetId),
    abaCriada,
  };
}

/**
 * Garante que existe uma aba com esse nome.
 * Retorna true se foi criada agora, false se já existia.
 */
async function garantirAba(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  nomeAba: string,
): Promise<boolean> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const existente = meta.data.sheets?.find((s) => s.properties?.title === nomeAba);
  if (existente) {
    // Já existe → limpa pra reescrever
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${nomeAba}'` });
    return false;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: nomeAba } } }],
    },
  });
  return true;
}

async function escreverDados(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  nomeAba: string,
  dados: DadosTabela,
): Promise<void> {
  const valores: string[][] = [
    dados.colunas,
    ...dados.linhas.map((linha) => dados.colunas.map((c) => linha[c] ?? '')),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${nomeAba}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: valores },
  });

  // Estilo: cabeçalho em negrito + congela a 1ª linha
  const sheetId = await getSheetIdPorNome(sheets, spreadsheetId, nomeAba);
  if (sheetId === null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.05, green: 0.58, blue: 0.53 },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } } },
            fields: 'userEnteredFormat.textFormat.foregroundColor',
          },
        },
      ],
    },
  });
}

async function getSheetIdPorNome(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  nomeAba: string,
): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const aba = meta.data.sheets?.find((s) => s.properties?.title === nomeAba);
  return aba?.properties?.sheetId ?? null;
}

/**
 * Remove a aba "Página1" / "Sheet1" automática se ela existir e não for a aba ativa.
 * (O Google cria essa aba quando criamos a planilha vazia.)
 */
async function removerAbaDefaultSeOciosa(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  abaParaPreservar: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const todas = meta.data.sheets ?? [];
  if (todas.length <= 1) return; // Não dá pra deletar se for a única

  const padroes = ['Página1', 'Sheet1', 'Pagina1', 'Hoja1'];
  const default_ = todas.find(
    (s) => s.properties?.title && padroes.includes(s.properties.title),
  );
  if (!default_ || default_.properties?.title === abaParaPreservar) return;

  const sheetId = default_.properties?.sheetId;
  if (sheetId == null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteSheet: { sheetId } }] },
  });
}
