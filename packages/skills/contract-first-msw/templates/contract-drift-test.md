# Template: Contract Drift Check (MSW + API + Zod)

Use este molde ao criar testes de contrato na Fase 3A (`apps/web/tests/sliceXX-contract-drift.test.ts` ou pacote alvo).

```ts
import { describe, expect, test } from "vitest";
// Importe os schemas reais de @uzina/contracts (fonte única de verdade)
import { ExampleOutputSchema } from "@uzina/contracts";

describe("Contract Drift Check — <Módulo / Rota>", () => {
  test.each([
    { label: "lista populada (200)", status: 200, scenario: "populated" },
    { label: "lista vazia (200)", status: 200, scenario: "empty" },
  ])("fixture MSW '$label' adere estritamente ao contrato Zod", async ({ scenario }) => {
    const mswPayload = buildExampleMswFixture(scenario);
    const parsed = ExampleOutputSchema.safeParse(mswPayload);
    expect(parsed.success).toBe(true);
  });

  test.each([
    { label: "não autenticado", expectedStatus: 401 },
    { label: "sem permissão RBAC", expectedStatus: 403 },
    { label: "payload inválido", expectedStatus: 422 },
  ])("handler real aplica borda de segurança e erro ($label)", async ({ expectedStatus }) => {
    // Chame a rota/action real contra PGlite em memória (sem mockar o banco)
    const response = await invokeRealHandlerForScenario(expectedStatus);
    expect(response.status).toBe(expectedStatus);
  });
});
```

## Checklist Obrigatório do Template
- [ ] Nenhum segredo ou campo interno (`encryptedApiKey`, `passwordHash`) presente no fixture MSW.
- [ ] Fixtures MSW e resposta real passam no **mesmo** `Schema.safeParse(...)`.
- [ ] Casos repetitivos consolidados via `test.each`.
