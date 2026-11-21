---
name: dual-surface-cockpit
description: >-
  Projeta e implementa as duas superficies web do Uzina Studio no Next.js App Router:
  Superficie Executiva (/exec/* — PRD, Aprovacoes, Entregas) e Superficie Tecnica
  (/app/* — Torre de Controle, Caixa de Decisoes, Worktrees, Diffs, SAST e FinOps).
  Use esta skill em conjunto com cockpit-ui-craft e .uzina/DESIGN.md ao desenvolver telas do cockpit.
---

# Dual-Surface Cockpit — Superfícies Executiva e Técnica (Uzina Studio)

Esta skill define a arquitetura funcional e de segurança das duas superfícies web do **Uzina Studio** no Next.js App Router (`apps/web`), devendo sempre obedecer aos tokens e regras de `.uzina/DESIGN.md`, `cockpit-ui-craft` e `ui-visual-qa-critic`.

---

## 1. Superfície Técnica (`/app/...`)

Projetada para o CTO, liderança técnica e operadores auditarem entregas e governança em alta densidade:
1. **Torre de Controle & Navegação Hierárquica:**
   - Sidebar (`Org → Cliente ("Internos" padrão) → Projeto (+ Repos) → Entrega`), visualizações alternáveis em 1 clique (**Kanban Vivo** e **Lista Hierárquica** na Fase 1) e atalho `Cmd+K`.
2. **Caixa de Decisões HITL & Pacote de Evidências:**
   - Aprovação de descoberta, blueprints, `.uzina/DESIGN.md`, intervenções do `StuckDetector` e Pacotes de Evidências (resumo, aderência à spec, build/testes, diff navegável e custo em `tabular-nums`).
3. **Telemetria de Execução, Worktrees & Console AppSec (SARIF):**
   - Stream SSE em tempo real (`ExecutionEventSchema`), worktrees ativos, consumo por papel (`discovery`, `architect`, `visual`, `builder`, `verifier`, `security`, `copilot`) e painel de achados SARIF em 3 vereditos (`confirmed | false_positive | unknown`).
4. **Configurações & Cofre de Provedores:**
   - Gestão de `provider_profiles` (OmniRoute / OpenAI-compatible / Anthropic / Google / Ollama) com chaves mascaradas e nunca retornadas em texto claro pela API.

---

## 2. Superfície Executiva (`/exec/...`) & Drawer Co-piloto

Projetada para PMs, fundadores em modo negócio e stakeholders validarem valor de produto **sem ruído técnico**:
1. **Escopo, PRD Vivo & Aprovações de Negócio:**
   - Entrevista de descoberta (2–3 rodadas nos 5 pilares), Resumo de Alinhamento + Premissas Assumidas, aprovação visual de direções e linha do tempo de entregas.
2. **Drawer Persistente do Co-piloto Executivo (Dia 1):**
   - Acessível via streaming SSE (AI SDK UI) sobre Mastra `.network()`, limitado a leitura de negócio e criação de rascunhos/propostas (proibido de escrever código ou rodar shell).
3. **Barreira Estrita de Visibilidade:**
   - Rotas `/exec/*` e `/api/exec/*` são **proibidas** de expor branches/worktrees Git, diffs de código, logs internos de terminal, SARIF bruto ou custos internos em tokens.
