# Rubrica: Scorecard de Maturidade Brownfield (0–100)

Cada uma das 5 dimensões recebe nota objetiva de **0 a 20 pontos** com base em evidências observadas diretamente no repositório.

## Dimensão 1 — Pipeline de Verificação e CI (0–20 pts)
- **0–5:** Sem CI ou scripts de build/typecheck quebrados localmente.
- **6–12:** Build e lint existem, mas não rodam de forma determinística ou exigem passos manuais não documentados.
- **13–20:** Pipeline único (`verify` / CI) executando typecheck, lint, testes e build com travamento de lockfile.

## Dimensão 2 — Rede de Segurança de Testes (0–20 pts)
- **0–5:** Sem testes ou apenas testes desativados/mocks que não validam comportamento real.
- **6–12:** Cobertura parcial apenas em utilitários; fluxos críticos de negócio e bordas HTTP descobertos.
- **13–20:** Testes de integração/contrato ativos sobre regras críticas, bordas de erro e isolamento de dados.

## Dimensão 3 — Documentação Viva e Contratos (0–20 pts)
- **0–5:** Ausência de steering, contratos de API ou esquemas validados na entrada.
- **6–12:** Documentação parcial desatualizada ou tipagem sem validação em runtime.
- **13–20:** Contratos validados em runtime (ex.: Zod/OpenAPI) e documentos de arquitetura coerentes com o código.

## Dimensão 4 — Postura de Segurança e Isolamento (0–20 pts)
- **0–5:** Segredos hardcoded, rotas sem verificação de autenticação/tenant ou ausência de sanitização.
- **6–12:** Autenticação presente, mas com validação inconsistente de papéis (RBAC) ou SAST ausente.
- **13–20:** Validação de sessão/RBAC/tenant no servidor, segredos isolados e pipeline AppSec ativo.

## Dimensão 5 — Modularidade e Seams (0–20 pts)
- **0–5:** Arquivos monolíticos altamente acoplados, lógica de negócio misturada à UI e estado global mutável.
- **6–12:** Separação por pastas existe, mas com dependências circulares ou vazamento entre camadas.
- **13–20:** Fronteiras claras entre domínio, persistência e apresentação, permitindo evolução por fatias.

## Regra de Decisão Arquitetural
- **0–59 pontos:** Obrigatório adotar `characterization_strangler` + criar testes de caracterização antes de refatorar.
- **60–79 pontos:** Evolução incremental com `openspec-brownfield-delta` e proteção rigorosa de contratos.
- **80–100 pontos:** Evolução direta via Vertical Slices mantendo as *Fitness Functions* existentes.
