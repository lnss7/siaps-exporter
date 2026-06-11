import { Box, Button, Card, CardContent, Divider, Stack, Typography, alpha } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunchRounded';
import ArticleIcon from '@mui/icons-material/ArticleOutlined';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonthOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeRounded';

interface Props {
  refsCount: number;
  mesesCount: number;
  onExportar: () => void;
}

export function ActionPanel({ refsCount, mesesCount, onExportar }: Props) {
  const total = refsCount * mesesCount;
  const pode = total > 0;
  const tempoEstimadoMin = Math.max(1, Math.round((total * 25) / 60));

  return (
    <Box sx={{ position: 'sticky', top: 24 }}>
      <Card
        sx={{
          overflow: 'hidden',
          border: 'none',
          boxShadow: (t) =>
            `0 1px 3px ${alpha(t.palette.primary.main, 0.06)}, 0 12px 40px -16px ${alpha(
              t.palette.primary.main,
              0.25,
            )}`,
        }}
      >
        <Box
          sx={{
            p: 3,
            color: '#fff',
            background: (t) =>
              `linear-gradient(135deg, ${t.palette.primary.dark} 0%, ${t.palette.primary.main} 100%)`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: -40,
              right: -40,
              width: 160,
              height: 160,
              borderRadius: '50%',
              background: (t) => alpha(t.palette.common.white, 0.08),
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              bottom: -30,
              right: 30,
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: (t) => alpha(t.palette.common.white, 0.06),
            }}
          />

          <Stack direction="row" alignItems="center" spacing={1} sx={{ position: 'relative' }}>
            <AutoAwesomeIcon fontSize="small" />
            <Typography
              variant="overline"
              sx={{ fontWeight: 700, letterSpacing: 1.5, opacity: 0.9 }}
            >
              Total a gerar
            </Typography>
          </Stack>

          <Typography
            sx={{
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1,
              mt: 1,
              mb: 0.5,
              position: 'relative',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.04em',
            }}
          >
            {total}
          </Typography>
          <Typography
            variant="body2"
            sx={{ opacity: 0.85, position: 'relative', fontWeight: 500 }}
          >
            planilha{total === 1 ? '' : 's'} no Google Sheets
          </Typography>
        </Box>

        <CardContent sx={{ p: 3 }}>
          <Stack spacing={1.5}>
            <ResumoLinha
              icone={<ArticleIcon fontSize="small" />}
              label="Referências"
              valor={refsCount}
            />
            <Divider sx={{ my: 0.5 }} />
            <ResumoLinha
              icone={<CalendarMonthIcon fontSize="small" />}
              label="Meses"
              valor={mesesCount}
            />
          </Stack>

          {pode && (
            <Box
              sx={{
                mt: 2.5,
                p: 1.5,
                borderRadius: 2,
                backgroundColor: (t) => alpha(t.palette.warning.main, 0.08),
                border: (t) => `1px dashed ${alpha(t.palette.warning.main, 0.3)}`,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                ⏱️ Tempo estimado: <strong>~{tempoEstimadoMin} min</strong>
              </Typography>
            </Box>
          )}

          <Button
            fullWidth
            size="large"
            variant="contained"
            disabled={!pode}
            onClick={onExportar}
            startIcon={<RocketLaunchIcon />}
            sx={{
              mt: 3,
              py: 1.5,
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            Baixar e exportar
          </Button>

          {!pode && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}
            >
              Selecione ao menos 1 referência e 1 mês
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function ResumoLinha({
  icone,
  label,
  valor,
}: {
  icone: React.ReactNode;
  label: string;
  valor: number;
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ color: 'text.secondary' }}>
        {icone}
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
      </Stack>
      <Typography
        variant="h6"
        fontWeight={700}
        sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}
      >
        {valor}
      </Typography>
    </Stack>
  );
}
