/**
 * ORQUESTRADOR — Fase 4.
 * Costura scraper + processor + sheets numa execução completa.
 *
 * Estratégia de janela (sem fechar/reabrir — preserva cookies):
 *   1. Abre Chrome VISÍVEL pra login inicial.
 *   2. Quando login confirmado, MINIMIZA a janela (via CDP) — segue trabalhando em background.
 *   3. Mid-execution: se um job lança SessaoSiapsExpirada, RESTAURA a janela,
 *      a gestora refaz o caminho até a URL certa, app detecta retorno e minimiza de novo.
 *
 * Para cada (ref × mês):
 *   1. Scraper baixa CSV (Playwright)
 *   2. Processor limpa
 *   3. Sheets sobe pro Drive
 */
import { app, BrowserWindow, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { abrirBrowser, minimizarJanela, restaurarJanela, BrowserHandle } from '../scraper/browser';
import { garantirLogin } from '../scraper/login';
import { baixarIndicador, SessaoSiapsExpirada } from '../scraper/download';
import { limparCsv } from '../processor/cleanCsv';
import { obterClienteOAuth } from '../sheets/auth';
import { uploadResultado } from '../sheets/upload';
import type { ScrapeOptions, Job, ProgressEvent, DoneEvent } from '../shared/types';
import { mensagemAmigavel } from '../shared/erros';

const CONFIG_PATH = path.join(__dirname, '../../config/refs.json');

// Flag de cancelamento. Setada por solicitarCancelamento() (chamada do IPC
// quando a gestora clica em "Voltar" durante a execução).
let cancelamentoSolicitado = false;
let handleAtivo: BrowserHandle | null = null;

export function solicitarCancelamento(): void {
  cancelamentoSolicitado = true;
  console.log('[orq] 🛑 Cancelamento solicitado pela UI.');
  // Fecha o browser na hora pra abortar requests do SIAPS em voo — sem isso,
  // o cancel só "vence" depois da request atual estourar timeout (~120s).
  if (handleAtivo) {
    handleAtivo.context.close().catch(() => {});
    handleAtivo = null;
  }
}

interface RefComSetor {
  id: number;
  nome: string;
  url: string;
  setorChave: string;
  setorNome: string;
}

function carregarRefs(refIds: number[]): RefComSetor[] {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const lookup = new Map<number, RefComSetor>();
  for (const [chave, setor] of Object.entries(config.setores) as [string, any][]) {
    for (const ref of setor.referencias) {
      lookup.set(ref.id, {
        id: ref.id,
        nome: ref.nome,
        url: ref.url,
        setorChave: chave,
        setorNome: setor.nome,
      });
    }
  }
  return refIds.map((id) => {
    const r = lookup.get(id);
    if (!r) throw new Error(`Referência ${id} não encontrada em config/refs.json`);
    return r;
  });
}

/**
 * Restaura a janela, pede pra gestora refazer o caminho até `urlAlvo`,
 * e minimiza de novo quando confirmar. Usado tanto no login inicial
 * quanto quando a sessão expira no meio da execução.
 */
async function pedirLoginEMinimizar(
  handle: BrowserHandle,
  urlAlvo: string,
  mainWindow: BrowserWindow,
  motivo: 'inicial' | 'sessao-expirada',
): Promise<void> {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scrape:aguardando-login', { motivo });
  }

  console.log(`[orq] 🪟 Pedindo login da gestora (${motivo})...`);
  await restaurarJanela(handle);
  await garantirLogin(handle.page, urlAlvo);

  console.log('[orq] 👻 Login OK, minimizando janela...');
  await minimizarJanela(handle);

  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scrape:login-confirmado');
  }
}

