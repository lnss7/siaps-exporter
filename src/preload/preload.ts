/**
 * PRELOAD — ponte segura entre renderer e main.
 * Expõe window.api com os métodos disponíveis no React.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ScrapeOptions, ProgressEvent, DoneEvent, Mes, DeviceCodeEvent } from '../shared/types';

export interface InfoUsuario {
  email: string;
  nome: string;
}

export interface CacheMeses {
  atualizadoEm: string;
  meses: Mes[];
}

export type StatusDescoberta =
  | { fase: 'aguardando-login' }
  | { fase: 'descobrindo' }
  | { fase: 'concluido' };

const api = {
  listarRefs: () => ipcRenderer.invoke('config:listar-refs'),
  abrirUrl: (url: string) => ipcRenderer.invoke('app:abrir-url', url),
  iniciarScrape: (opts: ScrapeOptions) => ipcRenderer.invoke('scrape:iniciar', opts),
  cancelarScrape: (): Promise<void> => ipcRenderer.invoke('scrape:cancelar'),

  loginGoogle: (): Promise<InfoUsuario> => ipcRenderer.invoke('auth:login'),
  deslogar: (): Promise<void> => ipcRenderer.invoke('auth:deslogar'),

  obterMeses: (): Promise<CacheMeses | null> => ipcRenderer.invoke('meses:obter'),
  descobrirMeses: (): Promise<CacheMeses> => ipcRenderer.invoke('meses:descobrir'),

  onStatusDescoberta: (cb: (evt: StatusDescoberta) => void) => {
    const listener = (_e: unknown, evt: StatusDescoberta) => cb(evt);
    ipcRenderer.on('meses:status', listener);
    return () => ipcRenderer.removeListener('meses:status', listener);
  },

  onProgresso: (cb: (evt: ProgressEvent) => void) => {
    const listener = (_e: unknown, evt: ProgressEvent) => cb(evt);
    ipcRenderer.on('scrape:progresso', listener);
    return () => ipcRenderer.removeListener('scrape:progresso', listener);
  },

  onConcluido: (cb: (evt: DoneEvent) => void) => {
    const listener = (_e: unknown, evt: DoneEvent) => cb(evt);
    ipcRenderer.on('scrape:concluido', listener);
    return () => ipcRenderer.removeListener('scrape:concluido', listener);
  },

  // Disparado quando o Device Flow precisa que a usuária digite um código
  // em google.com/device. A UI abre um modal com o código + URL.
  onDeviceCode: (cb: (evt: DeviceCodeEvent) => void) => {
    const listener = (_e: unknown, evt: DeviceCodeEvent) => cb(evt);
    ipcRenderer.on('auth:device-code', listener);
    return () => ipcRenderer.removeListener('auth:device-code', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;

