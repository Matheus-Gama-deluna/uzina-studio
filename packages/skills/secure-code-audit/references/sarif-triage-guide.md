# Guia: Triagem SARIF em 3 Vereditos & Refuting Verifier

## 1. Os 3 Vereditos Permitidos
| Veredito | Critério Objetivo | Evidência Obrigatória |
| :--- | :--- | :--- |
| `confirmed` | Entrada não confiável ou segredo atinge sink sem mitigação suficiente. | Arquivo, linha, caminho `source -> sink` e PoV (para crítica/alta). |
| `false_positive` | Mitigação comprovada no código impede exploração ou código é inatingível. | Trecho exato da guarda (Zod, `assertPathInsideWorkspace`, RBAC, placeholder). |
| `unknown` | Contexto insuficiente para confirmar nem refutar com segurança. | Pergunta objetiva / símbolo faltante para fechar a investigação. |

## 2. Checklist do Refuting Verifier (Antes de Confirmar)
1. **Controlabilidade da entrada:** o atacante controla mesmo o `source` ou vem de constante interna / config confiável?
2. **Sanitização / Parametrização:** há schema Zod estrito, `execFile` com `shell: false`, ou query parametrizada no meio do caminho?
3. **Fronteira de Confiança:** existe guarda explícita de sessão + `organizationId` + `OrgRole` antes da operação?
4. **Alcançabilidade (SCA/Trivy):** a função vulnerável da dependência é realmente importada e invocada pelo runtime ou fica apenas em `devDependencies` / caminho morto?

## 3. Regra de Degradação Transparente
- Se `semgrep`, `gitleaks`, `trivy` ou `nuclei` reportar `skipped_missing_binary`, inclua no topo do relatório:
  - Nome do scanner ausente;
  - Superfície que ficou descoberta (SAST, Segredos, SCA ou DAST);
  - Proibição de emitir selo "100% seguro".
