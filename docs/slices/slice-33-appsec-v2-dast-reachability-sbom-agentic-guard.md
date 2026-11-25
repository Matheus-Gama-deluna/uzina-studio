# Dossiê do Slice 33 (Onda 2) — AppSec v2: DAST Passivo, Reachability, SBOM CycloneDX & Guard Agêntico

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `0961fee`, após contratos `ff08845`)
* **Estratégia Aplicada:** *Contract-First + Fronteira Estrita `@uzina/security-engine` (`contracts` + `core` apenas) + TDD*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **GAP-08**, expandindo `@uzina/security-engine` além de SAST estático para DAST passivo real em `staging_url`, *Reachability Analysis* sobre achados SCA, geração de SBOM CycloneDX 1.5 e scanner nativo contra *indirect prompt injection* em checkouts e workflows agênticos.

---

## 2. Entregas Realizadas (`ff08845` + `0961fee`)
- **Contratos (`@uzina/contracts`):** `DastHeaderCheckSchema`, `DastPassiveReportSchema`, `SbomComponentSchema`, `SbomDocumentSummarySchema`, `ScaReachabilityAnnotationSchema` e `AgenticPromptInjectionFindingSchema` em [security-v2.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/security-v2.ts).
- **DAST Passivo & Nuclei (`targetType === "staging_url"`):** [dast-passive.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/dast-passive.ts) e [engine.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/engine.ts) — `assertDastTargetAllowed` pré-request + `redirect: "manual"` validando `Location`, checagem de CSP/HSTS/`X-Content-Type-Options`/`Referrer-Policy`, CORS inseguro (`*` + credentials), flags de cookies (`HttpOnly`/`Secure`/`SameSite`) e adaptador `nuclei` (`execFile`, `shell: false`, `skipped_missing_binary`).
- **SCA Reachability Analysis:** [reachability.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/reachability.ts) — parser nativo de imports/requires (TS/JS/PY/GO, sem importar `@uzina/codebase-intel`) + suporte a grafo pré-computado opcional e metadados EPSS/KEV (`reachable | unreachable | unknown`).
- **SBOM CycloneDX 1.5:** [sbom.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/sbom.ts) — geração determinística a partir de `pnpm-lock.yaml` / `package-lock.json` / `package.json`, com adaptador opcional `syft` (`execFile`, fallback nativo).
- **Guard contra Prompt Injection Agêntico:** `scanAgenticPromptInjectionNative` em [native-scanners.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/native-scanners.ts) inspecionando `.github/workflows/*.yml`, `AGENTS.md`, `CLAUDE.md` e `SKILL.md` (`${{ github.event.* }}` em `run:`, tags de controle, caracteres zero-width/bidi e exfiltração com `curl`/`wget`).
- **Testes:** [slice33-appsec-v2.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/tests/slice33-appsec-v2.test.ts).

---

## 3. Evidências de Verificação
- `pnpm --filter @uzina/security-engine build`: **PASS**
- `pnpm --filter @uzina/security-engine test -- tests/slice33-appsec-v2.test.ts`: **1 file, 14 tests passed**
- Fronteira respeitada (`package.json` sem `@uzina/codebase-intel`) | `node scripts/check-no-ee.mjs`: **exit 0**
- *Pendente apenas:* auditoria `appsec-auditor` consolidada e `pnpm verify` global na Onda 4.
