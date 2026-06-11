/**
 * DRIVE — helpers idempotentes pra pastas e planilhas no Google Drive.
 *
 * Todos os "garantir*" buscam por nome dentro de um pai.
 * Se acharem, retornam o ID. Se não acharem, criam e retornam o novo ID.
 *
 * Usamos o escopo drive.file (acesso só a arquivos criados pelo app),
 * então só vemos coisas que o próprio app criou — privacidade-friendly.
 */
import { google, drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const MIME_PASTA = 'application/vnd.google-apps.folder';
const MIME_PLANILHA = 'application/vnd.google-apps.spreadsheet';

export const NOME_PASTA_RAIZ = 'SIAPS Exporter';

function escaparQuery(s: string): string {
  // No Drive query language, aspa simples precisa ser escapada como \'
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function buscarPorNome(
  drive: drive_v3.Drive,
  nome: string,
  parentId: string | null,
  mimeType: string,
): Promise<string | null> {
  const partes = [
    `name = '${escaparQuery(nome)}'`,
    `mimeType = '${mimeType}'`,
    'trashed = false',
  ];
  if (parentId) partes.push(`'${parentId}' in parents`);
  else partes.push("'root' in parents");

  const resp = await drive.files.list({
    q: partes.join(' and '),
    fields: 'files(id, name)',
    pageSize: 10,
    spaces: 'drive',
  });

  const arquivos = resp.data.files ?? [];
  if (arquivos.length === 0) return null;
  if (arquivos.length > 1) {
    console.warn(
      `[drive] ⚠️  Encontrei ${arquivos.length} "${nome}" no mesmo pai. Usando o primeiro.`,
    );
  }
  return arquivos[0].id ?? null;
}

async function criarPasta(
  drive: drive_v3.Drive,
  nome: string,
  parentId: string | null,
): Promise<string> {
  const resp = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: MIME_PASTA,
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });
  if (!resp.data.id) throw new Error(`Falha ao criar pasta "${nome}"`);
  return resp.data.id;
}

async function criarPlanilhaVazia(
  drive: drive_v3.Drive,
  nome: string,
  parentId: string,
): Promise<string> {
  const resp = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: MIME_PLANILHA,
      parents: [parentId],
    },
    fields: 'id',
  });
  if (!resp.data.id) throw new Error(`Falha ao criar planilha "${nome}"`);
  return resp.data.id;
}

/**
 * Garante uma pasta com esse nome dentro do parent (ou na raiz se parentId=null).
 * Retorna o ID. Idempotente.
 */
export async function garantirPasta(
  client: OAuth2Client,
  nome: string,
  parentId: string | null,
): Promise<string> {
  const drive = google.drive({ version: 'v3', auth: client });
  const existente = await buscarPorNome(drive, nome, parentId, MIME_PASTA);
  if (existente) return existente;
  console.log(`[drive] 📁 Criando pasta "${nome}"...`);
  return await criarPasta(drive, nome, parentId);
}

/**
 * Garante uma planilha com esse nome dentro do parent.
 * Retorna o ID da planilha (spreadsheetId). Idempotente.
 */
export async function garantirPlanilha(
  client: OAuth2Client,
  nome: string,
  parentId: string,
): Promise<string> {
  const drive = google.drive({ version: 'v3', auth: client });
  const existente = await buscarPorNome(drive, nome, parentId, MIME_PLANILHA);
  if (existente) return existente;
  console.log(`[drive] 📑 Criando planilha "${nome}"...`);
  return await criarPlanilhaVazia(drive, nome, parentId);
}

/**
 * Constrói o link Web pra abrir uma planilha no browser.
 */
export function urlPlanilha(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}
