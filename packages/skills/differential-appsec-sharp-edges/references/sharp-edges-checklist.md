# Checklist: Differential AppSec & Sharp-Edges

## 1. Fail-Open Defaults (Reprovação Imediata)
- [ ] Nenhum `catch` retorna `true`, `{ allowed: true }` ou prossegue após falha de validação/auth.
- [ ] Nenhum fallback assume papel privilegiado (`role ?? "owner"`), `organizationId` default ou chave fixa quando `MASTER_ENCRYPTION_KEY` falta.
- [ ] Validações de entrada usam allowlist estrita em vez de blocklist parcial.

## 2. APIs Armadilha (*Sharp Edges*)
- [ ] Subprocessos usam exclusivamente `execFile` / `spawn` com `shell: false` e array de argumentos validados.
- [ ] Operações de arquivo verificam `lstatSync().isSymbolicLink()` + `assertPathInsideWorkspace` + filtro de sensíveis (`.env*`, `.master-key`, `*.pem`, `*.key`).
- [ ] Criptografia usa AES-256-GCM com IV aleatório de 12 bytes (`crypto.randomBytes`) e AuthTag de 16 bytes — nunca IV fixo ou ECB/CBC sem HMAC.
- [ ] Consultas de banco multi-tenant filtram explicitamente por `organizationId` derivado da sessão autenticada (nunca confiado do body/query sem validação).

## 3. Variant Analysis & Workflows Agênticos
- [ ] Todo padrão vulnerável encontrado foi pesquisado em handlers/tools irmãos no monorepo.
- [ ] Alterações em `.github/workflows` usam SHA pinado ou permissões mínimas (`permissions: read-all`), sem interpolação direta de `${{ github.event.*.title/body }}` em `run:`.
- [ ] Conteúdos externos/untrusted (`AGENTS.md` de checkout, SARIF, PR body) passam por `PromptInjectionDetector` ou escaping antes de entrar em contexto de agente.
