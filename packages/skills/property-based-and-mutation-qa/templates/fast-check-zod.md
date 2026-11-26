# Template: Property-Based Testing (`fast-check` + Zod + Vitest)

Use este padrão para testar parsers, normalizadores, cálculos e invariantes de segurança com `fast-check`.

```ts
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { ExampleInputSchema } from "@uzina/contracts";

describe("Property-Based QA — <Módulo>", () => {
  test("invariante: entradas geradas válidas preservam propriedades após normalização", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
        (rawInput) => {
          const parsed = ExampleInputSchema.safeParse({ label: rawInput });
          if (parsed.success) {
            expect(parsed.data.label).toBe(rawInput.trim());
          }
        }
      ),
      { numRuns: 75, seed: 20261125 }
    );
  });

  test("invariante de segurança: qualquer payload com traversal ou null-byte é rejeitado", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("..", "../", "..\\", "\0"),
        fc.string({ maxLength: 24 }),
        (danger, suffix) => {
          expect(() => validateSafePath(`${danger}${suffix}`)).toThrowError();
        }
      ),
      { numRuns: 50, seed: 20261125 }
    );
  });
});
```

## Checklist de Mutantes Críticos (Auditoria Manual ou Stryker)
- [ ] Inverter `<` / `<=` ou `>` / `>=` nos limites do domínio quebra pelo menos 1 teste.
- [ ] Remover guarda de `organizationId` ou `OrgRole` quebra pelo menos 1 teste.
- [ ] Retornar `true` ou `[]` antecipadamente no handler quebra os testes de contrato.