export async function executarExportacao(
  opts: ScrapeOptions,
  mainWindow: BrowserWindow,
): Promise<void> {
  const inicio = Date.now();
  cancelamentoSolicitado = false; // reset a cada nova execução

  const refs = carregarRefs(opts.refIds);
  const meses = opts.meses;

  // Lista de jobs (ref × mês)
  const jobs: Job[] = [];
  for (const ref of refs) {
    for (const mes of meses) {
      jobs.push({
        refId: ref.id,
        refNome: ref.nome,
        setor: ref.setorNome,
        mesLabel: mes.label,
        status: 'pendente',
      });
    }
  }

  const enviarProgresso = (jobIndex: number) => {
    if (mainWindow.isDestroyed()) return;
    const evt: ProgressEvent = {
      jobs: jobs.map((j) => ({ ...j })),
      jobIndex,
      totalJobs: jobs.length,
    };
    mainWindow.webContents.send('scrape:progresso', evt);
  };

  console.log(`[orq] 🚀 ${jobs.length} job(s): ${refs.length} ref(s) × ${meses.length} mês(es)`);

  // 1. Abre Chrome uma única vez e pede o login inicial
  const handle = await abrirBrowser();
  handleAtivo = handle;
  await pedirLoginEMinimizar(handle, refs[0].url, mainWindow, 'inicial');

  // 2. OAuth Google (uma única vez)
  console.log('[orq] 🔑 Autenticando no Google...');
  const oauth = await obterClienteOAuth();

  try {
    // 3. Loop pelos jobs com retry em caso de sessão expirada
    for (let i = 0; i < jobs.length; i++) {
      if (cancelamentoSolicitado) break;

      const job = jobs[i];
      const ref = refs.find((r) => r.id === job.refId)!;
      const mes = meses.find((m) => m.label === job.mesLabel)!;

      let jaTentouRelogin = false;

      while (true) {
        if (cancelamentoSolicitado) break;
        try {
          // Fase 1 — baixar
          job.status = 'baixando';
          enviarProgresso(i);
          // pastaDestino em userData (writable em prod, fora do asar)
          const pastaDestino = path.join(app.getPath('userData'), 'downloads');
          const arquivos = await baixarIndicador(handle.page, ref, [mes], {
            pastaDestino,
            debug: true,
          });
          const csvPath = arquivos[0];
          if (!csvPath) throw new Error('Scraper não retornou caminho do CSV');

          // Fase 2 — processar
          job.status = 'processando';
          enviarProgresso(i);
          const limpo = limparCsv(csvPath);

          // Fase 3 — enviar pro Drive
          job.status = 'enviando';
          enviarProgresso(i);
          const resultado = await uploadResultado(oauth, {
            setorNome: ref.setorNome,
            refNome: ref.nome,
            mesLabel: mes.label,
            dados: { colunas: limpo.colunas, linhas: limpo.linhas },
          });

          // Upload OK — apaga o CSV local. Os dados já estão no Drive,
          // não há por que manter cópia local acumulando disco.
          try {
            if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
          } catch (err) {
            console.warn(`[orq] ⚠️  Falha ao apagar ${csvPath}:`, (err as Error).message);
          }

          job.status = 'concluido';
          job.sheetUrl = resultado.url;
          enviarProgresso(i);
          console.log(`[orq] ✅ ${ref.nome} / ${mes.label} → ${resultado.url}`);
          break; // sai do while, próximo job
        } catch (err) {
          if (cancelamentoSolicitado) break;
          if (err instanceof SessaoSiapsExpirada && !jaTentouRelogin) {
            console.warn(`[orq] ⚠️  Sessão expirou em ${ref.nome}/${mes.label}. Pedindo login.`);
            jaTentouRelogin = true;
            await pedirLoginEMinimizar(handle, ref.url, mainWindow, 'sessao-expirada');
            continue; // tenta o mesmo job de novo
          }

          // Falha definitiva nesse job — marca como erro e segue pro próximo.
          // Traduz a mensagem técnica em algo legível antes de mandar pra UI;
          // o log do console mantém o original pra debug.
          job.status = 'erro';
          job.erro = mensagemAmigavel(err);
          enviarProgresso(i);
          console.error(`[orq] ❌ ${ref.nome} / ${mes.label}:`, (err as Error).message);
          break;
        }
      }
    }
  } finally {
    handleAtivo = null;
    await handle.context.close().catch(() => {});
  }

  // 4. Done — pula evento se foi cancelado (UI já voltou pro setup sozinha)
  if (cancelamentoSolicitado) {
    console.log(`[orq] 🛑 Execução cancelada após ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
    return;
  }

  const done: DoneEvent = {
    jobs: jobs.map((j) => ({ ...j })),
    duracaoMs: Date.now() - inicio,
  };
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scrape:concluido', done);
  }

  const sucesso = jobs.filter((j) => j.status === 'concluido').length;
  const erros = jobs.filter((j) => j.status === 'erro').length;
  console.log(
    `[orq] 🏁 ${((Date.now() - inicio) / 1000).toFixed(1)}s — ${sucesso} ok, ${erros} erro(s)`,
  );

  // Notificação nativa do sistema — a gestora costuma sair pra fazer outra
  // coisa enquanto o app roda. O ding/toast avisa que pode voltar.
  if (Notification.isSupported()) {
    const titulo =
      erros === 0
        ? '✅ Exportação concluída!'
        : sucesso === 0
          ? '❌ Exportação falhou'
          : `⚠️ Concluído com ${erros} erro(s)`;

    const corpo =
      erros === 0
        ? `${sucesso} planilha(s) criada(s) no Google Sheets.`
        : `${sucesso} de ${jobs.length} planilha(s) com sucesso. Abra o app pra ver detalhes.`;

    try {
      const notif = new Notification({ title: titulo, body: corpo, silent: false });
      notif.on('click', () => {
        if (!mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      notif.show();
    } catch (err) {
      console.warn('[orq] Falha ao mostrar notificação:', (err as Error).message);
    }
  }
}
