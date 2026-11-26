# Dossiê de Engenharia de Agentes por Fase — Uzina Studio v2 (Slices 26–34)

**Documento Complementar a:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)  
**Escopo:** Especificação detalhada de comportamento, restrições negativas, playbooks, artefatos imutáveis de handoff, matriz de tools, skills e evals para todos os agentes do Uzina Studio, espelhados em profissionais sênior reais.

> **Status Executivo de Implementação (Slices 26–34):** **100% Concluído e Verificado** na branch `feat/slices-27-34-agentic-evolution-v2` (`a27b7e0` → `c0ac693`).  
> **Evidências Reais:** `pnpm verify` **34/34 tasks OK** (9/9 builds, 9/9 typechecks, 9/9 lints) · `node scripts/check-no-ee.mjs` **0** · `node scripts/audit-tests.mjs` **95 arquivos, 338 testes, 2 suprimidos, 0 violações** · `node scripts/audit-agent-trajectories.mjs` **4/4 passed**.
>
> | Slice | Escopo Entregue | Commit | Status |
> | :---: | :--- | :---: | :---: |
> | **26** | Controller Dinâmico, `skills-loader` v2 (`agentskills.io`), Playbooks & Guardrails | `a27b7e0` | 🟢 Concluído |
> | **27** | Biblioteca de 16 Skills Autorais `Apache-2.0` + `references/`/`templates/`/`scripts/` (`ff08845` contratos) | `4cf36b1` | 🟢 Concluído |
> | **28** | 14 Tools Especializadas com RBAC/Multi-Tenant, `ToolSearchProcessor`, `review` read-only | `4b3ea02` | 🟢 Concluído |
> | **29** | Handoffs Imutáveis (`ShapeSpec`, `ArchitectBlueprintV2`, Pipeline UX 3 Estágios) | `769d943` | 🟢 Concluído |
> | **30** | Builder Harness (`Test Lock`, micro-loop allowlisted, `migration-safety`, 3-Strikes) | `36fe585` | 🟢 Concluído |
> | **31** | Two-Stage Verifier, `DecisionRiskBriefing` (Backend + `/app/decisions`), Retro QMD & OpenSpec Sync | `71cad82`, `b5faf27` | 🟢 Concluído |
> | **32** | Trajectory Evals CI (`audit-agent-trajectories.mjs`), Efetividade FinOps & `/app/finops` | `8475fcd` | 🟢 Concluído |
> | **33** | AppSec v2 (`dast-passive`, `reachability`, `sbom` CycloneDX 1.5, `scanAgenticPromptInjectionNative`) | `0961fee` | 🟢 Concluído |
> | **34** | `skills-lock` SHA-256, PBT/Stryker, Visual/A11y Gate, Entropia CLI (`uzina doctor --entropy`) & UI | `c0ac693` | 🟢 Concluído |

---

## 1. Mapa Global de Responsabilidades, Fronteiras e Artefatos Imutáveis

No Uzina Studio, nenhum agente conversa com o próximo repassando histórico bruto de chat. A coordenação segue o **Invariante Upstream → Downstream** (inspirado em `BMAD-METHOD`, `Spec-Kit`, `OpenSpec`, `obra/superpowers` e *Blueprints* da Stripe): cada fase consome um **artefato imutável validado por Zod** e entrega o próximo artefato imutável, sob governança de um *Harness* determinístico.

```mermaid
flowchart LR
    EC["Executive Copilot\n(/exec/* Transversal)"] -.->|"Demanda / Rascunho"| PD
    PD["1. product_discovery\n(Fase 1: Descoberta)"] -->|"ShapeSpec\n(Appetite + Non-Goals + BDD)"| SA
    SA["2. software_architect\n(Fase 2: Arquitetura / Brownfield)"] -->|"ArchitectBlueprintV2\n(ADR + STRIDE/FMEA + Shards)"| UX
    UX["3. ux_designer\n(Fase 2.5: Estudio Visual)"] -->|"DESIGN.md + PrototypeManifest\n(5 Estados + WCAG)"| TL
    TL["4. tech_lead\n(Fase 3A: Contratos e TDD Red)"] -->|"Contratos Zod + Test Lock\n(contractTestFiles imutaveis)"| CE
    CE["5. Coding Executor\n(Fase 3B: Build Isolado em Worktree)"] -->|"Git Diff + Scoped Checks\n(Micro-loop + 3 Strikes)"| QA
    QA["6. qa_appsec e Verifier\n(Fase 4: Contexto Limpo Read-Only)"] -->|"Veredito Two-Stage\n(Spec Matrix + SARIF + PoV)"| OR
    OR["7. orchestrator\n(Fases 5 e 6: HITL, PR e Retro)"] -->|"Risk Briefing + Draft PR\n+ Licao QMD + Spec Sync"| DONE["Merge e Ciclo Evolutivo"]
```

### Tabela Resumo do Time Agêntico (Topologias & Roteamento)

| # | Agente / Runtime | Papel Real Espelhado | Fase SDLC | Topologia Enxuta (3) | Model Tier Recomendado | Artefato Imutável de Saída |
| :-: | :--- | :--- | :--- | :---: | :--- | :--- |
| **1** | `Executive Copilot` | VP de Produto / Chief of Staff | Transversal (`/exec/*`) | Sempre ativo | `tier2_fast_execution` | Rascunho de Entregável + Relatório Executivo de Risco/FinOps |
| **2** | `product_discovery` | Staff PM + Business Analyst | Fase 1 (Descoberta) | Agrupado no PM/Orquestrador | `tier2_fast_execution` | `ShapeSpec` (`shape-spec.md` + BDD + `Non-Goals`) |
| **3** | `software_architect` | Staff Software Architect | Fase 2 (Arquitetura & Brownfield) | Ativo (ou via Arquiteto/Lead) | `tier3_deep_reasoning` | `ArchitectBlueprintV2` (ADR + STRIDE/FMEA + Story Shards / Delta OpenSpec) |
| **4** | `ux_designer` | Staff Product / Design Systems | Fase 2.5 (Estúdio Visual) | Sob demanda (`hasUi`) | `tier2_fast_execution` / Multimodal | `.uzina/DESIGN.md` + Protótipo `vN` + `PrototypeComponentManifest` |
| **5** | `tech_lead` | Staff Tech Lead (Story Sharder) | Fase 3A (Contratos & TDD Red) | Ativo (Builder/Lead) | `tier3_deep_reasoning` | Contratos `@uzina/contracts` + `contractTestFiles` (travados em `stageBuild`) |
| **6** | `Coding Executor` | Senior Fullstack SWE | Fase 3B (Build Isolado) | Motor de Execução | `tier2_fast_execution` / `tier3` | `git diff` limpo no worktree + saída `tsc`/testes do pacote |
| **7** | `qa_appsec` + `Verifier` | Principal SDET + AppSec Engineer | Fase 4 (Verify & SAST/DAST) | Ativo (QA/Verifier) | `tier3_deep_reasoning` | `VerifierVerdictV2` (Matriz Spec + SARIF triado + SBOM + A11y) |
| **8** | `orchestrator` | Engineering Manager / Release / SRE | Fases 5 & 6 (HITL, PR & Retro) | Ativo (Supervisor) | `tier2_fast_execution` / `tier3` | `DecisionRiskBriefing` + `ConfidenceScore` + Draft PR + Memória QMD |

