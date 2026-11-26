---
name: differential-appsec-sharp-edges
description: Use quando precisar revisar git diff na Fase 4 buscando falhas que scanners estáticos perdem, como fail-open defaults, sharp edges de APIs, variantes irmãs no repo e riscos em workflows agênticos.
applies_to_roles: [security, verifier]
phase: verify
role_category: critique
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca conclua uma revisão AppSec de Fase 4 confiando apenas em SARIF automático; audite o git diff linha a linha para defaults fail-open, APIs armadilha (sharp edges), variantes irmãs no codebase e vetores de injeção em configurações agênticas.
---

# Skill: Differential AppSec & Sharp-Edges Review

## Iron Law

> **Nunca aprove um `git diff` apenas porque os scanners SAST/SCA passaram; audite manualmente as mudanças em busca de *fail-open defaults*, APIs *sharp-edge*, *variant analysis* (mesmo erro em módulos irmãos) e riscos em workflows agênticos/CI.**

Scanners estáticos detectam padrões sintáticos conhecidos; revisão diferencial humana/agêntica captura falhas de lógica de autorização, regressões de configuração e caminhos inseguros por omissão.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `git diff` completo da entrega (`read_deliverable_evidence_and_diff`).
  - Contexto de arquitetura (`STRIDE/FMEA`) e triagem SARIF de `secure-code-audit`.
- **Exit Artifact (Saída Imutável):**
  - Relatório diferencial por arquivo alterado listando:
    - Confirmação ou reprovação para *fail-open defaults*, *sharp edges* e regressão de RBAC/tenant;
    - Resultado da busca de variantes irmãs (`query_codebase_symbols` / `trace_symbol_call_graph`);
    - Avaliação de segurança de `.github/workflows`, `AGENTS.md`, skills e hooks se tocados no diff.

## Protocolo

### Step 0 — Escopo do Diff e Superfícies Críticas
1. Inspecione todo o `git diff` via `read_deliverable_evidence_and_diff` classificando arquivos de maior risco: auth/RBAC, criptografia/Vault, rotas HTTP/Server Actions, filesystem/worktrees, subprocessos e arquivos `.github/workflows` / `.uzina/` / `AGENTS.md`.
2. Identifique código de segurança ou validação que foi **removido ou relaxado** no diff.

### Step 1 — Detecção de Fail-Open Defaults & Sharp Edges
1. Carregue `references/sharp-edges-checklist.md` e verifique cada alteração contra as armadilhas críticas:
   - Falhas silenciosas abrindo acesso (`catch { return true; }`, `role ?? "admin"`, bypass quando env var está vazia);
   - Execução de shell (`shell: true`, interpolação em template string);
   - Path handling sem `lstatSync` / `assertPathInsideWorkspace` ou suscetível a symlink/junction;
   - Campos sensíveis serializados em DTOs públicos, logs ou MSW fixtures.

### Step 2 — Variant Analysis & Segurança de Workflows Agênticos
1. Ao encontrar um bug ou padrão perigoso no diff, busque **variantes irmãs** no repositório com `query_codebase_symbols` / `trace_symbol_call_graph` para garantir que o padrão não exista em endpoints paralelos.
2. Se o diff tocar `.github/workflows`, `AGENTS.md` ou adaptadores de checkout externo, valide contra *indirect prompt injection*, `pull_request_target` inseguro e permissões excessivas de token.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Só foi adicionado um `try/catch` para não quebrar a tela se o auth falhar." | Converte falha de verificação em acesso liberado (*fail-open*). | Exija *fail-closed*: qualquer erro de verificação deve negar acesso (`401/403`) e lançar erro explícito. |
| "Esse parâmetro booleano `skipVerify` é só opcional para testes internos." | APIs *sharp-edge* com flag de bypass opcional acabam sendo ligadas em produção por engano. | Remova a flag de bypass da API produtiva ou isole em harness estrito de teste. |
| "Corrigi o path traversal neste endpoint, o resto do app não mexi." | Endpoints irmãos frequentemente copiam o mesmo padrão vulnerável (*variants*). | Rastreie chamadas semelhantes e reporte todas as ocorrências irmãs encontradas. |

## Ponteiros Progressivos

- Carregue [references/sharp-edges-checklist.md](references/sharp-edges-checklist.md) antes de iniciar a leitura do `git diff` na Fase 4.
- Opere em dupla com `secure-code-audit` para cobrir tanto achados automatizados (SARIF) quanto falhas lógicas diferenciais.
