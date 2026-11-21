# Guia de Setup do Ambiente Local — Uzina Studio

## 1. Requisitos Base (Já Verificados no Workspace)
* **Node.js 22 LTS** (`v22.19.0` verificado)
* **pnpm** (`12.21.0` instalado globalmente via `npm`)
* **Git** (`2.51.0` verificado)

## 2. Atenção ao OneDrive no Windows
Este repositório reside em `OneDrive\Documentos\_Fabrica_softwares`. Pastas com escrita intensa de arquivos pequenos (`node_modules/`, `.next/`, `data/pgdata/`, `.worktrees/`) podem sofrer locks (`EPERM` / `EBUSY`) quando o cliente OneDrive tenta sincronizá-las em tempo real.

**Recomendações práticas:**
1. Ao rodar o sistema localmente, você pode apontar `UZINA_DATA_DIR` no `.env` para um diretório local fora do OneDrive (ex.: `C:\uzina-data`).
2. Se notar lentidão ou erro `EBUSY` durante `pnpm install` ou `next dev`, pause temporariamente a sincronização do OneDrive ou exclua as pastas geradas da sincronização.

## 3. Repositório Remoto (GitHub)
O repositório está conectado ao remote oficial `origin`:
* `https://github.com/Matheus-Gama-deluna/uzina-studio.git` (branch `main` rastreando `origin/main` via Git Credential Manager).

## 4. Ferramentas Opcionais Instaladas Sob Demanda
Não são necessárias para a **Fase 0** nem para iniciar o **Slice 0** em modo PGlite, mas serão úteis nos slices indicados:

| Ferramenta | Quando será necessária | Como usar / instalar no Windows |
| :--- | :--- | :--- |
| **Docker Desktop** | Slice 0 (opcional p/ Postgres local) e Slice 6 | `winget install Docker.DockerDesktop` e rodar `docker compose -f docker-compose.dev.yml up -d` |
| **GitHub CLI (`gh`)** | Slice 4 (`stage_finalize` com abertura automática de Draft PR) | `winget install GitHub.cli` e `gh auth login` |
| **OpenCode CLI** | Slice 2+ (execução real de agentes `plan`/`build` em worktrees) | Instalação conforme documentação oficial do OpenCode (`opencode.ai`) |
| **Scanners AppSec** | Slice 4 (`gitleaks`, `opengrep`/`semgrep`, `trivy`, `osv-scanner`) | Instaláveis via `uzina sec install-tools` para `~/.uzina/bin` ou pré-embarcados no Docker do Slice 6 |
