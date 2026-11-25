# Template: Matriz BDD, Eventos de Domínio & RBAC / LGPD

## 1. Fluxo de Eventos de Domínio
| Ator / Origem | Comando | Evento de Domínio | Política / Invariante Obrigatória |
| :--- | :--- | :--- | :--- |
| `<Papel>` | `<Ação solicitada>` | `<EventoNoPassado>` | `<Condição obrigatória para ocorrer>` |

## 2. Matriz RBAC & Sensibilidade de Dados (LGPD / PII)
| Recurso / Campo | Classificação | `owner` | `admin` | `developer` | `auditor` | Regra de Mascaramento / Retenção |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `<Dado 1>` | `PII` / `Secret` / `Internal` / `Public` | `R/W` | `R/W` | `R` | `R` (mascarado) | `<Ex.: nunca retornar chave em texto claro>` |

## 3. Cenários BDD (`Dado / Quando / Então`)
### BDD-01: `<Cenário positivo principal>` (`roleRequired: <papel>`)
- **Dado** `<contexto autenticado, organização e estado inicial>`
- **Quando** `<comando executado com dados válidos>`
- **Então** `<evento ocorre, estado atualiza e saída esperada é retornada>`

### BDD-02: `<Cenário negativo — autorização / invariante>` (`roleRequired: auditor`)
- **Dado** `<usuário autenticado sem privilégio de escrita ou em outra organização>`
- **Quando** `<tenta executar comando restrito>`
- **Então** `<operação é rejeitada com 403/404 sem efeito colateral>`
