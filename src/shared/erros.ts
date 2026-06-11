/**
 * ERROS — traduz mensagens técnicas (Playwright, googleapis, rede) em texto
 * que a gestora consegue entender, sem stack trace ou nomes de selectors.
 *
 * Usado no orquestrador antes de gravar `job.erro` (que vai pra UI) e em
 * qualquer outro lugar onde mostramos erro pra o humano.
 */

export function mensagemAmigavel(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // --- Rede / conectividade ---
  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('network') ||
    lower.includes('dns')
  ) {
    return 'Sem conexão com a internet. Verifique sua rede e tente de novo.';
  }

  // --- Google Drive / Sheets ---
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429')) {
    return 'Google atingiu o limite de uso por agora. Aguarde alguns minutos e tente de novo.';
  }
  if (lower.includes('invalid_grant') || lower.includes('token has been expired')) {
    return 'Sua conexão com o Google expirou. Saia e entre de novo pra renovar o acesso.';
  }
  if (lower.includes('insufficient') && lower.includes('scope')) {
    return 'Faltam permissões no Google. Saia, entre de novo e aceite todas as permissões pedidas.';
  }
  if (lower.includes('storagequotaexceeded') || lower.includes('storage quota')) {
    return 'Seu Google Drive está cheio. Libere espaço e tente de novo.';
  }
  if (lower.includes('forbidden') || lower.includes('403')) {
    return 'O Google bloqueou o acesso. Verifique se sua conta tem permissão pra criar planilhas.';
  }

  // --- SIAPS ---
  if (raw.includes('SessaoSiapsExpirada') || lower.includes('sessão siaps')) {
    return 'A sessão no SIAPS expirou. O app vai pedir login de novo.';
  }
  if (lower.includes('siaps') && lower.includes('travado')) {
    return 'O SIAPS está muito lento ou fora do ar. Tente de novo em alguns minutos.';
  }

  // --- Playwright (clicks / timeouts) ---
  if (lower.includes('timeout') && lower.includes('click')) {
    return 'O SIAPS travou ao tentar carregar essa página. Tente de novo em alguns minutos.';
  }
  if (lower.includes('elemento não encontrado') || lower.includes('locator')) {
    return 'A página do SIAPS mudou ou não carregou direito. Tente de novo, ou avise o desenvolvedor se persistir.';
  }
  if (lower.includes('timeout')) {
    return 'A operação demorou demais. Tente de novo em alguns minutos.';
  }

  // --- Arquivo / CSV ---
  if (lower.includes('enoent') || lower.includes('no such file')) {
    return 'Um arquivo necessário não foi encontrado. Reinicie o app e tente de novo.';
  }
  if (lower.includes('eperm') || lower.includes('eacces')) {
    return 'Sem permissão pra acessar um arquivo. Verifique se o app não está sendo bloqueado por antivírus.';
  }

  // --- Fallback ---
  // Mantém a mensagem original se for curta o suficiente pra UI;
  // caso contrário, encurta com sufixo genérico.
  if (raw.length < 140) return raw;
  return `Algo deu errado durante a operação. Tente de novo, e se persistir avise o desenvolvedor. (${raw.slice(0, 80)}...)`;
}
