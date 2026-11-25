---
name: secure-code-audit
description: Use quando precisar auditar achados SARIF de SAST/SCA/Gitleaks na Fase 4, conduzindo verificação de fluxo source-to-sink, tentativa explícita de refutação (Refuting Verifier) e prova de vulnerabilidade (PoV).
applies_to_roles: [security, verifier]
phase: verify
role_category: critique
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca classifique um achado SARIF sem ler o fluxo real source-to-sink, tente refutar todo achado antes de confirmá-lo, exija PoV para severidades críticas/altas e jamais declare 100% seguro se algum scanner retornou skipped_missing_binary.
---

# Skill: Secure Code Audit & SARIF Triage (Refuting Verifier)

## Iron Law

> **Nunca classifique um achado SARIF sem inspecionar o código-fonte real do `source` ao `sink`; tente ativamente refutar o achado (*Refuting Verifier*) antes de confirmá-lo; exija Prova de Vulnerabilidade (PoV) para falhas críticas/altas e jamais declare o sistema limpo se houver scanner com `skipped_missing_binary`.**

A auditoria deve operar em contexto limpo e estritamente somente-leitura com postura **Default-FAIL**.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Relatório SARIF ou achados de `read_security_scan_findings` (Semgrep/Opengrep, Gitleaks, Trivy, OSV-Scanner ou DAST).
  - Acesso ao código-fonte real via `read_symbol_source_slice` e `trace_symbol_call_graph`.
- **Exit Artifact (Saída Imutável):**
  - Triagem classificada estritamente em `confirmed | false_positive | unknown` seguindo `references/sarif-triage-guide.md`;
  - Lista explícita de lacunas de cobertura quando algum scanner estiver em `skipped_missing_binary`;
  - Prova de Correção (PoV) para achados `confirmed` de severidade crítica ou alta.

## Protocolo

### Step 0 — Inventário de Scanners e Cobertura Real
1. Consulte `read_security_scan_findings` e `read_deliverable_evidence_and_diff`.
2. Verifique imediatamente o status de cada scanner: qualquer `skipped_missing_binary` deve ser destacado como **lacuna não coberta**, jamais como aprovação.

### Step 1 — Análise Source → Sink e Refuting Verifier
1. Para cada achado, leia o ponto de entrada (`source`) e o ponto perigoso (`sink`) no código real usando `read_symbol_source_slice` e `trace_symbol_call_graph`.
2. Execute o passo **Refuting Verifier** tentando provar que o achado é falso positivo:
   - Existe validação Zod estrita antes do sink?
   - Existe contenção de path (`assertPathInsideWorkspace`), query parametrizada (`Drizzle`) ou verificação de `organizationId` + `OrgRole` no servidor?
   - O código atingível está morto ou protegido por feature flag desligada?
3. Se a refutação **não** se sustentar por evidência direta no código, classifique como `confirmed` (ou `unknown` se faltar contexto externo).

### Step 2 — Modelo de 3 Vereditos e PoV
1. Carregue `references/sarif-triage-guide.md` e registre cada achado em exatamente um dos 3 vereditos: `confirmed`, `false_positive` ou `unknown`.
2. Para toda vulnerabilidade `confirmed` crítica ou alta, exija teste automatizado (PoV) que falhe contra a versão vulnerável e passe após o patch.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "O scanner não retornou nenhum erro; está 100% seguro." | Se o binário estava ausente (`skipped_missing_binary`), nada foi analisado. | Verifique o status dos executores e reporte explicitamente qualquer scanner pulado. |
| "A regra do Semgrep disparou, então deve ser vulnerável." | Falsa taxa positiva destrói a confiança da equipe na Caixa de Decisões. | Leia o fluxo source-to-sink e execute o *Refuting Verifier* antes de confirmar. |
| "Parece suspeito, mas não entendi o fluxo; vou marcar `false_positive`." | Oculta vulnerabilidade real atrás de chute otimista. | Classifique como `unknown` e solicite evidência adicional de alcance/validação. |
| "Já corrigi o bug de segurança na linha, não precisa de teste PoV." | Regressões futuras reintroduzem a falha silenciosamente sem teste de prova. | Exija teste automatizado que reproduza o vetor bloqueado. |

## Ponteiros Progressivos

- Carregue [references/sarif-triage-guide.md](references/sarif-triage-guide.md) para consultar a árvore de decisão dos 3 vereditos, critérios de refutação e estrutura mínima de PoV.
- Combine com `differential-appsec-sharp-edges` ao revisar o `git diff` da entrega buscando falhas que scanners estáticos não enxergam.
