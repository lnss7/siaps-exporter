/**
 * CACHE DE MESES — persiste a última lista descoberta pelo Playwright
 * no `userData/` do Electron. Sobrevive entre execuções.
 *
 * Tem TTL de 24h: depois disso a função `isStale()` retorna true, sinalizando
 * pro orquestrador rodar uma re-descoberta oportunista usando a sessão já
 * logada (sem custo extra de login).
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { Mes } from '../shared/types';

const CACHE_FILE = 'meses-cache.json';
const TTL_HORAS = 24;

export interface CacheMeses {
  atualizadoEm: string; // ISO timestamp
  meses: Mes[];
}

function caminhoCache(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

export function lerCacheMeses(): CacheMeses | null {
  try {
    const p = caminhoCache();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw) as CacheMeses;
  } catch (err) {
    console.warn('[cacheMeses] Falha ao ler cache:', (err as Error).message);
    return null;
  }
}

export function salvarCacheMeses(meses: Mes[]): CacheMeses {
  const cache: CacheMeses = {
    atualizadoEm: new Date().toISOString(),
    meses,
  };
  try {
    fs.writeFileSync(caminhoCache(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[cacheMeses] Falha ao salvar cache:', (err as Error).message);
  }
  return cache;
}

/**
 * True se o cache tem mais de TTL_HORAS desde a última descoberta — ou se
 * nunca foi gerado. Sinal pro orquestrador disparar re-descoberta oportunista.
 */
export function cacheEstaVencido(cache: CacheMeses | null): boolean {
  if (!cache) return true;
  const atualizadoMs = new Date(cache.atualizadoEm).getTime();
  if (isNaN(atualizadoMs)) return true;
  const idadeHoras = (Date.now() - atualizadoMs) / (1000 * 60 * 60);
  return idadeHoras > TTL_HORAS;
}
