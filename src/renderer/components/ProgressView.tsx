import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  LinearProgress,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorIcon from '@mui/icons-material/ErrorRounded';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import type { Job, ProgressEvent, StatusJob } from '../../shared/types';

interface Props {
  evt: ProgressEvent;
  onVoltar: () => void;
}

const LABEL_STATUS: Record<StatusJob, string> = {
  pendente: 'Aguardando',
  baixando: 'Baixando do SIAPS',
  processando: 'Removendo colunas',
  enviando: 'Enviando pro Google',
  concluido: 'Concluído',
  erro: 'Erro',
};

export function ProgressView({ evt, onVoltar }: Props) {
  const { jobs, jobIndex, totalJobs } = evt;
  const concluidos = jobs.filter((j) => j.status === 'concluido').length;
  const progresso = totalJobs > 0 ? (concluidos / totalJobs) * 100 : 0;
  const atual = jobs[jobIndex];

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Card>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="overline" color="primary" fontWeight={700}>
                  Em execução
                </Typography>
                <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5 }}>
                  Baixando suas planilhas
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  {concluidos} de {totalJobs} concluídas
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                startIcon={<ArrowBackRoundedIcon />}
                onClick={onVoltar}
                sx={{
                  flexShrink: 0,
                  borderColor: (t) => alpha(t.palette.text.primary, 0.15),
                  color: 'text.secondary',
                  '&:hover': {
                    borderColor: 'error.main',
                    color: 'error.main',
                    backgroundColor: (t) => alpha(t.palette.error.main, 0.04),
                  },
                }}
              >
                Voltar e ajustar
              </Button>
            </Stack>

            <Box>
              <LinearProgress
                variant="determinate"
                value={progresso}
                sx={{ height: 10, borderRadius: 5 }}
              />
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {atual ? `Atual: ${atual.refNome} — ${atual.mesLabel}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {Math.round(progresso)}%
                </Typography>
              </Stack>
            </Box>

            <Stack spacing={1} sx={{ maxHeight: 480, overflowY: 'auto', pr: 1 }}>
              {jobs.map((job, i) => (
                <JobLinha key={`${job.refId}-${job.mesLabel}`} job={job} ativo={i === jobIndex} />
              ))}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

function JobLinha({ job, ativo }: { job: Job; ativo: boolean }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      sx={{
        p: 1.5,
        borderRadius: 2,
        backgroundColor: (t) =>
          ativo
            ? alpha(t.palette.primary.main, 0.06)
            : job.status === 'concluido'
              ? alpha(t.palette.success.main, 0.04)
              : 'transparent',
        border: (t) =>
          ativo ? `1px solid ${alpha(t.palette.primary.main, 0.25)}` : '1px solid transparent',
        transition: 'background-color 0.2s',
      }}
    >
      <StatusIcone status={job.status} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {job.refNome}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {job.setor} · {job.mesLabel}
        </Typography>
      </Box>
      <Chip
        label={LABEL_STATUS[job.status]}
        size="small"
        color={
          job.status === 'concluido'
            ? 'success'
            : job.status === 'erro'
              ? 'error'
              : ativo
                ? 'primary'
                : 'default'
        }
        variant={job.status === 'pendente' ? 'outlined' : 'filled'}
      />
    </Stack>
  );
}

function StatusIcone({ status }: { status: StatusJob }) {
  if (status === 'concluido') return <CheckCircleIcon color="success" />;
  if (status === 'erro') return <ErrorIcon color="error" />;
  if (status === 'pendente') return <HourglassEmptyIcon sx={{ color: 'text.disabled' }} />;
  return <CircularProgress size={20} thickness={5} />;
}
