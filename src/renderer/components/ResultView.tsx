import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  IconButton,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineRounded';
import OpenInNewIcon from '@mui/icons-material/OpenInNewRounded';
import RestartAltIcon from '@mui/icons-material/RestartAltRounded';
import type { DoneEvent } from '../../shared/types';

interface Props {
  resultado: DoneEvent;
  onVoltar: () => void;
}

export function ResultView({ resultado, onVoltar }: Props) {
  const sucesso = resultado.jobs.filter((j) => j.status === 'concluido');
  const erros = resultado.jobs.filter((j) => j.status === 'erro');
  const duracao = formatarDuracao(resultado.duracaoMs);

  const abrirUrl = (url: string) => {
    window.api.abrirUrl(url);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Card
          sx={{
            backgroundImage: (t) =>
              `linear-gradient(135deg, ${alpha(t.palette.success.main, 0.08)} 0%, ${alpha(
                t.palette.primary.main,
                0.04,
              )} 100%)`,
            border: (t) => `1px solid ${alpha(t.palette.success.main, 0.2)}`,
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    Pronto!
                  </Typography>
                  <Typography color="text.secondary">
                    {sucesso.length} planilha(s) criada(s) em {duracao}
                    {erros.length > 0 && ` · ${erros.length} com erro`}
                  </Typography>
                </Box>
              </Stack>
              <Button
                variant="outlined"
                startIcon={<RestartAltIcon />}
                onClick={onVoltar}
                size="large"
              >
                Nova exportação
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {sucesso.length > 0 && (
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="primary" fontWeight={700}>
                Planilhas criadas
              </Typography>
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {sucesso.map((j) => (
                  <Stack
                    key={`${j.refId}-${j.mesLabel}`}
                    direction="row"
                    alignItems="center"
                    spacing={2}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      transition: 'background-color 0.15s',
                      '&:hover': {
                        backgroundColor: (t) => alpha(t.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <CheckCircleIcon color="success" fontSize="small" />
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {j.refNome} — {j.mesLabel}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {j.setor}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => j.sheetUrl && abrirUrl(j.sheetUrl)}
                      title="Abrir planilha"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        {erros.length > 0 && (
          <Card sx={{ borderColor: (t) => alpha(t.palette.error.main, 0.3) }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="error" fontWeight={700}>
                Falhas
              </Typography>
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {erros.map((j) => (
                  <Stack
                    key={`${j.refId}-${j.mesLabel}`}
                    direction="row"
                    alignItems="center"
                    spacing={2}
                  >
                    <ErrorOutlineIcon color="error" fontSize="small" />
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {j.refNome} — {j.mesLabel}
                      </Typography>
                      {j.erro && (
                        <Typography variant="caption" color="text.secondary">
                          {j.erro}
                        </Typography>
                      )}
                    </Box>
                    <Chip label="Erro" size="small" color="error" />
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Container>
  );
}

function formatarDuracao(ms: number): string {
  const totalSeg = Math.round(ms / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min === 0) return `${seg}s`;
  return `${min}m ${seg}s`;
}
