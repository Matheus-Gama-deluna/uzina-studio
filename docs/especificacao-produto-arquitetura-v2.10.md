# Especificação de Produto e Arquitetura — Sistema de Engenharia de Software com IA

**Documento vivo de produto, UX/UI, ecossistema, codebase intelligence, estúdio visual e arquitetura técnica pronto para guiar o desenvolvimento (Versão 2.10 — Novembro de 2026 · Mastra Core + OpenCode)**

## Histórico de Versões

- **Versão 2.0–2.8 (Novembro de 2026):** Arquitetura Mastra Core (Apache 2.0) + OpenCode (MIT), Co-piloto Executivo desde o Dia 1, Persistência Dual-Mode (PGlite/LibSQL → PostgreSQL), Hierarquia 4 níveis (`Organização → Cliente → Projeto → Entrega`), Entrevista 2–3 rodadas (5 Pilares), Estúdio Visual (Etapa 2.5 + `.factory/DESIGN.md`), Codebase Intelligence em 4 camadas, Engenharia de Confiabilidade (`StuckDetector`), Padrões de Fábricas em Produção, Guardrails de Segurança/Migrações, Padrões Táticos de Orquestração, Prompt Cache Hygiene, Scorecards de Maturidade e Seletor de 6 Estratégias de Desenvolvimento + Vertical Slice / MSW / Tests as Data.
- **Versão 2.9 (Novembro de 2026):** Adição da 8ª skill nativa (`test-quality-engineering`) na Seção 5.3.C e criação da Seção 5.15 (Engenharia de Qualidade de Testes: Anti-Bloat, Auditor de Test Anti-Patterns, Mutation Testing Incremental, Mutação Semântica estilo Meta ACH, Property-Based Testing e Fluxo Consolidado v2.9).
- **Versão 2.10 (Novembro de 2026):** Inclusão da Seção 5.16 (Módulo Autônomo de Segurança `AppSec Engine` dual-mode e catálogo curado de ferramentas open-source complementares) e criação das tabelas `security_scans` e `security_findings` na Seção 5.4.

---

# 1. Visão, Propósito e Fundamentos de Engenharia de Software

## 1.1 O problema que este sistema resolve

