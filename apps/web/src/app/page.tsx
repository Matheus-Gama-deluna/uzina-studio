import { getPublicHealth } from "@/lib/health-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const health = await getPublicHealth();
  const isOk = health.status === "ok";

  return (
    <main className="uz-container">
      <header className="uz-header">
        <div className="uz-brand">
          <span className="uz-kicker">Fase 1 MVP · Slice 0</span>
          <h1 className="uz-title">Uzina Studio</h1>
          <p className="uz-subtitle">
            Walking Skeleton — Painel Operacional e Verificação de Saúde
          </p>
        </div>

        <div
          className={`uz-badge ${isOk ? "uz-badge--ok" : "uz-badge--error"}`}
          role="status"
          aria-live="polite"
          data-testid="health-badge"
        >
          <span>{isOk ? "Sistema Operacional" : "Sistema Indisponível"}</span>
          <span>({health.status.toUpperCase()})</span>
        </div>
      </header>

      <section className="uz-grid" aria-label="Subsistemas do Walking Skeleton">
        <article className="uz-card">
          <span className="uz-card-label">Serviço</span>
          <span className="uz-card-value">{health.service}</span>
        </article>

        <article className="uz-card">
          <span className="uz-card-label">Endpoint Público</span>
          <span className="uz-card-value">
            <code className="uz-code">GET /api/health</code>
          </span>
        </article>

        <article className="uz-card">
          <span className="uz-card-label">Autenticação</span>
          <span className="uz-card-value">
            <code className="uz-code">/api/auth/*</code> (Better Auth)
          </span>
        </article>

        <article className="uz-card">
          <span className="uz-card-label">Última Verificação (UTC)</span>
          <span className="uz-card-value">{health.timestamp}</span>
        </article>
      </section>

      <footer className="uz-footer">
        <span>
          Diagnóstico detalhado disponível para operadores autenticados em{" "}
          <code className="uz-code">/api/health/details</code>.
        </span>
        <span>Mastra Core Apache 2.0 · Sem módulos ee/</span>
      </footer>
    </main>
  );
}
