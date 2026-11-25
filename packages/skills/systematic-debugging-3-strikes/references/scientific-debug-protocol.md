# Referência: Protocolo Científico de Depuração (4 Fases & 3 Strikes)

## 1. As 4 Fases da Depuração Científica
1. **Reproduzir:** capture o comando exato (`run_scoped_typecheck` / `run_scoped_unit_test`) e a primeira mensagem de erro real (evite efeitos cascata).
2. **Isolar:** identifique a fronteira exata onde o valor real diverge do valor esperado (entrada → parser Zod → serviço → Drizzle/PGlite).
3. **Hipótese Única:** escreva uma frase objetiva prevendo *por que* a mudança proposta corrige o desvio. Altere um fator por vez.
4. **Verificar:** rode o teste focado; se passar, rode a checagem de tipo do pacote afetado.

## 2. Escalonamento 3 Strikes (Contra Loops de Agentes)
| Tentativa | Estado | Ação Obrigatória |
| :---: | :--- | :--- |
| **Strike 1** | 1ª falha do mesmo erro/teste | Analisar stack trace completo, formular 1 hipótese e testar ajuste mínimo. |
| **Strike 2** | 2ª falha consecutiva | **BLOQUEIO DE EDIÇÃO:** parar, reler `ShapeSpec`/`ArchitectBlueprintV2`/contratos e registrar `rootCauseHypothesis` explícita. |
| **Strike 3** | 3ª falha consecutiva | **ESCALAÇÃO IMEDIATA:** interromper tentativas, emitir `StuckAlert` (`escalatedToArchitect: true`) e preservar o diff para diagnóstico. |

## 3. Checklist Rápido de Simplificação Pré-Review (Somente Arquivos Tocados)
- [ ] Zero `console.log` de depuração ou comentários temporários.
- [ ] Zero imports não utilizados, variáveis mortas ou duplicação entre 2+ blocos adicionados.
- [ ] Checks focados (`typecheck` + teste do shard) executados **depois** da limpeza final.