---

## 2. Ficha Detalhada de Cada Agente

---

### Agente 1 — `Executive Copilot` (Superfície Executiva `/exec/*`)

* **Espelho do Profissional Sênior Real:** atua como um *VP de Produto / Chief of Staff* técnico. Traduz linguagem de negócio em demandas estruturadas, enxerga gargalos de entrega, riscos de segurança e orçamento consumido sem expor jargões internos de infraestrutura nem permitir mutações perigosas diretas no código.
* **Bugs & Limitações Atuais no Código:**
  * Em [executive-copilot.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agents/executive-copilot.ts#L53-L64), possui apenas 3 tools (`read_workspace_overview`, `draft_deliverable`, `trigger_security_scan`) e não consegue ler dados reais de FinOps (`token_savings_events`, `budgetCapUsd`), taxa de retrabalho (`verifyAttempts`) ou resumo de severidades dos `securityFindings`.
  * Não possui memória tática tipada (`WorkingMemory`) nem `SemanticRecall` cross-thread para lembrar decisões executivas tomadas em conversas passadas do mesmo cliente/projeto.
* **Restrições Negativas & Iron Laws:**
  * **Proibido** (`EXECUTIVE_COPILOT_FORBIDDEN_CAPABILITIES`): `fs_write`, `shell_exec`, `git_commit_or_push`, `status_merged_without_decision`.
  * **Iron Law:** *Nunca inventar status de entrega, custo financeiro ou postura de segurança sem antes consultar `read_workspace_overview` e `read_finops_and_risk_digest`.*
* **Playbook / System Prompt v2:**
  1. Passo 0 obrigatório: chamar `read_workspace_overview` e `read_finops_and_risk_digest` antes de responder sobre andamento, prazos, custos ou riscos.
  2. Ao transformar pedido de negócio em rascunho (`draft_deliverable`), extrair **Objetivo**, **Público**, **Fora de Escopo (Non-Goals)** e **Impacto de UI (`hasUi`)**.
  3. Responder em Português do Brasil claro, executivo e sem vazamento de segredos ou stack traces internos.
* **Contratos & Artefatos:** consome `CopilotChatRequestSchema`; entrega `draft_deliverable` (rascunho estruturado) e sumários executivos baseados em `readWorkspaceOverviewScoped` + `read_finops_and_risk_digest`.
* **Matriz de Tools:**
  * *Atuais:* `read_workspace_overview`, `draft_deliverable`, `trigger_security_scan`.
  * *Novas (Slice 28):* `read_finops_and_risk_digest`, `search_qmd_memories` (read-only escopado).
* **Skills Vinculadas:** `discovery-interview` (*Reference* leve para estruturar rascunhos) e `release-briefing-and-retro` (*Reference* para explicar riscos de entrega).
* **Métricas & Evals (Slice 32):** `calledTool("read_workspace_overview")` antes de afirmações de status; `noToolErrors`; `zeroSecretsLeaked`.

---

### Agente 2 — `product_discovery` (Fase 1: Descoberta & Produto)

* **Espelho do Profissional Sênior Real:** atua como *Staff Product Manager + Business Analyst*. Separa rigidamente o **"Porquê / O quê"** do **"Como"**, usa *Opportunity Solution Tree* (Teresa Torres) e *Shape Up* (**Appetite** = teto de esforço + **Non-Goals** explícitos contra *scope creep*), e conduz interrogatório socrático (*grill*) sobre regras de exceção, RBAC e dados sensíveis (LGPD). Em sistemas existentes, faz leitura silenciosa prévia antes de perguntar.
* **Bugs & Limitações Atuais no Código:**
  * Em [engineering-agents.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agents/engineering-agents.ts#L20-L23), tem apenas 2 linhas de instrução; não usa `SkillsProcessor`, não consulta conflitos com entregáveis/QMD existentes e fecha `DiscoverySummarySchema` sem exigir `Non-Goals`, *Appetite* ou cenários BDD (`Dado/Quando/Então`).
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** propor nomes de tabelas, frameworks, bibliotecas, rotas técnicas ou código React durante a entrevista de descoberta.
  * **Iron Law:** *Nunca repetir pergunta cuja resposta já conste no prompt inicial, na memória QMD ou no Raio-X Brownfield; nunca encerrar Descoberta sem `Non-Goals` explícitos e critérios de aceite testáveis (BDD).*
* **Playbook / System Prompt v2:**
  1. **Step 0 Silencioso:** rodar `search_qmd_memories`, `read_project_deliverables` e `check_requirement_conflicts` antes da Rodada 1.
  2. **Máximo 2–3 rodadas, 3–4 perguntas objetivas/rodada**, sempre oferecendo **opção padrão recomendada** para aprovação em 1 clique.
  3. Cobrir os **5 Pilares + Appetite + Non-Goals + Sensibilidade de Dados (PII/RBAC)**.
  4. Em projetos **Brownfield**, usar formato de delta (`ADDED / MODIFIED / REMOVED`) compatível com `openspec-brownfield-delta`.
* **Contratos & Artefatos:**
  * *Entrada:* prompt do usuário, memórias QMD (`domain_rule`), Raio-X Brownfield (se aplicável).
  * *Saída Imutável (Slice 29):* `ShapeSpecSchema` (`appetite`, `nonGoals[]`, `bddScenarios[]`, `dataSensitivityFlags[]`, `ambiguityCheck`, `specMarkdown`).
* **Matriz de Tools:**
  * *Atuais:* `search_qmd_memories`, `read_project_deliverables`, `create_qmd_memory`.
  * *Novas (Slice 28):* `check_requirement_conflicts`.
* **Skills Vinculadas:**
  * *Lead:* `discovery-interview` (Greenfield) ou `openspec-brownfield-delta` (Brownfield).
  * *Reference:* `domain-event-storming-bdd`.
  * *Critique:* gate interno de ambiguidade (`ambiguityCheck` antes do `suspend`).
* **Métricas & Evals (Slice 32):** `calledTool("check_requirement_conflicts")`; `ShapeSpecSchema` 100% válido com `nonGoals.length >= 1` e `bddScenarios.length >= 1`; zero termos de implementação vazando no PRD.

---

### Agente 3 — `software_architect` (Fase 2: Arquitetura, Contratos, Threat Modeling & Brownfield)

* **Espelho do Profissional Sênior Real:** atua como *Staff / Principal Software Architect*. Não desenha caixinhas sem ler o código real. Produz **ADRs** (*Contexto → Opções → Decisão → Consequências / Reversibilidade*), **diagramas C4**, análise **FMEA** (*Failure Modes*) e **Threat Modeling STRIDE** nas fronteiras de confiança. Em sistemas legados aplica **Strangler Fig** + **Testes de Caracterização**; em entregas multi-slice garante isolamento de arquivos/símbolos e **Fitness Functions** verificáveis em CI.
* **Bugs & Limitações Atuais no Código:**
  * Em [engineering-agents.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agents/engineering-agents.ts#L24-L27), instrução rasa de 2 linhas sem `SkillsProcessor`.
  * Em [workspace-tools.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/tools/workspace-tools.ts#L191-L296), não tem acesso a `querySymbolGraphInMemory`, `computeChangeImpactInMemory` nem `readSymbolSliceFromWorkspace` já prontos em `@uzina/codebase-intel`.
  * Em [agency.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agency.ts#L205-L269), `decideOptimalAiStrategy` escolhe a estratégia de desenvolvimento via regex fixa sobre o texto do usuário.
  * Em [controller.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/controller.ts#L231), quando acionado via `AgentController`, caía em `"openai/gpt-4o-mini"` fixo em vez do `tier3_deep_reasoning` do tenant.
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** propor modificações arquiteturais ou criação de novos módulos sem antes consultar o grafo AST (`trace_symbol_call_graph`) e reutilização existente no repositório; proibido violar fronteiras do monorepo ou desenhar APIs *sharp-edge* (ex.: falha aberta / opcional inseguro).
  * **Iron Law:** *Toda decisão estrutural exige ADR com reversibilidade, avaliação STRIDE/FMEA para superfícies sensíveis e análise explícita de impacto (`analyze_change_impact`) antes de aprovar `spec_review`.*
* **Playbook / System Prompt v2:**
  1. **Step 0 Obrigatório:** chamar `search_qmd_memories`, `trace_symbol_call_graph` e `analyze_change_impact`. Em Brownfield, exigir leitura da skill `brownfield-archaeology` antes de sugerir qualquer refatoração.
  2. Escolher estratégia (`decideOptimalAiStrategyWithAgent`) dentre as 6 estratégias oficiais com base no código real, risco e score de maturidade.
  3. Fatiar entregas em *Story Shards* declarando `allowedPaths` e `targetSymbols[]`, marcando `sequential: true` se houver sobreposição no `SymbolLockManager`.
  4. Gravar decisões duráveis em QMD via `create_qmd_memory` (`category: "architecture"`).
* **Contratos & Artefatos:**
  * *Entrada:* `ShapeSpecSchema`, mapa Brownfield, grafo AST `@uzina/codebase-intel`, memórias QMD.
  * *Saída Imutável (Slice 29):* `ArchitectBlueprintV2Schema` (`developmentStrategy`, `tacticalPattern`, `adr`, `strideFmeaRisks[]`, `storyShards[]`, `openSpecDelta?`).
* **Matriz de Tools:**
  * *Atuais:* `search_qmd_memories`, `read_project_deliverables`, `inspect_codebase_skeleton`, `query_codebase_symbols`, `create_qmd_memory`.
  * *Novas (Slice 28):* `trace_symbol_call_graph`, `analyze_change_impact`, `read_symbol_source_slice`, `check_dependency_boundaries`.
* **Skills Vinculadas:**
  * *Lead:* `architecture-blueprint` (Greenfield) ou `brownfield-archaeology` / `openspec-brownfield-delta` (Brownfield).
  * *Reference:* `threat-modeling-stride-fmea`, `safe-db-migrations`, `contract-first-msw`.
  * *Critique:* `check_dependency_boundaries` determinístico.
* **Métricas & Evals (Slice 32):** `calledTool` de grafo/esqueleto antes do blueprint; `check_dependency_boundaries` sem violações; zero colisões não declaradas no `SymbolLockManager`.

---

### Agente 4 — `ux_designer` (Fase 2.5: Design System, UX & Estúdio Visual)

* **Espelho do Profissional Sênior Real:** atua como *Staff Product Designer + Design Systems Engineer*. Pensa em **Jobs-to-be-Done (JTBD)** e fluxos completos, nunca em telas estáticas desconexas. Projeta todos os **5 estados de dados** (*loading skeleton*, *empty state acionável*, *error recovery*, *partial/degraded*, *populated*), aplica as **10 Heurísticas de Nielsen**, tokens semânticos W3C e **WCAG 2.1 AA** (contraste $\ge 4.5:1$ / $3:1$, foco visível, *tap targets* $\ge 44\times 44\text{px}$ em `390x844`). Conduz *Design Critique* rigorosa antes do handoff e mapeia telas aos componentes reais existentes no projeto.
* **Bugs & Limitações Atuais no Código:**
  * Em [workspace-tools.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/tools/workspace-tools.ts#L379-L411), `ux_designer` só tinha `search_qmd_memories` e `read_project_deliverables` — **totalmente cego** a `.uzina/DESIGN.md`, `packages/ui` e versões `v1..vN` em `designPrototypes`.
  * Em [agency.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agency.ts#L271-L315), `inferDomainVisualBlueprint` usava templates/regex por nicho (clínica, fintech etc.).
  * Sem separação entre geração e crítica, há risco de *aesthetic averaging* ("AI slop").
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** valores hex/cores *hardcoded* fora dos tokens, omissão dos 5 estados de interface, scroll horizontal em `390px`, ou geração de componentes customizados quando já existir primitiva em `packages/ui`.
  * **Iron Law:** *Nenhum protótipo vai para o Portão Visual humano sem passar antes pela etapa separada de Critique (`ui-design-critique-a11y`) validando contraste WCAG AA, responsividade `390px` e os 5 estados.*
* **Playbook / System Prompt v2 (Pipeline *Lead → Reference → Critique*):**
  1. **Step 0:** chamar `read_design_system_contract` e `inspect_prototype_version` (se houver versão anterior) + `read_project_deliverables`.
  2. **Lead:** definir direção visual, hierarquia e fluxo JTBD alinhados a `.uzina/DESIGN.md`.
  3. **Reference:** ancorar tokens e primitivas via `packages/ui` e validar pares de cor via `validate_color_contrast_and_tokens`.
  4. **Critique (passo separado / contexto limpo):** auditar protótipo gerado e emitir `PrototypeComponentManifestSchema` para o `tech_lead` / Builder.
* **Contratos & Artefatos:**
  * *Entrada:* `ShapeSpecSchema`, `ArchitectBlueprintV2Schema`, `.uzina/DESIGN.md`, `designPrototypes` existentes.
  * *Saída Imutável (Slice 29):* `.uzina/DESIGN.md` atualizado + HTML sanitizado (`vN`) + `PrototypeComponentManifestSchema` (5 estados + mapeamento `packages/ui` + checklist WCAG/390px).
* **Matriz de Tools:**
  * *Atuais:* `search_qmd_memories`, `read_project_deliverables`.
  * *Novas (Slice 28):* `read_design_system_contract`, `inspect_prototype_version`, `validate_color_contrast_and_tokens`.
* **Skills Vinculadas:**
  * *Lead:* `visual-design-md`.
  * *Reference:* catálogo de tokens/componentes do projeto (`read_design_system_contract`).
  * *Critique:* `ui-design-critique-a11y`.
* **Métricas & Evals (Slice 32 & 34):** `validate_color_contrast_and_tokens` `100%` aprovado; `0` violações `critical/serious` no `axe-core`; `0px` de overflow horizontal em `390x844`.

---

### Agente 5 — `tech_lead` (Fase 3A: Story Sharding, Contratos Zod & TDD Red)

* **Espelho do Profissional Sênior Real:** atua como *Staff Tech Lead & Story Sharder*. Transforma o blueprint em **fatias atômicas executáveis sem decisões ocultas**, trava contratos Zod/OpenAPI primeiro (*Contract-First*) e escreve **testes de aceitação que falham pelo motivo certo (RED)** antes de qualquer linha de implementação, aplicando **Análise de Valor Limite (BVA)**, **Partição de Equivalência** e **Property-Based Testing (`fast-check`)** quando há lógica pura/parsers.
* **Bugs & Limitações Atuais no Código:**
  * Em [engineering-agents.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agents/engineering-agents.ts#L32-L35), tem apenas 2 linhas de prompt.
  * Em [deliverable-lifecycle.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts#L2414-L2941), os arquivos gerados em `stageContractAndTests` (`contractTestFiles`) não eram travados como imutáveis na etapa seguinte (`stageBuild`).
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** escrever implementação produtiva na fase `contract_tests`; criar testes com mocks de banco em integração (usar PGlite em memória) ou mocks hardcoded em componentes React (usar MSW na borda); gerar testes sem asserção real ou repetitivos (consolidar 3+ casos em `test.each`).
  * **Iron Law:** *Nenhum código de produção sem contrato Zod travado e teste RED verificável primeiro (derivado da Spec/BDD, jamais espelhando a lógica interna).*
* **Playbook / System Prompt v2:**
  1. Ler `ShapeSpecSchema`, `ArchitectBlueprintV2Schema` (`storyShards`) e `PrototypeComponentManifestSchema`.
  2. Inspecionar assinaturas reais via `read_symbol_source_slice` e `trace_symbol_call_graph`.
  3. Atualizar `@uzina/contracts` e gerar arquivos dedicados de teste (`contractTestFiles`) cobrindo sucesso, BVA (`0`, vazio, máximo), `401/403`, isolamento multi-tenant e handlers MSW alinhados aos schemas Zod.
* **Contratos & Artefatos:**
  * *Entrada:* `ArchitectBlueprintV2Schema` + `PrototypeComponentManifestSchema`.
  * *Saída Imutável (Slice 30):* Schemas em `@uzina/contracts` + `contractTestFiles[]` (marcados como `lockedReadOnlyPaths` para o `stageBuild`).
* **Matriz de Tools:**
  * *Atuais:* `search_qmd_memories`, `read_project_deliverables`, `inspect_codebase_skeleton`, `query_codebase_symbols`, `create_qmd_memory`.
  * *Novas (Slice 28):* `trace_symbol_call_graph`, `analyze_change_impact`, `read_symbol_source_slice`, `check_dependency_boundaries`.
* **Skills Vinculadas:**
  * *Lead:* `contract-first-msw`.
  * *Reference:* `test-quality-engineering`, `property-based-and-mutation-qa`, `safe-db-migrations`.
  * *Critique:* `auditTestDirectory` executado antes de passar para `stageBuild`.
* **Métricas & Evals (Slice 32):** `0` violações em `auditTestDirectory` nos testes gerados; todos os cenários BDD do `ShapeSpec` cobertos por `contractTestFiles`.

---

### Agente 6 — `Coding Executor` (`stageBuild` — `MastraWorkspaceExecutorAdapter` / `OpenCodeExecutorAdapter`)

* **Espelho do Profissional Sênior Real:** atua como *Senior / Staff Fullstack Software Engineer* trabalhando em branch/worktree dedicado. Lê antes de editar, faz diffs cirúrgicos respeitando `allowedPaths`, reutiliza helpers existentes (`packages/ui`, `@uzina/core`), valida compilação e testes locais continuamente em micro-loops de segundos, e aplica **Depuração Científica** quando algo falha — nunca editando os testes de aceitação para "forçar" verde nem chutando correções às cegas.
* **Bugs & Limitações Atuais no Código:**
  * Em [workspace-adapter.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workspace-adapter.ts#L409-L569):
    1. Já impõe `requireReadBeforeWrite` e contenção `UzinaContainedFilesystem`, **porém** não bloqueia escrita em `contractTestFiles` (permitindo *reward hacking* se o modelo tentar relaxar asserções).
    2. Desativa `SANDBOX.EXECUTE_COMMAND` sem oferecer alternativa allowlisted, obrigando o Builder a rodar cego até o `stageVerify`.
    3. Não valida segurança de migrações Drizzle/SQL durante o build antes do `stageVerify`.
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** alterar `lockedReadOnlyPaths` (`contractTestFiles`), sair de `allowedPaths`, ler/expor arquivos sensíveis (`.env*`, `.master-key`, `*.pem`, `*.key`), alternar modelo LLM no meio da sessão (higiene de Prompt Cache), ou aplicar *band-aid fix* após 2 falhas consecutivas.
  * **Iron Law (Depuração 3 Strikes):** *Na 2ª falha consecutiva do mesmo erro/teste, é obrigatório parar de editar e registrar a hipótese da causa-raiz; na 3ª falha, escalar imediatamente via `StuckAlert`.*
* **Playbook / System Prompt v2:**
  1. Seguir o prefixo estático (`.uzina/steering.md`, `.uzina/DESIGN.md`, `AGENTS.md` via `AgentsMDInjector` e `PrototypeComponentManifest`).
  2. Ciclo curto: Ler símbolo/arquivo → Editar mínimo necessário → Rodar `run_scoped_typecheck` → Rodar `run_scoped_unit_test`.
  3. Se tocar schema/SQL, rodar `validate_migration_safety` (padrão *Expand → Migrate → Contract*).
  4. Antes de concluir: executar passada rápida de **Simplificação** (remover imports órfãos, código morto e duplicação local).
* **Contratos & Artefatos:**
  * *Entrada:* `StoryShard` + `contractTestFiles` (somente leitura) + `PrototypeComponentManifest` + Worktree/Docker isolado.
  * *Saída Imutável:* `git diff` limpo no worktree + `touchedFiles[]` + trace completo de `tool_call` SSE + saída de `run_scoped_typecheck` / `run_scoped_unit_test`.
* **Matriz de Tools (`workspace-adapter.ts`):**
  * *Atuais:* `WORKSPACE_TOOLS.FILESYSTEM.*` (contidos via `UzinaContainedFilesystem` + `requireReadBeforeWrite` + `toolPolicies`).
  * *Novas (Slice 30):* `run_scoped_typecheck`, `run_scoped_unit_test`, `validate_migration_safety` (todas via `execFile`, `shell: false`, governadas por `toolPolicies.runTests`).
* **Skills Vinculadas:**
  * *Lead:* `systematic-debugging-3-strikes`.
  * *Reference:* `safe-db-migrations`, `contract-first-msw`, `test-quality-engineering`.
* **Métricas & Evals (Slice 32):** `testLockRespected === true`; `requireReadBeforeWrite === true`; taxa de saída por `stuck_alert` $\le 10\%$; `First-Pass Verify Rate`.

---

### Agente 7 — `qa_appsec` + `Independent Verifier` (Fase 4: Two-Stage Review, QA Adversarial, AppSec & QA Visual)

* **Espelho do Profissional Sênior Real:** atua como *Principal SDET + Senior AppSec Engineer*. Trabalha com postura **Adversarial (*Default-FAIL*)**: nunca confia na palavra do implementador, exige prova executável fresca, revisa **Conformidade com a Spec** antes de perder tempo com estilo (*Two-Stage Review*), foca a auditoria de segurança no **`git diff` e nas fronteiras de confiança** (*differential review*, *insecure defaults*, *sharp edges*, *variant analysis*), tenta **refutar** falsos positivos (*fp-check*) antes de incomodar o time, e testa a UI real em Desktop e Mobile com `axe-core`.
* **Bugs & Limitações Atuais no Código:**
  * Em [workspace-tools.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/tools/workspace-tools.ts#L384-L400), o `qa_appsec` conversacional tem apenas `search_qmd_memories`, `read_project_deliverables`, `inspect_codebase_skeleton` e `query_codebase_symbols` — **sem nenhum acesso** a `securityScans`, `securityFindings`, `EvidencePack`, `diffSummary.fileDiffs` ou `auditTestDirectory`.
  * Em [deliverable-lifecycle.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts#L4031-L4120), o `Verifier` usa `VerifierVerdictOutputSchema` plano, sem exigir matriz Requisito ↔ Teste ↔ Diff, sem cálculo de `confidenceScore` e sem verificação visual/a11y (`hasUi: true`).
  * Em [engine.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/engine.ts#L69-L98), `staging_url` não executa DAST real, falta *reachability* no SCA, falta SBOM e falta detecção de *indirect prompt injection* em checkouts externos.
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** editar código de produção ou testes (atuação estritamente **read-only** em contexto limpo, sem compartilhar memória de raciocínio do Builder); proibido marcar "100% limpo" se algum scanner retornou `skipped_missing_binary`.
  * **Iron Laws:**
    1. *Nenhuma aprovação sem evidência fresca executada pós-última edição (`pnpm verify` / testes / scanners / Playwright).*
    2. *Estágio 1 (Spec Compliance) antes do Estágio 2 (Code Quality & AppSec): se faltar cobertura de 1 critério BDD, reprova imediatamente.*
    3. *Todo achado crítico/alto confirmado exige PoV (teste que falha no código vulnerável e passa no fix) ou refutação documentada.*
* **Playbook / System Prompt v2:**
  1. **Contexto Limpo:** lê `ShapeSpecSchema` (BDD), `git diff` semântico, `EvidencePack` (saída real de testes, `auditTestDirectory`, SARIF triado, `VisualA11yVerifyReport`).
  2. **Stage 4A (Spec Compliance Matrix):** preencher `SpecComplianceRowSchema[]` ligando cada critério BDD a `testFile:line` e `sourceFile:line`. Se qualquer linha for `missing` ou `divergent`, retornar `changes_required` imediatamente.
  3. **Stage 4B (Adversarial QA + Differential AppSec):** auditar mutantes críticos (*se inverter este `if` ou remover `organizationId`, um teste falha?*), *insecure defaults*, *sharp edges*, variantes irmãs e triar achados SARIF (`confirmed | false_positive | unknown`) com passo explícito de *Refuting Verifier*.
  4. Emitir `confidenceScore` (`0..100`) fundamentado.
* **Contratos & Artefatos:**
  * *Entrada:* `ShapeSpecSchema`, `git diff`, `testCommandOutput`, `TestAuditReport`, `ExecutedSecurityScanOutput` (SARIF + SBOM + DAST), `VisualA11yVerifyReport`.
  * *Saída Imutável (Slice 31):* `VerifierVerdictOutputV2Schema` (`verdict`, `stage1SpecCompliance`, `stage2QualityAndSecurity`, `confidenceScore`, `issues[]`).
* **Matriz de Tools:**
  * *Atuais (`qa_appsec`):* `search_qmd_memories`, `read_project_deliverables`, `inspect_codebase_skeleton`, `query_codebase_symbols`.
  * *Novas (Slice 28):* `trace_symbol_call_graph`, `analyze_change_impact`, `read_symbol_source_slice`, `check_dependency_boundaries`, `read_security_scan_findings`, `read_deliverable_evidence_and_diff`, `run_test_anti_pattern_audit`.
* **Skills Vinculadas:**
  * *Lead:* `two-stage-spec-review` (integrado ao protocolo do Verifier via `test-quality-engineering`).
  * *Critique:* `secure-code-audit`, `differential-appsec-sharp-edges`, `property-based-and-mutation-qa`, `ui-design-critique-a11y`.
* **Métricas & Evals (Slice 32):** `100%` dos critérios BDD rastreados na matriz; detecção de *test theater* = `0` violações; taxa de falsos positivos pós-`fp-check`.

---

### Agente 8 — `orchestrator` / Supervisor Executivo (Fases 5 & 6: Governança HITL, PR, Release & Retrospectiva)

* **Espelho do Profissional Sênior Real:** atua como *Engineering Manager + Release Engineer / SRE*. Protege a atenção do revisor humano (o recurso mais caro na era da IA), ordenando decisões por risco, garantindo plano explícito de **rollout/rollback** e **WIP limits**, prevenindo conflitos entre slices paralelos (`SymbolLockManager` + worktrees GC) e conduzindo **Blameless Post-Mortems / Retrospectivas** para transformar erros recorrentes em memória organizacional permanente.
* **Bugs & Limitações Atuais no Código:**
  * Em [controller.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/controller.ts#L226-L237), o `UzinaAgentController` usava `"openai/gpt-4o-mini"` hardcoded e não trocava dinamicamente o modelo/instruções ao alternar os modos (`discovery`, `architect`, `visual`, `build`, `review`).
  * Em `stageDecision` e `stageFinalize`, os resumos de decisão e Draft PR ainda não entregam um *Risk-Ranked Briefing* completo com *Confidence Score*, checklist de rollback/migração/env vars e custo FinOps isolado da entrega, nem destilam aprendizados para QMD após retrabalho/rejeição.
  * O `orchestrator` não tem tools para inspecionar `SymbolLockManager` ou worktrees órfãos nem rotina para detectar drift/entropia no projeto.
* **Restrições Negativas & Iron Laws:**
  * **Proibido:** aprovar ou fazer merge de entregável com `decision` pendente, `verifyPassed === false` ou sem passar pela Caixa de Decisões HITL; proibido disparar mais slices paralelos quando houver colisão de símbolos ou teto de orçamento (`budgetCapUsd` / `budgetCapTokens`) atingido.
  * **Iron Law:** *Toda rejeição humana com feedback e todo slice com $\ge 2$ ciclos de reprovação no Verify gera obrigatoriamente uma lição destilada em QMD antes de iniciar o próximo slice.*
* **Playbook / System Prompt v2:**
  1. Ao coordenar no chat da Agência, consultar `read_project_deliverables`, `read_finops_and_risk_digest` e `inspect_worktrees_and_locks` antes de sugerir paralelismo ou avançar ciclos.
  2. Antes de apresentar decisão HITL ou abrir Draft PR, consolidar `DecisionRiskBriefingSchema` (migrações, auth/RBAC, segredos, novas dependências, env vars, FinOps, `confidenceScore` e plano de rollback).
  3. Pós-rejeição/retrabalho: chamar `distill_retrospective_memory` (`category: "convention"` ou `"security_triage"`).
  4. Pós-merge: sincronizar o delta da entrega no documento vivo de especificação do projeto (*OpenSpec sync/archive*).
* **Contratos & Artefatos:**
  * *Entrada:* `EvidencePack`, `VerifierVerdictOutputV2`, histórico de eventos, estado de worktrees/locks, FinOps.
  * *Saída Imutável (Slice 31):* `DecisionRiskBriefingSchema` + Draft PR enriquecido + Memória QMD destilada + `EntropyAuditReportSchema` (Slice 34).
* **Matriz de Tools:**
  * *Atuais:* `search_qmd_memories`, `read_project_deliverables`, `inspect_codebase_skeleton`, `create_qmd_memory`.
  * *Novas (Slice 28):* `read_finops_and_risk_digest`, `inspect_worktrees_and_locks`, `distill_retrospective_memory`.
* **Skills Vinculadas:**
  * *Lead:* `release-briefing-and-retro`.
  * *Reference:* `architecture-blueprint` (para entendimento de fila/locks) e `openspec-brownfield-delta` (para *sync/archive* pós-merge).
* **Métricas & Evals (Slice 32):** `First-Pass Verify Rate`, `Confidence Score` médio, redução de retrabalho após gravação de memórias retrospectivas, zero worktrees órfãos pós-merge.

---

## 3. Catálogo Completo das 16 Skills (`packages/skills/`) e Conformidade de Licença

Todas as skills seguem o padrão aberto **`agentskills.io`** (*Progressive Disclosure* em 3 camadas: Discovery $\le 64$/$\le 1024$ chars $\rightarrow$ Activation $< 500$ linhas $\rightarrow$ `references/` + `templates/` + `scripts/`), estruturadas com **Iron Law**, **Entry/Exit Contracts** e **Tabela Anti-Racionalização (*Red Flags*)** inspirada em `obra/superpowers`. Todo o conteúdo é **redigido de forma 100% autoral** sob licença compatível com o Uzina Studio (Apache 2.0), sem cópia literal de repositórios `CC-BY-SA-4.0`.

| # | Slug da Skill (`packages/skills/`) | Status | Fase | Papéis | Categoria Anti-Conflito | Sub-recursos (`references/`, `templates/`, `scripts/`) | Inspiração Comunitária |
| :-: | :--- | :---: | :--- | :--- | :---: | :--- | :--- |
| 1 | `discovery-interview` | Upgrade v2 | Fase 1 | `product_discovery`, `copilot` | `Lead` | `templates/shape-spec-template.md` | `superpowers/brainstorming` + `BMAD` + `Shape Up` (MIT) |
| 2 | `domain-event-storming-bdd` | **Nova** | Fase 1 | `product_discovery` | `Reference` | `templates/bdd-rbac-matrix.md` | `sdlc-skills` + `helderberto/grill` (MIT) |
| 3 | `openspec-brownfield-delta` | **Nova** | Fase 1/2/6 | `product_discovery`, `software_architect`, `orchestrator` | `Lead` | `templates/delta-spec-template.md` | `Fission-AI/OpenSpec` (MIT) |
| 4 | `brownfield-archaeology` | Upgrade v2 | Fase 1B/2 | `software_architect`, `product_discovery` | `Lead` | `references/maturity-scorecard-rubric.md` | `trailofbits` *(conceito audit-context)* + `OpenSpec` |
| 5 | `architecture-blueprint` | Upgrade v2 | Fase 2 | `software_architect` | `Lead` | `templates/adr-rfc-template.md` | `BMAD Architect` + `Spec-Kit` (MIT) |
| 6 | `threat-modeling-stride-fmea` | **Nova** | Fase 2 | `software_architect`, `qa_appsec` | `Reference` | `references/stride-fmea-matrix.md` | Práticas STRIDE/FMEA + `Spec-Kit` |
| 7 | `visual-design-md` | Upgrade v2 | Fase 2.5 | `ux_designer`, `software_architect` | `Lead` | `references/tokens-wcag-checklist.md` | `frontend-design` + `ui-ux-pro-max` *(conceito autoral)* |
| 8 | `ui-design-critique-a11y` | **Nova** | Fase 2.5/4 | `ux_designer`, `qa_appsec` | `Critique` | `references/nielsen-wcag-5states.md` | `impeccable` + `vercel/web-design-guidelines` |
| 9 | `contract-first-msw` | Upgrade v2 | Fase 3A | `tech_lead`, `software_architect` | `Lead` / `Reference` | `templates/contract-drift-test.md` | `BMAD Story Sharding` + `Spec-Kit` (MIT) |
| 10 | `test-quality-engineering` | Upgrade v2 | Fase 3A/4 | `tech_lead`, `qa_appsec` | `Reference` / `Critique` | `references/bva-anti-patterns.md` | `superpowers/tdd` + `BMAD QA` (MIT) |
| 11 | `safe-db-migrations` | Upgrade v2 | Fase 2/3B/4 | `tech_lead`, `software_architect`, `qa_appsec` | `Reference` | `scripts/check-migration-ddl.mjs` | `supabase/postgres-best-practices` (MIT) |
| 12 | `systematic-debugging-3-strikes` | **Nova** | Fase 3B | `tech_lead`, `Coding Executor` | `Lead` | `references/scientific-debug-protocol.md` | `superpowers/systematic-debugging` + `getsentry/code-simplifier` (MIT) |
| 13 | `property-based-and-mutation-qa` | **Nova** | Fase 3A/4 | `tech_lead`, `qa_appsec` | `Reference` / `Critique` | `templates/fast-check-zod.md` | Indústria PBT (`fast-check`) + Mutation (`Stryker`) |
| 14 | `secure-code-audit` | Upgrade v2 | Fase 4 | `qa_appsec`, `Verifier` | `Critique` | `references/sarif-triage-guide.md` | `trailofbits` *(conceitos fp-check/SARIF, redação autoral)* |
| 15 | `differential-appsec-sharp-edges` | **Nova** | Fase 4 | `qa_appsec`, `Verifier` | `Critique` | `references/sharp-edges-checklist.md` | `trailofbits` *(conceitos diff-review/insecure-defaults/agentic-actions, redação autoral)* |
| 16 | `release-briefing-and-retro` | **Nova** | Fases 5/6 | `orchestrator`, `Verifier` | `Lead` | `templates/pr-risk-briefing.md` | `superpowers/finishing-branch` + `tikalk` + `helderberto/retro` (MIT) |

---

## 4. Matriz de Rastreabilidade Total (Rodada 1 + Rodada 2 → Slice Destino)

Esta tabela garante que **100%** dos bugs, lacunas, tools, primitivas Mastra Core, skills e técnicas de fronteira identificados nas duas rodadas estejam cobertos no plano:

| Origem (Rodada / Fonte) | Item / Melhoria Analisada | Destino Exato |
| :--- | :--- | :---: |
| **Rodada 1 · Bug** | `AgentController` com `"openai/gpt-4o-mini"` hardcoded (`controller.ts`) | **Slice 26** |
| **Rodada 1 · Gap** | Playbooks ricos por papel em `engineering-agents.ts` + `SkillsProcessor` / `SkillSearchProcessor` | **Slice 26** |
| **Rodada 1 · Mastra** | `WorkingMemory` tipada com schema Zod (`@mastra/memory`) | **Slice 26** |
| **Rodada 1 · Mastra** | `SemanticRecall` cross-thread isolado por `resourceId` multi-tenant | **Slice 26** |
| **Rodada 1 · Mastra** | `PromptInjectionDetector` para *untrusted checkouts* e saídas externas | **Slice 26** |
| **Rodada 1 · Mastra** | `TokenCostControl` / `CostGuardProcessor` + `ModelSelectionProcessor` | **Slice 26** |
| **Rodada 2 · Padrão** | `skills-loader.ts` v2 (`agentskills.io`: `references/`, `templates/`, `scripts/` + orçamentos) | **Slice 26** |
| **Rodada 2 · Padrão** | Upgrade das 8 skills existentes com *Iron Laws* e *Anti-Rationalization Tables* | **Slice 27** |
| **Rodada 2 · Comunidade** | 8 novas skills autorais (BDD, OpenSpec delta, STRIDE/FMEA, Critique/A11y, Debug 3-strikes, PBT/Mutation, Diff AppSec/Sharp Edges, Release/Retro) | **Slice 27** |
| **Rodada 2 · Comunidade** | Orquestração anti-conflito **Lead → Reference → Critique** contra *aesthetic averaging* | **Slice 27** |
| **Rodada 1 · Gap** | Expor `querySymbolGraphInMemory`, `computeChangeImpactInMemory`, `readSymbolSliceFromWorkspace` + `check_dependency_boundaries` | **Slice 28** |
| **Rodada 1 · Gap** | Tools para `ux_designer` (`read_design_system_contract`, `inspect_prototype_version`, `validate_color_contrast_and_tokens`) | **Slice 28** |
| **Rodada 1 · Gap** | Tools para `qa_appsec` (`read_security_scan_findings`, `read_deliverable_evidence_and_diff`, `run_test_anti_pattern_audit`) | **Slice 28** |
| **Rodada 1 · Gap** | Tools para `product_discovery`, `Executive Copilot` e `orchestrator` (`check_requirement_conflicts`, `read_finops_and_risk_digest`, `inspect_worktrees_and_locks`, `distill_retrospective_memory`) | **Slice 28** |
| **Rodada 1+2 · Fase 1** | *Ambiguity Gate*, *Shape Up* (`Appetite` + `Non-Goals`), Gherkin BDD e matriz RBAC/LGPD (`ShapeSpecSchema`) | **Slice 29** |
| **Rodada 1+2 · Fase 2** | Substituir regex pura em `decideOptimalAiStrategy` por Structured Output do `software_architect` (regex vira fallback) + ADR + STRIDE/FMEA + *Story Sharding* + deltas *OpenSpec* | **Slice 29** |
| **Rodada 1+2 · Fase 2.5** | Substituir regex pura em `inferDomainVisualBlueprint` por pipeline 3 estágios **Lead → Reference → Fresh-Context Critique** + `PrototypeComponentManifest` (`packages/ui`) | **Slice 29** |
| **Rodada 1+2 · Fase 3** | **Test Lock** (`lockedReadOnlyPaths` bloqueando alteração de `contractTestFiles` durante `stageBuild`) contra *reward hacking* | **Slice 30** |
| **Rodada 1+2 · Fase 3** | Micro-loop allowlisted seguro (`run_scoped_typecheck` com parser TS, `run_scoped_unit_test`, `validate_migration_safety`) respeitando `toolPolicies.runTests` | **Slice 30** |
| **Rodada 2 · Fase 3** | Depuração científica **3 Strikes** no `StuckDetector` + passada rápida de simplificação (`code-simplifier`) pré-verify | **Slice 30** |
| **Rodada 1+2 · Fase 4** | **Two-Stage Verifier** em contexto limpo read-only (Matriz Requisito↔Teste↔Diff antes de Qualidade/AppSec + *Refuting Verifier*) | **Slice 31** |
| **Rodada 1+2 · Fase 5/6** | *Risk-Ranked Decision Briefing* + *Confidence Score (0–100)* na Caixa de Decisões e Draft PR + plano de rollback | **Slice 31** |
| **Rodada 1+2 · Fase 6** | Destilação automática de retrospectiva para QMD após retrabalho/rejeição + *OpenSpec sync/archive* pós-merge | **Slice 31** |
| **Rodada 1 · Mastra** | Suíte determinística de **Evals de Trajetória** no CI (`pnpm verify`) + painel de efetividade dos agentes em `/app/finops` | **Slice 32** |
| **Rodada 1+2 · AppSec** | DAST passivo real em `staging_url` (headers/CORS/cookies) + adaptador Nuclei (`skipped_missing_binary`) | **Slice 33** |
| **Rodada 1+2 · AppSec** | SCA *Reachability Analysis* (Trivy + AST Graph) + EPSS/KEV + **SBOM CycloneDX** | **Slice 33** |
| **Rodada 2 · AppSec** | Scanner nativo `scanAgenticPromptInjectionNative` (`.github/workflows`, `AGENTS.md`, checkouts externos) | **Slice 33** |
| **Rodada 1+2 · QA UI** | Runner **Playwright + `@axe-core/playwright`** em `stageVerify` (`hasUi: true`, Desktop `1440x900` + Mobile `390x844`) | **Slice 34** |
| **Rodada 1+2 · QA** | Suporte a **Property-Based Testing (`fast-check`)** e adaptador opcional **Mutation Testing (Stryker)** | **Slice 34** |
| **Rodada 2 · Skills** | `.uzina/skills-lock.json` (SHA-256 + licenças) e UI de catálogo de skills | **Slice 34** |
| **Rodada 2 · Harness** | Rotina de **Entropy Management** (`uzina doctor --entropy` + drift/código morto/órfãos) | **Slice 34** |
| **Rodada 1+2 · Futuro** | Marketplace comunitário multi-stack (`Python/Go/Rust/Java`), LSP/SCIP real, `createCodeMode()` sandbox e SRE/OTel Auto-Healing | **Fase 4 (Pós-Slice 34)** |
