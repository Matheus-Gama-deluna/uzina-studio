---
name: better-auth-multitenant-rbac
description: >-
  Implementa autenticacao, organizacoes multi-tenant e controle de acesso baseado em papeis (RBAC)
  com Better Auth e Drizzle ORM na Fabrica de Software. Use esta skill ao configurar login, sessoes,
  permissoes (owner, admin, developer, auditor) ou guards de Server Actions e APIs da fabrica.
---

# Better Auth Multi-Tenant RBAC — Autenticacao e Permissoes da Fabrica

Esta skill padroniza a camada de identidade e controle de acesso da Fabrica de Software usando **Better Auth** integrado ao **Drizzle ORM** (PGlite local / PostgreSQL em producao).

---

## 1. Modelo Multi-Tenant e Papeis da Fabrica

Toda operacao na fabrica pertence a uma **Organizacao (`organizationId`)** com quatro papeis bem definidos:

| Papel (`role`) | Permissoes na Superficie Executiva | Permissoes na Superficie Tecnica e Cofre |
| :--- | :--- | :--- |
| **`owner`** | Aprovar specs, definir orcamentos, gerenciar membros | Gerenciar e rotacionar chaves do Provider Vault, aprovar merges |
| **`admin`** | Aprovar specs, configurar projetos e politicas SAST | Configurar provedores no Vault, disparar pipelines e worktrees |
| **`developer`** | Criar specs, iniciar runs de agentes e revisar planos | Inspecionar worktrees, diffs, logs Mastra/OpenCode e rodar testes |
| **`auditor`** | Visualizar custos, trilhas de auditoria e aprovacoes | Somente leitura em relatorios SAST (SARIF), diffs e telemetria |

---

## 2. Guards Deterministicos no Servidor

1. **Helper `requireOrgRole(allowedRoles)`**:
   - Deve validar a sessao do Better Auth no servidor, confirmar que o usuario pertence a `organizationId` ativa e que seu papel esta em `allowedRoles`.
   - Em caso de falha, registrar tentativa no log de auditoria e retornar erro `401 Unauthorized` ou `403 Forbidden`.
2. **Isolamento de Queries Drizzle**:
   - Toda query de leitura ou escrita em projetos, runs, worktrees, cofres e relatorios SAST deve incluir `eq(table.organizationId, activeOrgId)`.
3. **Verificacao com Subagente**:
   - Apos criar ou alterar rotas protegidas, acione `appsec-auditor` (`Model: "flash"`) para verificar ausencia de IDOR ou bypass de papel.
