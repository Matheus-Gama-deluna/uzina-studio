---
name: contract-first-msw
description: Impõe contratos Zod/OpenAPI primeiro e mocks de rede via MSW com prevenção de Contract Drift.
applies_to_roles: [builder, architect]
---

# Skill: Contract-First + MSW

## Regras Obrigatórias
1. **Contrato antes de UI e API:** Crie ou atualize os schemas Zod/OpenAPI compartilhados antes de escrever componentes ou handlers HTTP.
2. **Mocks apenas na borda de rede:** Use Mock Service Worker (MSW) alimentado pelos contratos tipados. É **proibido** colocar dados mockados hardcoded ou `if (isMock)` dentro de componentes React.
3. **Estados reais:** Cubra nos handlers MSW os estados `200`, `400/422`, `401/403`, `500` e listas vazias.
4. **Contract Drift Check:** Garanta que exista teste automatizado validando que a resposta real da API passa no mesmo schema Zod usado pelo handler MSW.
