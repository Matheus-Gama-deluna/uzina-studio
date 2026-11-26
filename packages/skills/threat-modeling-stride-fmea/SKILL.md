---
name: threat-modeling-stride-fmea
description: Use quando precisar executar modelagem de ameaças STRIDE nas fronteiras de confiança e análise de modos de falha FMEA para auth, multi-tenancy, cofre de chaves, uploads ou execuções agênticas na Fase 2.
applies_to_roles: [architect, security]
phase: architecture
role_category: reference
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca aprove arquitetura envolvendo autenticação, isolamento multi-tenant, criptografia, uploads ou ferramentas agênticas sem mapear fronteiras de confiança com STRIDE, pontuar modos de falha FMEA e vincular um teste de verificação para cada mitigação.
---

# Skill: Threat Modeling (STRIDE) & FMEA

## Iron Law

> **Nunca aprove arquitetura tocando autenticação, isolamento multi-tenant, cofre de segredos, uploads, subprocessos ou fluxos LLM/MCP sem mapear as fronteiras de confiança com STRIDE, registrar modos de falha FMEA e vincular cada mitigação a uma verificação testável.**

Ameaça identificada sem controle arquitetural e sem teste verificável é apenas documentação decorativa.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `ShapeSpec` (com `dataSensitivityFlags`) e desenho preliminar do `architecture-blueprint`.
  - Consulta às fronteiras reais via `check_dependency_boundaries` e `trace_symbol_call_graph`.
- **Exit Artifact (Saída Imutável):**
  - Matriz **STRIDE × Fronteira de Confiança** + **FMEA** (`strideFmeaRisks[]`) seguindo `references/stride-fmea-matrix.md`, onde cada risco crítico/alto possui `mitigation` e `verifyCheck` concretos.

## Protocolo

### Step 0 — Mapeamento de Fronteiras de Confiança (*Trust Boundaries*)
1. Identifique cada cruzamento de fronteira:
   - Navegador / Cliente externo → Next.js Server Action / Route Handler;
   - Sessão de Usuário (`OrgRole`) → Dados de outra `organizationId`;
   - Runtime → Cofre AES-256-GCM / Variáveis de ambiente / Sistema de arquivos;
   - Agente LLM / Checkout externo → Worktree / Subprocesso / MCP Tool.
2. Consulte `search_qmd_memories` (`category: "security_triage"`) para reutilizar controles aprovados anteriormente.

### Step 1 — Análise STRIDE por Fronteira
1. Avalie as 6 categorias **STRIDE**: *Spoofing*, *Tampering*, *Repudiation*, *Information Disclosure*, *Denial of Service* e *Elevation of Privilege*.
2. Foque especialmente em vetores de IA/Agentes: *indirect prompt injection*, *path traversal*, vazamento de `.master-key`/`.env`, *reward hacking* sobre testes e esgotamento de orçamento (`budgetCapUsd`).

### Step 2 — Análise FMEA & Vinculação ao Verify
1. Carregue `references/stride-fmea-matrix.md` e avalie Severidade, Ocorrência e Detectabilidade para cada modo de falha.
2. Para cada risco alto/crítico, defina a mitigação arquitetural (ex.: Zod `safeParse`, `assertPathInsideWorkspace`, `execFile` com `shell: false`, AES-256-GCM) e o `verifyCheck` que o `tech_lead` / `Verifier` deverá automatizar.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "É uma rota interna da API; ninguém de fora vai chamar." | Qualquer usuário autenticado ou XSS/SSRF pode atingir rotas sem guarda de RBAC/tenant. | Exija verificação explícita de sessão, `organizationId` e `OrgRole` no servidor. |
| "O LLM recebe instruções para não ler o `.env`." | Instruções em prompt não são barreira de segurança contra *prompt injection*. | Aplique contenção determinística no runtime (`isSensitiveWorkspaceFile`, `path-guard`). |
| "Não precisa listar falha de timeout ou crash parcial." | Processos travados ou transações parciais corrompem worktrees e consomem cota. | Registre o modo de falha FMEA com `AbortSignal`, timeout e rollback explícito. |

## Ponteiros Progressivos

- Carregue [references/stride-fmea-matrix.md](references/stride-fmea-matrix.md) para consultar os controles padrão do Uzina Studio por categoria STRIDE e formato de saída FMEA.
- Na Fase 4, os controles definidos aqui alimentam `secure-code-audit` e `differential-appsec-sharp-edges`.
