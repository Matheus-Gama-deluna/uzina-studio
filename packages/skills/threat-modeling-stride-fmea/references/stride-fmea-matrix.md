# Matriz de Referência: STRIDE × Fronteiras Uzina & FMEA

## 1. Controles Obrigatórios por Categoria STRIDE
| Categoria | Vetor Típico no Uzina Studio | Controle Arquitetural Obrigatório | Verificação (`verifyCheck`) |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Requisição forjada sem sessão ou troca de tenant | Sessão Better Auth validada no servidor + `organizationId` da sessão | Teste `401` anônimo e `403/404` cross-tenant |
| **Tampering** | Alteração de testes pelo Builder; SQL/Path traversal | `lockedReadOnlyPaths`, `assertPathInsideWorkspace`, Zod `safeParse` | Teste bloqueando edição de teste e `..` |
| **Repudiation** | Mutação HITL ou uso de ferramenta sem trilha | Logs estruturados, eventos de auditoria e trilha de `tool_call` | Verificar registro de ator e timestamp |
| **Info Disclosure** | Vazamento de chaves API, `.env`, stack trace em erro | Cofre AES-256-GCM, `redactSensitiveText`, rota `/api/assets/:id` | Teste verificando ausência de segredo/PII |
| **Denial of Service** | Loop infinito de agente, payload gigante, DDL com lock | `StuckDetector`, `BudgetGuardProcessor`, `maxBytes`, `AbortSignal` | Teste de limite BVA e timeout |
| **Elevation of Privilege** | Perfil `auditor` executando escrita ou prompt injection | Guard `OrgRole` no servidor + `PromptInjectionDetector` | Teste `auditor` recebendo `403` |

## 2. Formato FMEA para `strideFmeaRisks[]`
- **`category`:** `Spoofing | Tampering | Repudiation | InformationDisclosure | DenialOfService | ElevationOfPrivilege | FailureMode`
- **`threatOrFailure`:** descrição objetiva do vetor ou falha operacional.
- **`severity`:** `low | medium | high | critical`
- **`mitigation`:** guarda determinística no código/infraestrutura (nunca depender só de prompt).
- **`verifyCheck`:** teste automatizado ou scanner que comprova a mitigação antes do merge.
