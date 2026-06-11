import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import type { Setor } from '../../shared/types';
import { metaSetor } from '../setoresMeta';

interface Props {
  setores: Setor[];
  selecionadas: Set<number>;
  onChange: (s: Set<number>) => void;
}

export function RefsSelector({ setores, selecionadas, onChange }: Props) {
  const toggle = (id: number) => {
    const next = new Set(selecionadas);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleSetor = (setor: Setor) => {
    const ids = setor.referencias.map((r) => r.id);
    const todasMarcadas = ids.every((id) => selecionadas.has(id));
    const next = new Set(selecionadas);
    if (todasMarcadas) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChange(next);
  };

  return (
    <Stack spacing={1.5}>
      {setores.map((setor) => {
        const meta = metaSetor(setor.chave);
        const Icone = meta.Icone;
        const marcadas = setor.referencias.filter((r) => selecionadas.has(r.id)).length;
        const total = setor.referencias.length;
        const todasMarcadas = marcadas === total;
        const algumas = marcadas > 0 && !todasMarcadas;
        const algoMarcado = marcadas > 0;

        return (
          <Accordion
            key={setor.chave}
            disableGutters
            defaultExpanded={false}
            sx={{
              border: `1px solid ${alpha(meta.cor, algoMarcado ? 0.4 : 0.12)}`,
              backgroundImage: algoMarcado
                ? `linear-gradient(135deg, ${alpha(meta.cor, 0.05)} 0%, ${alpha(meta.cor, 0.01)} 100%)`
                : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: meta.cor }} />}
              sx={{
                px: 2,
                '& .MuiAccordionSummary-content': {
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  m: 0,
                  py: 1.25,
                  gap: 2,
                },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={2} sx={{ flexGrow: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    backgroundColor: alpha(meta.cor, 0.12),
                    color: meta.cor,
                    flexShrink: 0,
                  }}
                >
                  <Icone />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2}>
                    {setor.nome}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {meta.descricao}
                  </Typography>
                </Box>
              </Stack>

              <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
                <Box
                  sx={{
                    px: 1.25,
                    py: 0.25,
                    borderRadius: 1.5,
                    fontSize: 12,
                    fontWeight: 700,
                    color: algoMarcado ? meta.cor : 'text.secondary',
                    backgroundColor: algoMarcado ? alpha(meta.cor, 0.12) : alpha('#0f172a', 0.04),
                    minWidth: 44,
                    textAlign: 'center',
                  }}
                >
                  {marcadas}/{total}
                </Box>
                <Checkbox
                  checked={todasMarcadas}
                  indeterminate={algumas}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSetor(setor);
                  }}
                  size="small"
                  sx={{
                    color: meta.cor,
                    '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: meta.cor },
                  }}
                />
              </Stack>
            </AccordionSummary>

            <AccordionDetails sx={{ pt: 0, pb: 2, px: 2 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 1,
                }}
              >
                {setor.referencias.map((ref) => {
                  const ativo = selecionadas.has(ref.id);
                  return (
                    <Button
                      key={ref.id}
                      onClick={() => toggle(ref.id)}
                      variant="outlined"
                      sx={{
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        px: 1.5,
                        py: 1,
                        gap: 1.25,
                        borderColor: ativo ? meta.cor : alpha('#0f172a', 0.12),
                        backgroundColor: ativo ? alpha(meta.cor, 0.08) : 'transparent',
                        color: 'text.primary',
                        fontWeight: 500,
                        textTransform: 'none',
                        '&:hover': {
                          borderColor: meta.cor,
                          backgroundColor: alpha(meta.cor, ativo ? 0.12 : 0.04),
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: 22,
                          height: 22,
                          borderRadius: 0.75,
                          display: 'grid',
                          placeItems: 'center',
                          backgroundColor: ativo ? meta.cor : alpha('#0f172a', 0.06),
                          color: ativo ? '#fff' : 'transparent',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }}
                      >
                        <CheckRoundedIcon sx={{ fontSize: 16 }} />
                      </Box>
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {ref.nome}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', fontFamily: 'monospace' }}
                        >
                          #{ref.id}
                        </Typography>
                      </Box>
                    </Button>
                  );
                })}
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Stack>
  );
}
