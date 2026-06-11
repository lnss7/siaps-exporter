import { Box, Button, Stack, Typography, alpha } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import type { Mes } from '../../shared/types';

interface Props {
  meses: Mes[];
  selecionados: string[];
  onChange: (s: string[]) => void;
}

export function MesesSelector({ meses, selecionados, onChange }: Props) {
  const sel = new Set(selecionados);

  const toggle = (label: string) => {
    const next = new Set(sel);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    onChange([...next]);
  };

  const todosLabels = meses.map((m) => m.label);
  const todosMarcados = todosLabels.length > 0 && todosLabels.every((l) => sel.has(l));

  const porAno: Record<number, Mes[]> = {};
  for (const m of meses) {
    if (!porAno[m.ano]) porAno[m.ano] = [];
    porAno[m.ano].push(m);
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Selecione as competências que quer baixar
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={() => onChange(todosMarcados ? [] : todosLabels)}
        >
          {todosMarcados ? 'Limpar tudo' : 'Marcar todos'}
        </Button>
      </Stack>

      {meses.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          Nenhum mês disponível ainda. Clique em "Atualizar lista" pra buscar no SIAPS.
        </Typography>
      )}

      {Object.entries(porAno)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([ano, meses]) => (
          <Box key={ano}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.25 }}>
              <Typography
                variant="overline"
                sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1.5 }}
              >
                {ano}
              </Typography>
              <Box
                sx={{
                  flexGrow: 1,
                  height: 1,
                  background: (t) =>
                    `linear-gradient(to right, ${alpha(t.palette.text.primary, 0.08)}, transparent)`,
                }}
              />
            </Stack>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 1,
              }}
            >
              {meses.map((mes) => {
                const ativo = sel.has(mes.label);
                return (
                  <Button
                    key={mes.label}
                    onClick={() => toggle(mes.label)}
                    variant="outlined"
                    sx={{
                      py: 1.25,
                      flexDirection: 'column',
                      gap: 0.5,
                      borderColor: (t) =>
                        ativo ? t.palette.primary.main : alpha('#0f172a', 0.12),
                      backgroundColor: (t) =>
                        ativo ? alpha(t.palette.primary.main, 0.08) : 'transparent',
                      color: (t) => (ativo ? t.palette.primary.dark : 'text.primary'),
                      textTransform: 'none',
                      transition: 'all 0.15s',
                      '&:hover': {
                        borderColor: 'primary.main',
                        backgroundColor: (t) =>
                          alpha(t.palette.primary.main, ativo ? 0.12 : 0.04),
                        transform: 'translateY(-1px)',
                      },
                    }}
                  >
                    <Box
                      sx={{
                        width: 18,
                        height: 18,
                        borderRadius: 0.75,
                        display: 'grid',
                        placeItems: 'center',
                        backgroundColor: (t) =>
                          ativo ? t.palette.primary.main : alpha('#0f172a', 0.06),
                        color: ativo ? '#fff' : 'transparent',
                      }}
                    >
                      <CheckRoundedIcon sx={{ fontSize: 14 }} />
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1 }}>
                      {mes.label.split('-')[0]}
                    </Typography>
                  </Button>
                );
              })}
            </Box>
          </Box>
        ))}
    </Stack>
  );
}
