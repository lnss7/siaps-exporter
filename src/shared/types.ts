/**
 * Tipos compartilhados entre main e renderer.
 * NÃO importar nada de electron, fs, ou playwright aqui — esse arquivo
 * é incluído no bundle do renderer também.
 */

export interface Ref {
  id: number;
  nome: string;
  url: string;
}

export interface Setor {
  chave: string;
  nome: string;
  base_url: string;
  referencias: Ref[];
}

export interface Mes {
  label: string;
  ano: number;
  indice: number;
}

export type StatusJob = 'pendente' | 'baixando' | 'processando' | 'enviando' | 'concluido' | 'erro';

export interface Job {
  refId: number;
  refNome: string;
  setor: string;
  mesLabel: string;
  status: StatusJob;
  sheetUrl?: string;
  erro?: string;
}

export interface ProgressEvent {
  jobs: Job[];
  jobIndex: number;
  totalJobs: number;
}

export interface ScrapeOptions {
  refIds: number[];
  meses: Mes[];
}

export interface DoneEvent {
  jobs: Job[];
  duracaoMs: number;
}
