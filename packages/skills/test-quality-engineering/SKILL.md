---
name: test-quality-engineering
description: Impõe isolamento Spec-to-Test, proíbe over-mocking interno, exige Tests as Data, casos de fronteira/segurança e poda de testes redundantes.
applies_to_roles: [builder, verifier]
---

# Skill: Test Quality Engineering (Anti-Teatro de Cobertura)

## Regras Obrigatórias
1. **Isolamento Spec → Teste:** Derive os testes de aceitação a partir da Spec e dos contratos Zod/OpenAPI — nunca espelhando a lógica interna da implementação (proibido testes tautológicos).
2. **Troféu de Testes + Dependências Reais:** Proibido mockar banco de dados ou serviços internos em testes de integração. Use PGlite em memória e MSW na borda externa.
3. **Proibições Estáticas (Validadas no `.uzina/verify`):**
   - Zero testes sem asserção (`expect`/`assert`);
   - Zero asserções triviais isoladas (`toBeTruthy()`, `toBeDefined()`, `not.toBeNull()` sem validar valor/contrato);
   - Zero `try/catch` engolindo exceções em testes;
   - Zero `setTimeout`/`sleep` arbitrário em testes unitários.
4. **Fronteiras e Segurança Obrigatórias:** Inclua explicitamente entradas vazias, `0`, negativos, limites máximos, erros de autorização e isolamento entre clientes/tenants.
5. **Regra de Poda (Anti-Bloat):** Consolide 3 ou mais testes com corpo idêntico em `test.each` (*Tests as Data*) e remova testes redundantes que não agreguem sinal comportamental novo.
