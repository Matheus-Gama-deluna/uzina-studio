# Referência: Análise de Valor Limite (BVA) & Anti-Padrões de Teste

## 1. Matriz Mínima de BVA e Partição de Equivalência
| Tipo de Entrada | Partições Obrigatórias | Valores de Fronteira (BVA) |
| :--- | :--- | :--- |
| **String (`min..max`)** | Vazia, apenas espaços, válida, inválida (caracteres proibidos) | `""`, `"   "`, len `min`, len `max`, len `max + 1` |
| **Inteiro / Valor (`min..max`)** | Negativo, zero, dentro do intervalo, acima do limite | `min - 1`, `min`, `0`, `max`, `max + 1` |
| **Lista / Paginação** | Lista vazia, 1 item, limite de página, overflow | `[]`, `limit = 1`, `limit = max`, `limit = max + 1` |
| **Caminho de Arquivo** | Relativo válido, traversal, absoluto, sensível | `"src/a.ts"`, `"../.env"`, `".master-key"`, `"\0"` |
| **RBAC / Tenant** | Dono do tenant, papel `auditor`, outro tenant, anônimo | `owner` (ok), `auditor` (403), `orgB` (404/403), `null` (401) |

## 2. Anti-Padrões Bloqueados pelo Auditor Estático (`auditTestDirectory`)
1. **Teste sem asserção:** bloco `test(...)` ou `it(...)` sem nenhum `expect(...)` ou `assert.*`.
2. **Asserção tautológica / trivial isolada:** `expect(res).toBeTruthy()`, `expect(res).toBeDefined()`, `expect(res).not.toBeNull()` como única verificação do comportamento.
3. **Engolimento de exceção:** `try { await fn(); } catch {}` sem `expect.unreachable()` ou `await expect(fn()).rejects.toThrowError(...)`.
4. **Sleep arbitrário:** `await new Promise((r) => setTimeout(r, 500))` em teste unitário (use eventos determinísticos, fake timers ou `vi.waitFor` com condição real).
5. **Over-mocking interno:** mockar módulo interno sob teste ou banco de dados em teste de integração em vez de usar PGlite / MSW na borda externa.
6. **Duplicação de casos (`>= 3`):** três ou mais `test(...)` com estrutura idêntica devem virar `test.each([...])`.
