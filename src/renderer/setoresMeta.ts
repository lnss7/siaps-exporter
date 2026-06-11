import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import SentimentSatisfiedAltRoundedIcon from '@mui/icons-material/SentimentSatisfiedAltRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import DirectionsWalkRoundedIcon from '@mui/icons-material/DirectionsWalkRounded';
import GavelRoundedIcon from '@mui/icons-material/GavelRounded';
import SailingRoundedIcon from '@mui/icons-material/SailingRounded';
import type { SvgIconComponent } from '@mui/icons-material';

export interface SetorMeta {
  cor: string;
  corClara: string;
  Icone: SvgIconComponent;
  descricao: string;
}

// Paleta da app: #000000 / #ff8830 / #d1b8a0 / #aeced2 / #cbdcdf
// Cada setor usa uma cor da paleta; quando o tom original é muito claro pra
// servir de borda/ícone, usamos uma versão escurecida em `cor` e mantemos o
// tom original em `corClara`.
export const SETOR_META: Record<string, SetorMeta> = {
  esf_eap: {
    cor: '#ff8830',     // laranja (paleta)
    corClara: '#ffd6b8',
    Icone: HomeRoundedIcon,
    descricao: 'Equipe de Saúde da Família e Equipe de Atenção Primária',
  },
  esb: {
    cor: '#5a8b91',     // azul médio (derivado de #aeced2)
    corClara: '#aeced2',
    Icone: SentimentSatisfiedAltRoundedIcon,
    descricao: 'Equipe de Saúde Bucal',
  },
  emulti: {
    cor: '#000000',     // preto (paleta)
    corClara: '#cccccc',
    Icone: GroupsRoundedIcon,
    descricao: 'Equipe Multiprofissional na Atenção Primária à Saúde',
  },
  ecr: {
    cor: '#a88862',     // bege escuro (derivado de #d1b8a0)
    corClara: '#d1b8a0',
    Icone: DirectionsWalkRoundedIcon,
    descricao: 'Equipe de Consultório na Rua',
  },
  eapp: {
    cor: '#4a6065',     // cinza-azul escuro (derivado de #cbdcdf)
    corClara: '#cbdcdf',
    Icone: GavelRoundedIcon,
    descricao: 'Equipe de Atenção Primária Prisional',
  },
  esfr: {
    cor: '#d96820',     // laranja escuro (derivado de #ff8830)
    corClara: '#ffb780',
    Icone: SailingRoundedIcon,
    descricao: 'Equipe de Saúde da Família Ribeirinha',
  },
};

export function metaSetor(chave: string): SetorMeta {
  return (
    SETOR_META[chave] ?? {
      cor: '#4a4a4a',
      corClara: '#cccccc',
      Icone: HomeRoundedIcon,
      descricao: '',
    }
  );
}
