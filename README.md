# SIAPS Exporter

App desktop Windows que baixa automaticamente planilhas de indicadores do **SIAPS** (saude.gov.br) e envia formatadas pro **Google Sheets**.

## 🎯 Pra quem é

Profissionais que precisam baixar dezenas de planilhas de indicadores do SIAPS todo mês e levar pro Google Sheets.

## ⚡ Como funciona

1. Abre o app
2. Marca quais referências quer (dos 33 indicadores do SIAPS)
3. Escolhe os meses
4. Clica "Baixar e exportar"
5. Faz login no SIAPS uma vez na janela do navegador
6. O app baixa, limpa e sobe cada planilha pro Google Sheets automaticamente

## 🚀 Começando (dev)

### Pré-requisitos
- Node.js 20+
- npm

### Instalação
```bash
npm install
npx playwright install chromium
```

### Configuração do Google OAuth
Veja `docs/SETUP_GOOGLE_OAUTH.md` (leva 5 min).

### Testes isolados (recomendado antes de montar a UI)
```bash
# Testa só o scraper (abre navegador, pede login, baixa CSV)
npm run test:scraper

# Testa só o processamento de CSV
npm run test:processor ./downloads/teste.csv

# Testa só o upload pro Sheets
npm run test:sheets
```

### Rodar o app completo (dev)
```bash
npm run dev
```

### Gerar instalador Windows (.exe)
```bash
npm run dist
```
O instalador sai em `release/SIAPS Exporter Setup X.Y.Z.exe`.

**Importante**: o `.exe` precisa ser gerado num **ambiente Windows** pra evitar quirks. Três opções:

1. **Build numa máquina Windows** (recomendado): clone o repo, `npm install`, `npm run dist`.
2. **Cross-compile no Mac/Linux com Wine**:
   ```bash
   brew install --cask wine-stable
   npm run dist
   ```
3. **GitHub Actions com runner Windows** (CI): configurar workflow que builda em PR/tag.

### Requisitos na máquina do usuário
- Windows 10 ou 11
- Google Chrome instalado (o app usa o Chrome do sistema)
- Conexão com a internet

A primeira execução abre uma aba do navegador pra autorizar o Google Drive — depois disso o login é silencioso.

## 📂 Estrutura

Veja `CLAUDE.md` — documentação técnica completa do projeto. O Claude Code lê esse arquivo automaticamente ao abrir a pasta.

## 🛠️ Stack

- Electron + React + TypeScript
- Playwright (automação do navegador)
- SheetJS (processamento de CSV/XLSX)
- googleapis (Sheets + Drive v3)

## 📋 Status

- [x] Estrutura e documentação
- [x] Config das 33 referências
- [x] Scraper completo (Playwright + clicks robustos)
- [x] Processor de CSV
- [x] Upload pro Google Sheets
- [x] UI React (login, setup, progresso, resultado)
- [x] Empacotamento Electron (electron-builder.yml configurado)
- [ ] Build .exe testado no Windows real
