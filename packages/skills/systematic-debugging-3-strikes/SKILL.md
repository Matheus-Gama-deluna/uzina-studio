---
name: systematic-debugging-3-strikes
description: Use quando precisar corrigir falhas de build, typecheck ou testes na Fase 3B, aplicando depuração científica em 4 fases, regra de 3 Strikes com hipótese obrigatória na 2ª falha e poda pré-review.
applies_to_roles: [builder]
phase: build
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca edite código às cegas nem altere arquivos de contractTestFiles travados; na 2ª falha consecutiva pare de editar para registrar a hipótese de causa-raiz, e na 3ª falha escale via StuckAlert.
---

# Skill: Systematic Debugging (Protocolo Científico & Regra 3 Strikes)

## Iron Law

> **Nunca aplique correções por tentativa e erro e jamais modifique `contractTestFiles` travados (`lockedReadOnlyPaths`) para forçar um teste verde; na 2ª falha consecutiva do mesmo erro/teste, pare de editar e registre a hipótese da causa-raiz; na 3ª falha, escale imediatamente.**

Antes de declarar o build concluído, execute uma passada focada de simplificação nos arquivos modificados removendo código morto e imports não utilizados.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `StoryShard` + `contractTestFiles` (somente leitura) + erro reproduzível de `run_scoped_typecheck` ou `run_scoped_unit_test`.
  - Leitura obrigatória dos arquivos-alvo antes da escrita (`requireReadBeforeWrite`).
- **Exit Artifact (Saída Imutável):**
  - `git diff` limpo no worktree restrito a `allowedPaths`;
  - Evidência fresca de `run_scoped_typecheck` e `run_scoped_unit_test` passando, ou escalação estruturada (`StuckAlert`) após 3 tentativas sem resolução.

## Protocolo

### Step 0 — Reprodução Fiel e Leitura de Evidência
1. Leia a saída completa do erro (`stderr` / diagnóstico TS / falha Vitest) sem pular stack frames.
2. Reproduza o erro exatamente com `run_scoped_unit_test` ou `run_scoped_typecheck` antes de tocar em qualquer arquivo.

### Step 1 — Isolamento de Causa-Raiz e Hipótese Única
1. Trace o fluxo entre entrada, transformação e asserção que falhou usando leitura cirúrgica do código real.
2. Formule **uma única hipótese explícita** (ex.: *"O schema Zod exige `.js` no import ou o campo `organizationId` não foi propagado no mapper"*).
3. Aplique a menor edição cirúrgica que testa essa hipótese e valide imediatamente no micro-loop.

### Step 2 — Regra Estrita 3 Strikes & Simplificação Pré-Review
1. Carregue `references/scientific-debug-protocol.md`:
   - **Strike 1:** edite com hipótese documentada e re-execute o check focado;
   - **Strike 2:** **PARE DE EDITAR.** Releia os contratos, tipos e premissas arquiteturais; registre a causa-raiz revisada antes da próxima alteração;
   - **Strike 3:** pare imediatamente e emita `StuckAlert` para escalação ao `software_architect` ou HITL.
2. Quando o teste passar, faça uma passada rápida de limpeza (*code simplifier*) apenas nos arquivos que você tocou (removendo variáveis mortas, logs temporários e imports órfãos) e re-execute os checks focados após a última edição.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Vou mudar a asserção do teste de contrato para combinar com meu retorno." | Viola o contrato aprovado e configura *reward hacking*. | Mantenha `contractTestFiles` intocado e corrija a implementação (ou escale se a spec tiver bug). |
| "Vou tentar mais uma alteração rápida aqui, quem sabe agora passa." | Sem hipótese de causa-raiz, entra em loop infinito e queima cota. | Respeite o Strike 2 (pausa diagnóstica) e Strike 3 (escalação imediata). |
| "Passei o teste na última edição, vou encerrar sem rodar de novo após limpar um import." | Remoção de import ou ajuste cosmético pode quebrar o typecheck. | Re-execute `run_scoped_typecheck` e `run_scoped_unit_test` após a última edição. |

## Ponteiros Progressivos

- Carregue [references/scientific-debug-protocol.md](references/scientific-debug-protocol.md) ao atingir a 2ª falha consecutiva ou precisar conduzir o passo de simplificação pré-review.
- Combine com `contract-first-msw` e `safe-db-migrations` sempre que o shard alterar bordas HTTP ou schemas Drizzle.