A adoção de agentes autônomos de programação reduziu drasticamente o tempo necessário para gerar código, mas deslocou o gargalo da engenharia de software para outras etapas do ciclo. Segundo o [State of AI Code Quality Report 2026 da Qodo](https://www.qodo.ai/state-of-ai-code-quality-report/), 47,7% dos líderes de engenharia apontam revisar e validar código gerado por IA como o maior gargalo de qualidade e governança, e apenas 3,7% consideram seus processos tradicionais suficientes. Como reforça a análise de ciclo de desenvolvimento da [Factory AI no ZenML](https://www.zenml.io/llmops-database/building-the-ai-powered-software-factory-across-the-sdlc), otimizar apenas a geração de código sem redesenhar especificação, verificação e operação transfere o engarrafamento para a revisão e para incidentes em produção.

Este sistema nasce para operar uma empresa de desenvolvimento de software movida a IA com rigor real de engenharia de software — substituindo o "vibe coding" (prompts soltos em terminais isolados) por uma **máquina de estados rígida de SDLC** governada por especificações versionadas, execuções isoladas, pacotes objetivos de evidências e memória institucional contínua.

## 1.2 Princípios inegociáveis do sistema

- **Máquina de estados antes do agente:** nenhuma fase avança sem produzir o artefato esperado e passar pelo portão de validação (*gate*) correspondente.
- **Duas trilhas nativas (Greenfield e Brownfield):** projetos novos e sistemas em andamento nunca compartilham a mesma porta de entrada. Projetos novos começam por descoberta, PRD e arquitetura; projetos em andamento passam obrigatoriamente por diagnóstico técnico, mapa de arquitetura/riscos e criação de rede de segurança (testes de caracterização) antes de qualquer edição de código.
- **Especificação como contrato (Spec-Driven Development):** requisitos, regras de negócio, contratos de API e critérios de aceite vivem como artefatos estruturados e versionados no repositório ([SoftDesign](https://www.softdesign.com.br/blog/spec-driven-development/)). Toda tarefa de código aponta explicitamente para a especificação que a justifica.
- **Confiança baseada em evidências:** a declaração de um agente dizendo "terminei" não tem valor operacional. Aprovação humana só ocorre sobre um pacote verificável de evidências (diff legível, build verde, testes passando, análise estática/segurança, aderência à spec e custo real em tokens).
- **Separação de responsabilidades:** o agente que escreve o código não é o único responsável por aprová-lo; verificação automatizada (CI, testes, análise estática) e revisão independente antecedem a decisão humana.
- **Memória viva transversal:** decisões arquiteturais (ADRs), padrões de código e lições aprendidas de bugs alimentam continuamente tanto o repositório atual quanto a base de conhecimento da empresa.

---

# 2. Modelo Operacional, Perfis e Ritmo de Uso

## 2.1 Os três modos operacionais integrados

| Camada | Público principal | Modo operacional | Papel no dia a dia |
| :--- | :--- | :--- | :--- |
| **Camada Executiva e de Produto** | Fundador (modo negócio), PMs e Clientes | **Co-piloto Executivo** (contínuo do dia 1 ao pós-entrega) | Coleta contexto, regras de negócio e prioridades em linguagem natural; mantém PRD e escopo atualizados ao lado; traduz avanços técnicos em boletins executivos claros e coleta aprovações de negócio — sem expor Git, diffs, logs ou custos internos. |
| **Camada Técnica — Visão Global** | Fundador (modo CTO) e Liderança Técnica | **Torre de Controle** (Home técnica) | Monitora todo o portfólio de projetos (trilha Greenfield/Brownfield, fase atual, semáforo de saúde e gasto em tokens) e concentra a **Caixa de Decisões Técnicas** (aprovações de specs, dúvidas de agentes e merges). |
| **Camada Técnica — Visão do Projeto** | Operadores técnicos e desenvolvedores | **Estúdio de Engenharia** (workspace do projeto) | Conduz a esteira técnica completa (Diagnóstico/Descoberta → Spec → Milestones/Slices → Execução isolada → Pacote de Evidências → Merge e Deploy). |

## 2.2 A ponte bidirecional entre Negócio e Engenharia

- **Fluxo Negócio → Engenharia (proteção contra escopo caótico):** quando um PM ou cliente solicita uma feature ou alteração no Co-piloto Executivo, o sistema não dispara código diretamente. Ele estrutura a demanda em requisito com critérios de aceite e a envia como **Proposta de Mudança** para a Caixa de Decisões Técnicas, onde passa por avaliação de impacto (especialmente crítica em projetos Brownfield) e atualização formal da especificação.
- **Fluxo Engenharia → Negócio (fim do status report manual):** toda vez que um milestone ou slice é aprovado com evidências verdes no Estúdio de Engenharia, o sistema gera automaticamente uma atualização em linguagem executiva no Co-piloto Executivo — destacando o que mudou para o usuário final, o que foi validado e o link do ambiente de preview.

## 2.3 Perfis de acesso (RBAC) e visibilidade

- **Admin / CTO (Acesso Total):** opera Torre de Controle, Estúdio de Engenharia, Co-piloto Executivo, gestão de orçamentos, chaves/adaptadores e permissões.
- **Operador Técnico / Engenheiro:** opera Torre de Controle (projetos atribuídos) e Estúdio de Engenharia completo (specs, execuções, diffs, QA, PRs e memória técnica).
- **PM / Produto:** opera o Co-piloto Executivo, gestão de PRDs/requisitos, visualização executiva de progresso e aprovação de escopo/entregas (sem acesso a custos de tokens internos, segredos ou terminal de execução).
- **Cliente Externo (Fase 3):** acesso restrito por projeto exclusivamente à **Visão Executiva** (Co-piloto Executivo, linha do tempo de entregas, links de preview e aprovações de negócio).

## 2.4 Autonomia graduada e governança de risco

Cada projeto ou etapa pode ser configurado em uma de três marchas operacionais, sempre sujeitas a teto de gasto por projeto/milestone e *kill switch* imediato:

1. **Assistido:** o agente propõe o plano de cada slice/tarefa e aguarda aprovação humana antes de executar.
2. **Supervisionado (padrão recomendado):** o agente planeja, implementa em worktree isolado, roda testes e verificações, e para obrigatoriamente na **Central de Aprovações** com o Pacote de Evidências pronto para merge.
3. **Autônomo Controlado:** permitido apenas para tarefas de baixo risco (ex.: documentação, testes unitários, correções triviais ou publicação em ambiente de preview), com teto rígido de tokens e rollback automático em caso de falha de CI.

## 2.5 Hierarquia de organização: Organização → Cliente → Projeto → Entrega

Para sustentar a operação de software houses, consultorias e times de produto próprios sem vazamento de dados ou mistura de contextos, a modelagem operacional organiza-se estritamente em quatro níveis hierárquicos:

- **1. Organização:** nível corporativo que detém a conta master, cofre global de provedores/chaves, teto orçamentário mensal unificado, equipe técnica interna e catálogo global de skills da casa.
- **2. Cliente / Conta:** agrupador comercial e de escopo. Todo sistema nasce com a conta padrão `"Internos"` para produtos e ferramentas da própria empresa. Clientes externos agrupam múltiplos projetos, teto orçamentário consolidado da conta, gestão de stakeholders para o Portal Executivo e escopo isolado de memória.
- **3. Projeto + Multi-Repositório:** unidade de engenharia definida por sua trilha (Greenfield ou Brownfield), marcha de autonomia, roteamento de modelos e vinculação a um ou mais repositórios Git via `project_repositories` (suportando arquiteturas multi-repo/microsserviços).
- **4. Ciclo de Entrega:** esteira de execução atômica vinculada às specs aprovadas (Specs → Milestones → Slices → Tasks → Pacote de Evidências).

**Isolamento rígido de memória em 3 escopos (via `@mastra/memory`):**

- **Memória da Organização:** padrões de código globais, diretrizes de segurança da empresa e catálogo de skills compartilhadas.
- **Memória do Cliente:** regras de negócio do cliente, glossário corporativo, histórico de decisões executivas e preferências de UI — estritamente isolada e nunca compartilhada entre contas de clientes diferentes.
- **Memória do Projeto:** mapa arquitetural (Raio-X Brownfield), ADRs específicas do repositório, histórico de bugs resolvidos e lições aprendidas das tarefas.

**Portal Unificado do Cliente (`/exec/c/:clientSlug`):** stakeholders pertencentes a um cliente com múltiplos projetos acessam um portal centralizado onde alternam entre seus projetos autorizados sob o mesmo login, visualizando resumos executivos, links de preview e aprovações sem qualquer acesso a código, Git ou custos internos.

---

# 3. Arquitetura de UX/UI e Fluxos de Tela

## 3.1 Separação de superfícies de navegação

- **Superfície Técnica (`/app/...`):** barra lateral enxuta com *Torre de Controle (Home)*, *Caixa de Decisões*, *Projetos*, *Custos & Orçamento*, *Memória da Empresa* e *Configurações/Adaptadores*.
- **Superfície Executiva (`/exec/:projectId`):** experiência limpa e sem ruído técnico com *Co-piloto Executivo*, *Escopo & PRD Vivo*, *Linha do Tempo de Entregas* e *Aprovações Pendentes*.
- **Acesso contínuo ao Co-piloto Executivo (Chat Persistente):** presente desde o dia 1 em toda a aplicação por meio de um painel/drawer lateral de chat sempre acessível no projeto, permitindo conversar a qualquer momento com o agente responsável pela ponte entre negócio e engenharia (respeitando as restrições de segurança que bloqueiam escrita direta em código de produção).

## 3.2 Anatomia das telas principais

### Tela 1 — Torre de Controle (Home Técnica)
- **Faixa superior de saúde operacional:** número de projetos ativos, itens aguardando decisão humana, execuções rodando agora e gasto acumulado no mês vs. teto global.
- **Lista / grade de projetos:** nome, cliente, selo de trilha (**Greenfield** ou **Brownfield**), fase atual do SDLC, progresso do milestone ativo, indicador de saúde (Verde / Atenção / Bloqueado) e custo consumido vs. orçamento.
- **Acesso rápido à Caixa de Decisões:** preview das 3 decisões mais urgentes sem precisar trocar de tela.

### Tela 2 — Caixa de Decisões ("Inbox do Operador")
Fila unificada que agrupa todos os pontos que exigem julgamento humano em todos os projetos, filtrável por tipo e urgência:
- **Propostas vindas do Co-piloto Executivo:** novos requisitos ou mudanças de escopo aguardando triagem técnica.
- **Aprovações de Diagnóstico / Spec:** mapa arquitetural de projeto Brownfield ou spec técnica pronta antes de liberar implementação.
- **Dúvidas e Aprovações de Agentes em Execução:** perguntas estruturadas e pedidos de confirmação disparados via `suspend()/resume()` e `requireApproval` do [Mastra](https://mastra.ai/docs/workflows/human-in-the-loop).
- **Pacotes de Evidências prontos para Merge:** PRs com testes verdes aguardando aprovação final em 1 clique (ou devolução com feedback objetivo).

### Tela 3 — Estúdio de Engenharia (Workspace do Projeto)
- **Esteira de Fases (topo fixo):** barra visual mostrando o avanço na trilha do projeto (Greenfield e Brownfield).
- **Aba Especificações & Memória:** visualização e edição de PRDs, specs versionadas, ADRs e mapa de arquitetura versionados em `.factory/specs/` no repositório Git e indexados na memória persistente do Mastra.
- **Aba Execução & Worktrees:** árvore de Milestones → Slices → Tasks com status em tempo real, visualização de logs/tool calls via streaming, botão de pausar/cancelar (*kill switch*) e abertura rápida de diff.
- **Aba Pacote de Evidências (Revisão):** (1) resumo executivo e técnico da mudança, (2) checklist automático de aderência aos critérios da spec, (3) resultado do build, testes unitários/E2E e análise estática/segurança, (4) diff navegável por arquivo e (5) custo exato em tokens daquela entrega.
- **Aba Co-piloto Executivo (visão espelhada):** histórico de conversas de negócio e revisão do resumo executivo antes de enviar ao cliente.
- **5 Visualizações alternáveis em 1 clique** (com atalho `Cmd+K` e filtros salvos, inspirados no [Linear](https://linear.app/), [Plane](https://plane.so/blog/plane-versus-linear-which-should-you-choose-in-2026), [Mastra Factory](https://factory.mastra.ai/) e [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)): (1) **Kanban Vivo**, (2) **Lista Hierárquica**, (3) **Timeline / Roadmap**, (4) **Momento do Sistema** e (5) **Entregas**.

### Tela 4 — Fluxo de Criação de Projeto (Onboarding Greenfield vs. Brownfield)
- **Fluxo Greenfield:** conecta repositório vazio (ou cria um novo), abre sessão inicial no Co-piloto Executivo para estruturar o PRD, gera proposta de stack + arquitetura + esqueleto inicial (*walking skeleton*) e trava no primeiro *gate* de aprovação.
- **Fluxo Brownfield:** conecta repositório existente, dispara automaticamente uma execução somente-leitura de **Diagnóstico Técnico** (stack, módulos, dependências, fluxos críticos, cobertura de testes e dívidas de segurança), apresenta o relatório de Raio-X para validação humana e exige definição de testes de caracterização antes de liberar edições.

### Tela 5 — Co-piloto Executivo (Visão de Negócio / PM / Cliente)
- **Esquerda (Conversa Contínua):** chat em linguagem clara focado em valor, prazos, riscos e entregas — sem jargão de código.
- **Direita (Artefato Vivo & Entregas):** alterna entre PRD/Escopo editável ("Enviar para Engenharia"), linha do tempo visual de milestones e cartão de validação com preview e "Aprovar Entrega" / "Solicitar Ajuste".

## 3.3 Protocolo de Entrevista Estruturada (Máximo Contexto sem Entrevista Infinita)

1. **Pré-leitura silenciosa (Passo 0):** extrai tudo o que já foi dito na mensagem inicial, consulta a Memória do Cliente/Organização e, em projetos Brownfield, lê o Raio-X do repositório — proibindo perguntas óbvias.
2. **Máximo de 2 a 3 rodadas curtas e agrupadas:** máximo de 3 a 4 perguntas por rodada focadas em decisões de alto impacto, sempre oferecendo opções concretas e recomendação padrão pré-marcada.
3. **Critério objetivo de parada (Checklist dos 5 Pilares):** (a) Objetivo e valor de negócio, (b) Fluxos críticos e regras de exceção, (c) Restrições técnicas e integrações, (d) Critérios objetivos de aceite e (e) Fora de escopo explícito.
4. **Saída acionável e válvula de escape:** ao final (ou pelo botão "Avançar com padrões recomendados"), apresenta **Resumo de Alinhamento + Tabela de Premissas Assumidas** para aprovação em 1 clique.

## 3.4 Incrementos de UX/UI consolidados do Benchmark de Mercado (Visão Completa)

1. **Entrevista Ativa de Escopo:** inspirada no `/missions` da [Factory AI](https://www.developersdigest.tech/blog/claude-code-vs-droid-2026).
2. **DeepWiki Navegável + Steering Files (`.factory/steering.md`):** inspirados no DeepWiki do [Devin](https://docs.devin.ai/release-notes/2026) e Steering Files/Hooks do [AWS Kiro](https://plainenglish.io/aws/aws-kiro-moving-beyond-prompt-to-code-development).
3. **Memória Sugerida em 1 Clique no Worklog:** inspirada no Suggested Knowledge do [Devin](https://docs.devin.ai/release-notes/2026).
4. **Pausa Inteligente por Orçamento:** inspirada nos limites da [Factory AI](https://www.developersdigest.tech/blog/factory-droid-review-setup-2026), executando `suspend()` preservando o snapshot.
5. **Chat no Diff + QA Visual com Capturas/Vídeo:** combinando PR Chat do [Graphite](https://graphite.com/) e Droid Control da [Factory AI](https://www.developersdigest.tech/blog/factory-droid-review-setup-2026).
6. **Signals & Automação por Eventos Externos:** inspirados nos Signals do [Mastra Factory](https://factory.mastra.ai/) e Linear Asks do [Linear](https://linear.app/docs/start-guide).

## 3.5 Etapa 2.5 — Estúdio Visual, Moodboard Multi-Fonte e Prototipagem em 3 Níveis

Etapa visual dedicada entre **2. Spec & Constituição** e **3. Organização / 4. Execução** (automática para projetos com UI Web/Mobile e pulada em APIs puras). Contrato central: `.factory/DESIGN.md` + tokens W3C (`tokens.json`), sem vendor lock-in.

- **A. Captação Rica de Referências (Moodboard & Inbox Visual):**
  - Moodboard com tags de intenção (paleta da URL A, navegação do print B, densidade da tabela C).
  - Extração automática de sites vivos via [Dembrandt](https://github.com/dembrandt/dembrandt) (`--design-md`, `--tailwind`, `--shadcn`, `--dtcg`, `--dark-mode`, `--wcag`, [Dembrandt Docs](https://www.dembrandt.com/getting-started)).
  - Rabiscos, fotos e canvas leve (estilo Excalidraw).
  - Repositórios de designers via [Penpot MCP](https://github.com/penpot/penpot) (MPL-2.0, [ModeInspect](https://modeinspect.com/blog/figma-alternatives-for-product-teams)), [Figma MCP](https://sotaaz.com/post/stitch-mcp-vs-figma-mcp-en) ou reaproveitamento do `DESIGN.md` de outro projeto do Cliente.

- **B. Prototipagem em 3 Níveis de Fidelidade (Interface `DesignPrototypeAdapter`):**

| Nível | Formato do Protótipo | Motores Plugáveis | Quando Usar |
| :--- | :--- | :--- | :--- |
| **Nível 1 · Estrutura** | Wireframe & Fluxo de Telas | Canvas leve (Excalidraw / blocos esquemáticos) | Validar arquitetura de informação e jornada antes de discutir estética. |
| **Nível 2 · Direção Visual** | **Protótipos em Imagem (Mockups de Alta Fidelidade)** | Modelos de geração/edição de imagem via provedor ou OmniRoute (Gemini Image, GPT Image, Flux) | Exploração estética rápida e livre: gerar 2–4 variações visuais da mesma tela para aprovação no `/exec` antes de escrever código. |
| **Nível 3 · Interativo & Handoff** | **Protótipo Clicável & Contrato `.factory/DESIGN.md`** | Motor Nativo HTML/Tailwind (OpenCode, 100% self-hosted), [Google Stitch MCP](https://www.therundown.ai/tools/stitch), [Penpot MCP](https://github.com/penpot/penpot), [Figma MCP](https://sotaaz.com/post/stitch-mcp-vs-figma-mcp-en) ou [Onlook](https://modeinspect.com/blog/figma-alternatives-for-product-teams) | Converter a direção aprovada em `.factory/DESIGN.md` + tokens W3C para implementação fiel no OpenCode. |

- **C. Handoff para Engenharia e QA Visual:** `.factory/DESIGN.md` salvo ao lado de `.factory/steering.md` no prefixo estável de Prompt Cache; QA Visual pós-build via Playwright + checagem de tokens ([design-extract](https://github.com/Manavarya09/design-extract)).

---

# 4. Ecossistema, Projetos Open-Source e Decisões de Reaproveitamento

Arquitetura em duas peças centrais open-source — **[Mastra Core](https://mastra.ai/) (Apache 2.0)** + **[OpenCode](https://github.com/anomalyco/opencode) (MIT)** — mantendo estritamente fora do escopo os módulos proprietários `ee/` do Mastra e fixando versões exatas com `--frozen-lockfile`.

| Camada | Ferramenta / Projeto Open-Source | Papel no nosso sistema | Por que usar e limites arquiteturais |
| :--- | :--- | :--- | :--- |
| **Cérebro de Agentes, Workflows e Memória** | [Mastra Core](https://github.com/mastra-ai/mastra) (`@mastra/core`, Apache 2.0) | Agent Network (`.network()`), workflows duráveis (`createWorkflow` + `suspend`/`resume`), `@mastra/memory`, contexto e streaming | Fonte única de verdade em TypeScript puro. Apenas núcleo Apache 2.0 (zero `ee/`); inspirado no [Mastra Factory](https://factory.mastra.ai/). |
| **Harness Especializado de Código** | [OpenCode](https://github.com/anomalyco/opencode) (MIT) | Leitura, diagnóstico, edição de código, terminal e LSP em Git worktrees | Servidor HTTP + [SDK TypeScript](https://opencode.ai/docs/it/sdk/), modos `plan` e `build`, 75+ provedores, MCP, ACP e [Agent Skills (`SKILL.md`)](https://opencode.ai/docs/de/skills/). |
| **Persistência (Zero-Config → PostgreSQL)** | [@mastra/libsql](https://mastra.ai/docs/storage) + [PGlite](https://chat2db.ai/resources/blog/pglite-vs-sqlite) (local) → [@mastra/pg](https://mastra.ai/docs/storage) + PostgreSQL/pgvector (VPS) | Memória, snapshots, vetores e tabelas relacionais do Painel | Começa zero-config no PC e migra para PostgreSQL com 1 linha (`DATABASE_URL`), mantendo dialeto SQL PostgreSQL único. |
| **Gateway de Modelos e Teto de Custos** | [OmniRoute](https://github.com/cheaper-inference/OmniRoute) / [LiteLLM](https://www.litellm.ai/) | Proxy unificado OpenAI-compatible e governança financeira | Centraliza roteamento fixo por papel, fallbacks e limites rígidos de orçamento. |
| **Observabilidade e Evals** | Mastra OTEL + Scorers + [Langfuse](https://github.com/langfuse/langfuse) (opcional) | Traces, spans, métricas, custos e avaliações | Audita chamadas, detecta loops e calibra scorers. |
| **Isolamento de Execução** | Git Worktrees locais (Fase 1) → Docker / [Daytona](https://www.daytona.io/) (Fase 2/3) | Isolamento de filesystem e processos por tarefa | Leve no PC local; containers/sandboxes efêmeros em VPS multi-tenant. |
| **Qualidade, Testes e Segurança (CI)** | `.factory/verify` + Playwright + `packages/security-engine` | Pacote de Evidências verificável | Verificação real fora da sessão do agente autor ([Qodo](https://www.qodo.ai/academy/ai-code-review/)). |
| **Referências Arquiteturais** | [Mastra Factory](https://github.com/mastra-ai/template-factory) e [Paperclip](https://github.com/paperclipai/paperclip) | Padrões de governança e concorrência | Sessão revisora independente, App Previews, checkout atômico SQL (`409 Conflict`). |

---

# 5. Arquitetura Técnica Detalhada

## 5.1 Stack tecnológica e conexão Painel ↔ Mastra ↔ OpenCode

- **Monorepo `pnpm`:** versões exatas fixadas (`save-exact=true`, `--frozen-lockfile`, mitigando riscos de supply chain como o incidente npm de junho de 2026 registrado pela [StepSecurity](https://www.stepsecurity.io/blog/mastra-npm-packages-compromised-using-easy-day-js)).
- **Frontend (`apps/web`):** Next.js App Router + React + TypeScript + Tailwind CSS + Radix UI + TanStack Query + streaming retomável ([AI SDK UI no Mastra](https://mastra.ai/integrations/agentic-ui/ai-sdk-ui)).
- **Orquestrador Central:** [Mastra Core](https://mastra.ai/docs/agents/overview) em Node.js 22+.
- **Ponte de Execução (`packages/opencode-bridge`):** [SDK oficial do OpenCode](https://opencode.ai/docs/it/sdk/), gerenciando sessões por Git worktree (`plan` e `build`) e `StructuredOutput`.
- **Persistência Dual-Mode:** `LibSQLStore` + `PGlite` (sem `DATABASE_URL`) → `PostgresStore` + `node-postgres` (com `DATABASE_URL=postgres://...`).
- **Autenticação e RBAC Próprios:** Better Auth (sem módulos `ee/` do Mastra).

## 5.2 Arquitetura de Agentes, Agent Network e Co-piloto Executivo Restrito

Baseada no [Agent Networks (`.network()`) do Mastra](https://mastra.ai/docs/agents/networks):

| Agente | Escopo / Papel | Ferramentas e Acesso ao Código | Restrições e Governança |
| :--- | :--- | :--- | :--- |
| **Co-piloto Executivo** | Interface contínua de negócio; mantém PRD vivo, traduz entregas e abre Propostas de Mudança | Leitura de PRD, status, linha do tempo e memória de negócio; criação de Proposta de Mudança | **Bloqueio estrito no código:** zero escrita de código, Git, OpenCode `build`, shell, logs internos ou custos em tokens. |
| **Orquestrador / Supervisor** | Roteia demandas entre agentes, coordena trilhas e escala bloqueios para Caixa de Decisões | Leitura de estado, disparo de workflows duráveis e `suspend`/`resume` | Nunca executa código direto na branch principal; respeita orçamentos e marchas. |
| **Arqueólogo & Arquiteto** | Raio-X Brownfield, riscos/testes de caracterização, specs técnicas e ADRs | OpenCode exclusivamente em modo **`plan`** (somente leitura) | Proibido de editar código; saída estruturada aguardando gate humano. |
| **Engenheiro Executor (Builder)** | Implementa slices em Git worktree isolado seguindo a spec aprovada | OpenCode modo **`build`** restrito ao worktree + testes/lint locais | Exige spec aprovada e checkout atômico válido; sujeito a kill switch e `StuckDetector`. |
| **Revisor & QA Independente** | Audita diff em sessão limpa, valida aderência à spec e monta Pacote de Evidências | OpenCode modo **`plan`** + resultados de CI/testes/segurança | Nunca compartilha histórico/CoT com o Builder ([Mastra Factory](https://mastra.ai/blog/announcing-mastra-factory-beta)). |
| **Curador de Memória** | Extrai ADRs, padrões e lições aprendidas pós-merge | Escrita em `.factory/knowledge/` e `@mastra/memory` ([semanticRecall](https://mastra.ai/docs/memory/semantic-recall)) | Assíncrono pós-merge fora do caminho crítico. |

## 5.3 Workflows Duráveis, Context Engineering e Skills Nativas

- **A. Máquina de Estados Durável:** `createWorkflow()`, `createStep()`, `suspend()`/`resume()`, `requireApproval`, snapshots duráveis (`workflow_snapshots`), `restartAllActiveWorkflowRuns()`, idempotência por `(runId + workflowId + stepId)` e checkout atômico SQL (`409 Conflict`).
- **B. Context Engineering ([Guia Oficial Mastra](https://mastra.ai/docs/guides/context-engineering)):** `toModelOutput`, `ToolCallFilter`, `TokenLimiter`, `observationalMemory` e `semanticRecall` (`@mastra/fastembed` ou provedor).
- **C. 8 Skills Nativas (`SKILL.md`):**
  1. `brownfield-archaeology`: leitura somente-leitura para Raio-X de arquitetura, riscos e cobertura.
  2. `characterization-testing`: rede de segurança (testes de caracterização) antes de refatorar legado.
  3. `spec-authoring-sdd`: conversão de PRD/demandas em spec técnica verificável.
  4. `slice-implementation-tdd`: implementação incremental em worktree isolado.
  5. `independent-code-review`: revisão adversarial em sessão limpa.
  6. `executive-translation`: tradução técnica → valor de negócio sem jargão/custos.
  7. `safe-db-migrations`: padrão Expand → Migrate → Contract bloqueando `DROP`/`TRUNCATE` destrutivo direto.
  8. `test-quality-engineering`: isolamento Spec → Teste, proibição de over-mocking interno, testes parametrizados (`test.each` / *Tests as Data*), casos de fronteira/segurança OWASP e poda de redundâncias.

## 5.4 Modelagem de dados, migração Zero-Config → PostgreSQL e contratos de API

- **Dual-Mode:** `LibSQLStore` + `PGlite` (sem `DATABASE_URL`) → `PostgresStore` + `node-postgres` (com `DATABASE_URL`) + CLI `factory db migrate-to-postgres`.
- **Tabelas do Painel (`packages/db`):** `organizations`, `users`, `project_members`, `clients` (seed `"Internos"`), `provider_profiles` (AES-256-GCM), `projects` (incl. `development_strategy`), `project_repositories`, `diagnostics`, `specs`, `milestones`, `slices`, `tasks`, `workflow_runs`, `evidence_bundles`, `approvals`, `executive_messages`, `skill_registry`, `cost_ledger`, `design_assets`, `codebase_indexes`, `security_scans`, `security_findings`.
- **Contratos de API:** segregação `/api/tech/*` vs. `/api/exec/*`, streaming retomável AI SDK UI e ciclo HITL via `POST /api/approvals/:id/decide`.

## 5.5 Isolamento de execução (Git Worktrees locais → Containers e Sandboxes)

- **Fase 1:** Git Worktrees locais + OpenCode local (`plan` e `build`), com mitigação por execução supervisionada e bloqueio de comandos destrutivos ([OpenCode Review](https://kingy.ai/blog/opencode-review/)).
- **Fases 2 e 3:** interface `ExecutionWorkspace` trocando worktree local por containers Docker ou sandboxes efêmeros via [Daytona](https://www.daytona.io/).

## 5.6 Estratégia de chaves, provedores (OmniRoute e alternativos) e Segurança/RBAC

- **Perfis de Provedor:** Gateway OpenAI-Compatible ([OmniRoute](https://github.com/cheaper-inference/OmniRoute), [LiteLLM](https://www.litellm.ai/), Ollama), chaves diretas, roteamento por papel + `ProviderHistoryCompat` ([Mastra Processors](https://mastra.ai/docs/agents/processors)).
- **Cofre:** `.env` bootstrap + criptografia AES-256-GCM com `MASTER_ENCRYPTION_KEY`, injeção efêmera em memória na sessão do OpenCode.
- **RBAC:** Better Auth + isolamento estrito `/api/exec/*` + auditoria imutável.

## 5.7 Empacotamento, distribuição e estratégia de release (PC pessoal e VPS)

| Canal de Release | Público e Ambiente | Como instala e atualiza | Arquitetura padrão embarcada |
| :--- | :--- | :--- | :--- |
| **CLI via npm (`npx <sua-fabrica>`)** | PC pessoal (solo/dev) | 1 comando no terminal (Node 22+ e Git) | Zero-config: Painel + Mastra + LibSQLStore + PGlite + OpenCode em Git worktrees. |
| **Docker oficial (GHCR) + `docker-compose.yml`** | VPS e produção | `docker compose up -d` (ou Coolify/Dokploy/Portainer) | Imagem única com Node 22+, Git, OpenCode e scanners + PostgreSQL/pgvector via `DATABASE_URL`. |

## 5.8 Estratégia de Codebase Intelligence & Economia de Tokens

No SWE-PRBench ([Loupe](https://loupe.ac/blog/ai-code-review-tools)), revisões diff-only detectaram apenas 15%–31% dos bugs reais. Adotamos 4 camadas progressivas:
1. **Esqueleto Estrutural:** `repomix --compress` ([Repomix](https://github.com/yamadashy/repomix)).
2. **Grafo AST Persistente via MCP:** [Codebase-Memory](https://arxiv.org/abs/2603.27277) / [code-review-graph](https://github.com/tirth8205/code-review-graph) (10× menos tokens, 2,1× menos tool calls, <1 ms).
3. **Navegação Semântica LSP / [Serena MCP](https://github.com/oraios/serena):** opt-in por repositório grande ([OpenCode LSP](https://opencode.ai/docs/de/lsp/)).
4. **Busca Híbrida + Steering + Compaction do Mastra:** `ripgrep` + `semanticRecall` + `.factory/steering.md` + filtros do Mastra.

## 5.9 Engenharia de Confiabilidade, Fronteira Build vs. Reuse e Anti-Patterns

- **Evidências:** falhas em loop consomem até 4× mais recursos ([arXiv 2604.03515](https://arxiv.org/pdf/2604.03515)); ferramentas, middleware e memória carregam o ganho real (71,9% SWE-Bench Verified, [arXiv 2609.00006](https://arxiv.org/html/2609.00006v1)).
- **StuckDetector (5 Padrões do [OpenHands](https://docs.openhands.dev/sdk/guides/agent-stuck-detector)):** (1) 4+ ação-observação repetidas; (2) 3+ ação-erro consecutivas; (3) 3+ turnos monólogo; (4) 6+ ping-pong alternando 2 ações; (5) erros recorrentes de janela de contexto.
- **Princípio "Verify, Don't Trust" ([fak](https://github.com/anthony-chaudhary/fak/blob/main/INDEX.md)):** re-verificação determinística fora do LLM.
- **Anti-Patterns (proibido construir do zero):** engine própria de edição de código, RAG textual ingênuo sobre código-fonte, proxy próprio de LLM, autenticação enterprise do zero.

## 5.10 Padrões de Fábricas em Produção e Mitigação de Pontos Cegos

- **Importados da indústria (2026):** Holdout Scenarios fora do worktree ([StrongDM](https://github.com/Chipagosfinest/software-factory/blob/main/docs/practitioners/strongdm-software-factory.md); [SpecBench](https://lmmartinb.com/en/what-is-an-ai-software-factory/)), Blueprints determinísticos + Toolshed curado ([Stripe Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)), Digital Twin Lite (MSW/WireMock), Notificações HITL acionáveis ([OpenAI Symphony](https://www.infoq.com/news/2026/05/openai-symphony-agents/); [Composio](https://ai.miraheze.org/wiki/Composio_Agent_Orchestrator)).
- **4 Pontos Cegos Resolvidos:** Controle Pós-Deploy e Rollout Seguro ([LaunchDarkly / New Relic 2026](https://launchdarkly.com/guides/the-ai-software-factory-doesnt-end-at-deploy/)), Mapa Mental contra Dívida Cognitiva (Thoughtworks Vol. 34), FinOps Real + Taxa de Retrabalho (Gartner) e Rastreabilidade de Intenção Negócio ↔ Código ([arXiv 2609.36323](https://arxiv.org/html/2609.36323v1)).

## 5.11 Guardrails Avançados de Produção

1. **Paralelismo Seguro:** File Ownership (`allowed_paths`), sequenciamento automático em conflitos e limite de WIP ([Verdent AI](https://www.verdent.ai/guides/tutorial/how-to-use-1code-claude-code); [Atoll](https://atollhq.com/guides/run-multiple-claude-code-agents-in-parallel)).
2. **Defesa contra Slopsquatting e Indirect Prompt Injection:** gate de novas dependências ([OX Security](https://www.ox.security/academy/code-security/slopsquatting-when-ai-hallucinates-package-names-and-attackers-move-in/): 5,2% comercial / 21,7% open-source) e quarentena de inputs externos ([Sysdig](https://www.sysdig.com/learn-cloud-native/prompt-injection); [arXiv 2601.17548](https://arxiv.org/html/2601.17548v1)).
3. **Governança de Migrações (Expand–Migrate–Contract):** zero credencial de produção em workers, `safe-db-migrations` e detector determinístico de DDL destrutivo ([Factory AI](https://factory.com/articles/coding-agent-database-migrations); [Liquibase](https://www.liquibase.com/blog/what-2026-taught-us-about-ai-cybersecurity-and-database-change-governance)).
4. **Combate a Context Rot e Spec Drift:** Spec de Produto vs. Constituição (`.factory/steering.md`), ciclo *Plan → Execute → Reset* ([Harness.io](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions)) e documentação hierárquica ([Mintlify](https://www.mintlify.com/library/best-context-engineering-tools-for-coding-agents): -52,1% tempo, -44,8% tokens).

## 5.12 Padrões Táticos de Orquestração, Roteador de Estratégia e Calibração de Juízes

- **5 Padrões Táticos:** 1 Agente Único, Builder vs. Verifier (sem CoT do Builder), Split into Lanes (File Ownership), Best of N, Blind-Vote Council of Models e Team of Reviewers Ortogonais (teto rígido de 3 rodadas).
- **Guardrails em 4 Pontos:** Entrada, Chamada de Ferramenta, Retorno de Ferramenta e Saída.
- **Política Definitiva de Roteamento e Prompt Cache:** roteamento fixo por papel no OmniRoute; **nunca trocar de modelo no meio da mesma sessão** ([Towards Data Science](https://towardsdatascience.com/the-hidden-cost-of-llm-routing-why-switching-models-costs-more/); [Compresr](https://compresr.ai/blog/reduce-ai-costs-without-losing-quality-strategy-guide)). Modelos classificadores dedicados (como Jev) ficam **fora do escopo**.
- **Calibração Golden Dataset:** promoção para *Autônomo Controlado* exige 85%–90% de concordância juiz IA vs. humanos.

## 5.13 Maturação de Plataforma: Scorecards, Verificação Local, Hooks e Portabilidade

- **Scorecard de Maturidade (0–100):** inspirado em [Cortex](https://www.cortex.io/), [Port](https://www.port.io/blog/how-internal-developer-portals-help-you-to-pave-and-remain-on-the-golden-path) e [Backstage](https://docsio.co/blog/backstage-developer-portal).
- **Verificação Local Reproduzível (`.factory/verify` + futuro [Dagger](https://dagger.io/)).**
- **Lifecycle Hooks Determinísticos + Subagentes como Isoladores de Contexto** ([Claude Code Hooks](https://code.claude.com/docs/en/hooks); [Best Practices](https://code.claude.com/docs/en/best-practices)).
- **Portabilidade Aberta (`AGENTS.md` + `SKILL.md`):** ([wshobson/agents](https://github.com/wshobson/agents)).

## 5.14 Seletor de Estratégia de Desenvolvimento, Vertical Slice e Contratos Executáveis

### 5.14.1 Matriz das 6 Estratégias de Desenvolvimento

| Estratégia | Quando Usar (Perfil do Sistema) | Artefato-Âncora Inicial | Mecanismo de Qualidade e Troca Segura | Principal Risco Evitado |
| :--- | :--- | :--- | :--- | :--- |
| **1. Frontend-First com Contract-First + MSW** | SaaS, painéis, e-commerce, apps orientados a UX e software house com aprovação visual rápida. | Contrato executável (OpenAPI 3.1 / Zod / TS) + `DESIGN.md`. | [Mock Service Worker (MSW)](https://solospace.net/products/mock-service-worker) na borda de rede alimentado pelo contrato ([Guide to MSW](https://msmechatronics.medium.com/stop-waiting-for-apis-a-developers-guide-to-mock-service-worker-a05d7a58ff39); [Frontend Quality Pipeline](https://alexop.dev/posts/modern-frontend-quality-pipeline/)). | Retrabalho de UI e mocks hardcoded divergentes da API real. |
| **2. API / Contract-First** | APIs públicas/B2B, microsserviços, BFFs, webhooks e integrações. | OpenAPI 3.1, AsyncAPI ou Protobuf versionado. | Validadores, tipos, SDKs e testes de contrato antes dos handlers. | Breaking changes e ambiguidade de payloads. |
| **3. Domain-First (Core de Regras + TDD)** | Fintechs, billing, precificação, cálculos fiscais, ERPs e workflows críticos. | Modelo de domínio puro + tabelas declarativas de casos. | TDD puro sem banco/UI + [Tests as Data](https://martinfowler.com/articles/tests-as-data.html). | Regras corrompidas e bugs silenciosos em cálculos críticos. |
| **4. Data / Schema-First** | ETL/ELT, analytics, RAG/busca e modelagem relacional complexa. | Schema, `safe-db-migrations` e contratos de dados. | Índices, constraints, migrações reversíveis e seeds antes de APIs/dashboards. | Gargalos estruturais e migrações destrutivas. |
| **5. Characterization-First + Strangler Fig** | Sistemas legados sem testes e modernizações graduais. | Suíte Golden Master / testes de caracterização. | Congela comportamento atual e substitui via Strangler Fig + feature flags. | Regressões silenciosas e reescritas big-bang. |
| **6. Spike-First (PoC Timeboxed)** | Integrações obscuras, IoT, algoritmos de IA/ML, metas de performance. | Branch descartável com limite rígido de tempo/tokens. | Apenas aprendizados e benchmarks entram na Spec definitiva. | Arquitetar sobre premissas técnicas inviáveis. |

### 5.14.2 Padrões Transversais
1. **Walking Skeleton + Vertical Slice Architecture** ([InfoQ](https://www.infoq.com/articles/skeleton-architecture/); [Managed Code](https://managed-code.com/blog-post/vertical-slice-architecture-for-ai-generated-code)).
2. **Higiene de Mocks e Contract Drift Check.**
3. **Tests as Data** ([Martin Fowler](https://martinfowler.com/articles/tests-as-data.html)).

## 5.15 Engenharia de Qualidade de Testes (Anti-Bloat, Mutation Testing e PBT)

Testes de IA frequentemente criam "teatro de cobertura" ([arXiv 2609.24341](https://arxiv.org/html/2609.24341); [techdebt.now](https://techdebt.now/ai-testing-gaps/); [DeviQA 2026](https://www.deviqa.com/blog/how-ai-changes-qa-expectations-in-2025/)). Aplicamos 6 mecanismos combinados:

| Mecanismo | Problema Resolvido | Implementação no Sistema | Fase Alvo |
| :--- | :--- | :--- | :--- |
| **1. Isolamento Spec → Teste (Antes do Build)** | Elimina testes tautológicos ([Enforcing TDD](https://medium.com/@shub-sharma/enforcing-tdd-in-agentic-ai-clis-and-ides-f7a3abc24cd8)). | Agente lê apenas Spec/contrato antes do Build. | Fase 1 |
| **2. Auditor Estático de Test Anti-Patterns** | Bloqueia testes vazios, `toBeTruthy()`, `sleep`, duplicações ([.NET Foundation](https://agenticskills.io/skills/dotnet-test)). | Gate determinístico no `.factory/verify`. | Fase 1 |
| **3. Troféu de Testes + Dependências Reais** | Acaba com over-mocking ([techdebt.now](https://techdebt.now/ai-testing-gaps/)). | Integração contra PGlite/Postgres + MSW na borda + casos de fronteira/segurança. | Fase 1 |
| **4. Mutation Testing Incremental no Diff** | Substitui line coverage por Mutation Score ([Augment Code](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code)). | Stryker (TS) / mutmut (Python) apenas no diff ou módulos críticos. | Fase 2 |
| **5. Mutação Semântica (Estilo Meta ACH)** | Captura falhas de negócio e permissão ([arXiv 2501.12862](https://arxiv.org/html/2501.12862v1); [Meta Engineering](https://engineering.fb.com/2025/02/05/security/revolutionizing-software-testing-llm-powered-bug-catchers-meta-ach/)). | Agente adversário injeta 3–5 falhas realistas e descarta testes que não as matam. | Fase 2 (risco alto) |
| **6. Property-Based Testing (PBT) + Fuzzing** | Descobre casos de borda ocultos ([Anthropic PBT 2026](https://www.anthropic.com/research/property-based-testing); [fast-check](https://fast-check.dev/docs/introduction/what-is-property-based-testing/); [Schemathesis](https://qaskills.sh/blog/schemathesis-property-based-api-testing-guide-2026)). | Invariantes em `fast-check`, `Hypothesis` ou `Schemathesis` com triagem por rubrica. | Fase 2 (Domain/API) |

- **Regra de Poda de Testes (Anti-Bloat):** (1) 3+ testes idênticos viram `test.each` / *Tests as Data*; (2) todo novo teste precisa provar utilidade (criterio da Spec, bug reproduzido ou mutante morto).
- **Fluxo Operacional Consolidado (v2.9):** (1) Descoberta & Contexto → (2) Spec & Roteamento Duplo → (3) Estúdio Visual (2.5, condicional UI) → (4) Contrato & Testes da Spec (antes do Build) → (5) Execução Isolada (OpenCode `build` + Worktree) → (6) Qualidade & Poda de Testes (`.factory/verify`) → (7) Caixa de Decisões Humana (HITL) → (8) Entrega, Pós-Deploy e Aprendizado.

## 5.16 Módulo Autônomo de Segurança (`AppSec Engine`) e Ecossistema Open-Source

45% dos trechos gerados por LLMs falham em OWASP Top 10 ([DeviQA 2026](https://www.deviqa.com/blog/how-ai-changes-qa-expectations-in-2025/)) e apenas 24,8% dos patches de segurança gerados por IA são totalmente corretos ([Kodem Security](https://www.kodemsecurity.com/resources/top-5-ai-sast-tools)). Por isso, construímos `packages/security-engine` em modo dual (embutido nas Etapas 1, 6 e 8 + standalone via CLI `factory sec scan`, API, MCP e aba no Painel) com saída padronizada **SARIF**, trava de *allowlist* para DAST, triagem contextual em 3 vereditos (`confirmed`, `false_positive`, `unknown` — [Endor Labs](https://www.endorlabs.com/learn/ai-code-review-vs-sast)) e teste PoV (*Proof-of-Vulnerability*).

| Categoria | Projeto / Ferramenta Open-Source | Papel e Diferencial Técnico | Fase Alvo |
| :--- | :--- | :--- | :--- |
| **SAST (Engine)** | [Opengrep](https://github.com/opengrep/opengrep) | SAST 100% open-source compatível com YAML do Semgrep, taint cross-file, OCaml 5 multicore, saída SARIF. | Fase 1 |
| **SAST (Regras)** | [Semgrep](https://github.com/semgrep/semgrep) | Registro comunitário de regras YAML (LGPL-2.1). | Fase 1 |
| **Segredos (Rápida)** | [Gitleaks](https://github.com/gitleaks/gitleaks) | Detecção rápida de chaves/tokens em diffs e commits. | Fase 1 |
| **Segredos (Verificada)** | [TruffleHog](https://github.com/trufflesecurity/trufflehog) | Histórico Git + verificação ativa se credenciais vazadas ainda funcionam. | Fase 2 |
| **SCA / Docker / IaC** | [Trivy](https://github.com/aquasecurity/trivy) | Binário único para CVEs, imagens Docker e IaC. | Fase 1 |
| **Supply Chain** | [OSV-Scanner](https://github.com/google/osv-scanner) | Scanner Go sobre [OSV.dev](https://osv.dev/) com lockfiles/SBOM, licenças e `osv-scanner fix`. | Fase 1 |
| **IaC & CI/CD** | [Checkov](https://github.com/bridgecrewio/checkov) | Terraform, Kubernetes, Dockerfiles e GitHub Actions. | Fase 2 |
| **DAST Rápido** | [Nuclei](https://github.com/projectdiscovery/nuclei) + [nuclei-templates](https://github.com/projectdiscovery/nuclei-templates) | Templates YAML ultrarrápidos para staging/CI. | Fase 2 |
| **DAST Completo** | [OWASP ZAP](https://github.com/zaproxy/zaproxy) | Varredura passiva/ativa de web e APIs em staging. | Fase 2 |
| **Segurança de IA/LLM** | [Promptfoo](https://github.com/promptfoo/promptfoo) (MIT) e [NVIDIA Garak](https://github.com/NVIDIA/garak) (Apache 2.0) | Red-teaming, prompt injection e jailbreaks para apps com IA e autodefesa da fábrica. | Fase 2 |
| **Gestão Centralizada** | [DefectDojo](https://github.com/DefectDojo/django-DefectDojo) | Hub opcional multi-cliente para ingestão SARIF e compliance. | Fase 3 |

---

# 6. Roadmap de Implementação por Fases

- **Fase 1 (MVP Utilizável Zero-Config + 1-Line Postgres):** detalhada integralmente em `docs/especificacao-tecnica-fase-1-v1.1.md` (7 Vertical Slices: Slice 0 → Slice 6).
- **Fase 2 (VPS, Qualidade Profunda e Segurança Avançada):** Sandboxes Docker/Daytona, Mutation Testing incremental, PBT, Meta ACH, Holdout Scenarios, DAST (Nuclei + ZAP), TruffleHog, Checkov, Promptfoo/Garak, Mapa AST (`codebase-memory`), Penpot/Figma MCP e observabilidade avançada.
- **Fase 3 (Escala & Software House Multi-Cliente):** Portal externo `/exec`, SSO/RBAC corporativo, Council of Models, DefectDojo e biblioteca de templates.
