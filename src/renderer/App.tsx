import { useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Fade,
  Skeleton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Toolbar,
  Typography,
  alpha,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafetyRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import GoogleIcon from '@mui/icons-material/Google';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { RefsSelector } from './components/RefsSelector';
import { MesesSelector } from './components/MesesSelector';
import { ActionPanel } from './components/ActionPanel';
import { ProgressView } from './components/ProgressView';
import { ResultView } from './components/ResultView';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { gerarMesesDisponiveis } from '../shared/meses';
import { mensagemAmigavel } from '../shared/erros';
import type { DoneEvent, Mes, ProgressEvent, Setor } from '../shared/types';

interface InfoUsuario {
  email: string;
  nome: string;
}

type FaseDescoberta = 'idle' | 'aguardando-login' | 'descobrindo';

type Modo = 'setup' | 'rodando' | 'concluido';

const PASSOS: { label: string; Icone: typeof TuneRoundedIcon }[] = [
  { label: 'Configurar', Icone: TuneRoundedIcon },
  { label: 'Executar', Icone: PlayArrowRoundedIcon },
  { label: 'Pronto', Icone: CheckCircleRoundedIcon },
];

export default function App() {
  const [usuario, setUsuario] = useState<InfoUsuario | null>(null);
  const [logando, setLogando] = useState(false);
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('setup');
  const [setores, setSetores] = useState<Setor[]>([]);
  const [refsSelecionadas, setRefsSelecionadas] = useState<Set<number>>(new Set());
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>([]);
  const [progresso, setProgresso] = useState<ProgressEvent | null>(null);
  const [resultado, setResultado] = useState<DoneEvent | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [meses, setMeses] = useState<Mes[]>(() =>
    Object.values(gerarMesesDisponiveis()),
  );
  const [mesesAtualizadoEm, setMesesAtualizadoEm] = useState<string | null>(null);
  const [faseDescoberta, setFaseDescoberta] = useState<FaseDescoberta>('idle');
  const [erroDescoberta, setErroDescoberta] = useState<string | null>(null);

  const handleLogin = async () => {
    setLogando(true);
    setErroLogin(null);
    try {
      const info = await window.api.loginGoogle();
      setUsuario(info);
    } catch (err) {
      setErroLogin(mensagemAmigavel(err));
    } finally {
      setLogando(false);
    }
  };

  const handleDeslogar = async () => {
    await window.api.deslogar();
    setUsuario(null);
    setModo('setup');
    setProgresso(null);
    setResultado(null);
  };

  useEffect(() => {
    let cancelado = false;
    window.api
      .listarRefs()
      .then((config: any) => {
        if (cancelado) return;
        const lista: Setor[] = Object.entries(config.setores).map(
          ([chave, s]: [string, any]) => ({
            chave,
            nome: s.nome,
            base_url: s.base_url,
            referencias: s.referencias,
          }),
        );
        setSetores(lista);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    const offProg = window.api.onProgresso((evt) => setProgresso(evt));
    const offDone = window.api.onConcluido((evt) => {
      setResultado(evt);
      setModo('concluido');
    });
    const offMeses = window.api.onStatusDescoberta((evt) => {
      if (evt.fase === 'aguardando-login') setFaseDescoberta('aguardando-login');
      else if (evt.fase === 'descobrindo') setFaseDescoberta('descobrindo');
      else if (evt.fase === 'concluido') setFaseDescoberta('idle');
    });
    return () => {
      offProg();
      offDone();
      offMeses();
    };
  }, []);

  useEffect(() => {
    window.api.obterMeses().then((cache) => {
      if (cache && cache.meses.length > 0) {
        setMeses(cache.meses);
        setMesesAtualizadoEm(cache.atualizadoEm);
      }
    });
  }, []);

  const atualizarMeses = async () => {
    setErroDescoberta(null);
    setFaseDescoberta('aguardando-login');
    try {
      const cache = await window.api.descobrirMeses();
      setMeses(cache.meses);
      setMesesAtualizadoEm(cache.atualizadoEm);
      // Remove da seleção meses que sumiram após a atualização
      const disponiveis = new Set(cache.meses.map((m) => m.label));
      setMesesSelecionados((sel) => sel.filter((l) => disponiveis.has(l)));
    } catch (err) {
      setErroDescoberta(mensagemAmigavel(err));
    } finally {
      setFaseDescoberta('idle');
    }
  };

  const totalRefs = useMemo(
    () => setores.reduce((acc, s) => acc + s.referencias.length, 0),
    [setores],
  );

  const exportar = async () => {
    const mesesEscolhidos = meses.filter((m) => mesesSelecionados.includes(m.label));
    const evtInicial: ProgressEvent = {
      jobs: [],
      jobIndex: 0,
      totalJobs: refsSelecionadas.size * mesesEscolhidos.length,
    };
    setProgresso(evtInicial);
    setResultado(null);
    setModo('rodando');
    try {
      await window.api.iniciarScrape({
        refIds: [...refsSelecionadas],
        meses: mesesEscolhidos,
      });
    } catch (err) {
      console.error('Erro no scrape:', err);
    }
  };

  const voltar = () => {
    setModo('setup');
    setProgresso(null);
    setResultado(null);
  };

  const voltarDeExecucao = async () => {
    // Avisa o backend pra parar e fechar o browser; volta a UI na hora.
    try {
      await window.api.cancelarScrape();
    } catch (err) {
      console.error('Erro ao cancelar:', err);
    }
    voltar();
  };

  const passoAtivo = modo === 'setup' ? 0 : modo === 'rodando' ? 1 : 2;

  if (!usuario) {
    return (
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: (t) => `
            radial-gradient(ellipse 80% 50% at 50% -20%, ${alpha(t.palette.primary.main, 0.12)}, transparent),
            radial-gradient(ellipse 60% 40% at 100% 100%, ${alpha(t.palette.secondary.main, 0.06)}, transparent),
            ${t.palette.background.default}
          `,
        }}
      >
        <Card
          sx={{
            width: 420,
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
            backgroundColor: (t) => alpha(t.palette.background.paper, 0.9),
            p: 2,
          }}
        >
          <CardContent sx={{ py: 5, px: 4 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 3,
                display: 'grid',
                placeItems: 'center',
                mx: 'auto',
                mb: 3,
                background: (t) =>
                  `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.primary.dark})`,
                color: '#fff',
                boxShadow: (t) => `0 8px 24px -6px ${alpha(t.palette.primary.main, 0.5)}`,
              }}
            >
              <HealthAndSafetyIcon sx={{ fontSize: 30 }} />
            </Box>
            <Typography variant="h4" fontWeight={800} letterSpacing="-0.03em" sx={{ mb: 1 }}>
              SIAPS Exporter
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 4, fontSize: 15 }}>
              Faça login com sua conta Google para acessar o Drive e começar a exportar.
            </Typography>
            <Button
              variant="contained"
              size="large"
              startIcon={logando ? <CircularProgress size={20} color="inherit" /> : <GoogleIcon />}
              onClick={handleLogin}
              disabled={logando}
              fullWidth
              sx={{ py: 1.5, fontSize: 16 }}
            >
              {logando ? 'Autorizando…' : 'Entrar com Google'}
            </Button>
            {erroLogin && (
              <Typography color="error" sx={{ mt: 2, fontSize: 13 }}>
                {erroLogin}
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: (t) => `
          radial-gradient(ellipse 80% 50% at 50% -20%, ${alpha(t.palette.primary.main, 0.12)}, transparent),
          radial-gradient(ellipse 60% 40% at 100% 100%, ${alpha(t.palette.secondary.main, 0.06)}, transparent),
          ${t.palette.background.default}
        `,
      }}
    >
      <AppBar
        position="static"
        elevation={0}
        sx={{
          backgroundColor: 'transparent',
          color: 'text.primary',
          backdropFilter: 'blur(8px)',
          backgroundImage: (t) =>
            `linear-gradient(to bottom, ${alpha(t.palette.background.paper, 0.4)}, transparent)`,
        }}
      >
        <Toolbar sx={{ minHeight: 72, pt: 2.5, pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexGrow: 1 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2.5,
                display: 'grid',
                placeItems: 'center',
                background: (t) =>
                  `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.primary.dark})`,
                color: '#fff',
                boxShadow: (t) => `0 6px 20px -6px ${alpha(t.palette.primary.main, 0.5)}`,
              }}
            >
              <HealthAndSafetyIcon />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={800} lineHeight={1.1} letterSpacing="-0.01em">
                SIAPS Exporter
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Indicadores de saúde · Google Sheets
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ minWidth: 360 }}>
            <Stepper activeStep={passoAtivo} alternativeLabel sx={{ '& .MuiStepLabel-label': { mt: 0.5, fontSize: 12 } }}>
              {PASSOS.map(({ label, Icone }, idx) => (
                <Step key={label}>
                  <StepLabel
                    StepIconComponent={() => (
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          backgroundColor: (t) =>
                            idx === passoAtivo
                              ? t.palette.primary.main
                              : idx < passoAtivo
                                ? t.palette.success.main
                                : alpha(t.palette.text.primary, 0.08),
                          color: idx <= passoAtivo ? '#fff' : 'text.disabled',
                          transition: 'all 0.2s',
                          boxShadow: (t) =>
                            idx === passoAtivo
                              ? `0 0 0 4px ${alpha(t.palette.primary.main, 0.15)}`
                              : 'none',
                        }}
                      >
                        <Icone sx={{ fontSize: 16 }} />
                      </Box>
                    )}
                  >
                    {label}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
          </Box>

          <Button
            size="small"
            color="inherit"
            startIcon={<LogoutRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={handleDeslogar}
            sx={{
              ml: 2,
              fontSize: 12,
              color: 'text.secondary',
              textTransform: 'none',
              '&:hover': { color: 'error.main' },
            }}
          >
            {usuario.email}
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        {modo === 'setup' && (
          <Container maxWidth="xl" sx={{ py: 4 }}>
            {carregando ? (
              <Fade in timeout={300}>
                <Box>
                  <Stack spacing={2} sx={{ mb: 4 }}>
                    <Skeleton variant="text" width={360} height={56} />
                    <Skeleton variant="text" width={520} height={28} />
                  </Stack>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
                      gap: 3,
                    }}
                  >
                    <Stack spacing={3}>
                      <Skeleton variant="rounded" height={280} />
                      <Skeleton variant="rounded" height={240} />
                    </Stack>
                    <Skeleton variant="rounded" height={220} />
                  </Box>
                </Box>
              </Fade>
            ) : (
              <Fade in timeout={350}>
                <Box>
                <Box sx={{ mb: 4 }}>
                  <Typography
                    variant="h3"
                    fontWeight={800}
                    sx={{ letterSpacing: '-0.03em', lineHeight: 1.1 }}
                  >
                    Olá, {usuario.nome} 👋
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 1, fontSize: 17 }}>
                    Escolha as referências e os meses. Cada combinação vira uma planilha
                    nova no Google Sheets.
                  </Typography>
                </Box>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
                    gap: 3,
                    alignItems: 'start',
                  }}
                >
                  <Stack spacing={3}>
                    <SecaoCard
                      passo="01"
                      titulo="Referências"
                      subtitulo={`${refsSelecionadas.size} de ${totalRefs} marcadas`}
                    >
                      <RefsSelector
                        setores={setores}
                        selecionadas={refsSelecionadas}
                        onChange={setRefsSelecionadas}
                      />
                    </SecaoCard>

                    <SecaoCard
                      passo="02"
                      titulo="Competências"
                      subtitulo={`${mesesSelecionados.length} mês${mesesSelecionados.length === 1 ? '' : 'es'}`}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        spacing={2}
                        sx={{ mb: 2 }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {faseDescoberta === 'aguardando-login'
                            ? 'Faça o login no Chrome que abriu...'
                            : faseDescoberta === 'descobrindo'
                              ? 'Lendo meses no SIAPS...'
                              : mesesAtualizadoEm
                                ? `Atualizado em ${new Date(mesesAtualizadoEm).toLocaleString('pt-BR')}`
                                : 'Lista estimada — clique pra ver o que o SIAPS realmente tem.'}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={
                            faseDescoberta === 'idle' ? (
                              <RefreshRoundedIcon sx={{ fontSize: 16 }} />
                            ) : (
                              <CircularProgress size={14} />
                            )
                          }
                          onClick={atualizarMeses}
                          disabled={faseDescoberta !== 'idle'}
                          sx={{ flexShrink: 0 }}
                        >
                          {faseDescoberta === 'idle' ? 'Atualizar lista' : 'Verificando...'}
                        </Button>
                      </Stack>
                      {erroDescoberta && (
                        <Typography
                          color="error"
                          variant="caption"
                          sx={{ display: 'block', mb: 2 }}
                        >
                          {erroDescoberta}
                        </Typography>
                      )}
                      <MesesSelector
                        meses={meses}
                        selecionados={mesesSelecionados}
                        onChange={setMesesSelecionados}
                      />
                    </SecaoCard>
                  </Stack>

                  <ActionPanel
                    refsCount={refsSelecionadas.size}
                    mesesCount={mesesSelecionados.length}
                    onExportar={exportar}
                  />
                </Box>
                </Box>
              </Fade>
            )}
          </Container>
        )}

        <Fade in={modo === 'rodando'} timeout={350} unmountOnExit>
          <Box>
            {modo === 'rodando' && progresso && (
              <ProgressView evt={progresso} onVoltar={voltarDeExecucao} />
            )}
          </Box>
        </Fade>

        <Fade in={modo === 'concluido'} timeout={350} unmountOnExit>
          <Box>
            {modo === 'concluido' && resultado && (
              <ResultView resultado={resultado} onVoltar={voltar} />
            )}
          </Box>
        </Fade>
      </Box>
    </Box>
  );
}

function SecaoCard({
  passo,
  titulo,
  subtitulo,
  children,
}: {
  passo: string;
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      sx={{
        backdropFilter: 'blur(12px)',
        backgroundColor: (t) => alpha(t.palette.background.paper, 0.85),
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 2.5 }}
        >
          <Stack direction="row" alignItems="baseline" spacing={1.5}>
            <Typography
              sx={{
                fontFamily: 'monospace',
                fontWeight: 700,
                color: 'primary.main',
                fontSize: 14,
                letterSpacing: 1,
              }}
            >
              {passo}
            </Typography>
            <Typography variant="h5" fontWeight={800} letterSpacing="-0.02em">
              {titulo}
            </Typography>
          </Stack>
          {subtitulo && (
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                px: 1.5,
                py: 0.5,
                borderRadius: 1,
                backgroundColor: (t) => alpha(t.palette.text.primary, 0.04),
                fontWeight: 600,
              }}
            >
              {subtitulo}
            </Typography>
          )}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}
