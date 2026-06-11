import { createTheme, alpha } from '@mui/material/styles';

// Paleta principal (definida pela usuária):
//   #000000  preto
//   #ff8830  laranja (cor de ação)
//   #d1b8a0  bege/areia
//   #aeced2  azul claro
//   #cbdcdf  azul-cinza pálido
const PRIMARY = '#ff8830';
const PRIMARY_DARK = '#d96820';
const PRIMARY_LIGHT = '#ffb780';
const SECONDARY = '#aeced2';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: PRIMARY,
      dark: PRIMARY_DARK,
      light: PRIMARY_LIGHT,
      contrastText: '#ffffff',
    },
    secondary: {
      main: SECONDARY,
      light: '#cbdcdf',
      dark: '#8ab1b6',
      contrastText: '#000000',
    },
    background: {
      default: '#f5f7f8', // off-white com leve tom da paleta
      paper: '#ffffff',
    },
    text: {
      primary: '#000000',
      secondary: '#4a4a4a',
    },
    success: { main: '#4a9d6f' },
    error: { main: '#c0392b' },
    warning: { main: PRIMARY },
    info: { main: SECONDARY },
    divider: alpha('#000000', 0.08),
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.02em' },
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0' },
    body1: { lineHeight: 1.6 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10, paddingInline: 20, paddingBlock: 10 },
        containedPrimary: {
          boxShadow: `0 6px 20px -8px ${alpha(PRIMARY, 0.6)}`,
          '&:hover': { boxShadow: `0 8px 24px -8px ${alpha(PRIMARY, 0.7)}` },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: `1px solid ${alpha('#000000', 0.06)}`,
          boxShadow: `0 1px 3px ${alpha('#000000', 0.04)}, 0 1px 2px ${alpha('#000000', 0.06)}`,
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${alpha('#000000', 0.08)}`,
          '&:before': { display: 'none' },
          '&.Mui-expanded': { margin: 0 },
          boxShadow: 'none',
          overflow: 'hidden',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: { padding: 6 },
      },
    },
  },
});
