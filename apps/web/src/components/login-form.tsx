"use client";

import { AlertCircle, CheckCircle2, Factory, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ThemeToggle } from "./theme-toggle";

const AuthFormSchema = z.object({
  mode: z.enum(["signin", "signup"]),
  name: z.string().trim().optional(),
  email: z.email("Informe um e-mail válido."),
  password: z
    .string()
    .min(8, "A senha deve ter pelo menos 8 caracteres.")
    .max(128, "Senha excede o limite de 128 caracteres."),
});

export function LoginForm({ systemHealthy }: { systemHealthy: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = AuthFormSchema.safeParse({ mode, name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      return;
    }

    if (mode === "signup" && (!name.trim() || name.trim().length < 2)) {
      setError("Informe seu nome (mínimo 2 caracteres).");
      return;
    }

    setPending(true);
    try {
      const endpoint =
        mode === "signup"
          ? "/api/auth/sign-up/email"
          : "/api/auth/sign-in/email";
      const payload =
        mode === "signup"
          ? { name: name.trim(), email: email.trim(), password }
          : { email: email.trim(), password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        setError(
          body?.message ??
            body?.error ??
            (mode === "signin"
              ? "Credenciais inválidas. Verifique e-mail e senha."
              : "Não foi possível criar a conta.")
        );
        return;
      }

      router.push("/app");
      router.refresh();
    } catch {
      setError("Falha de conexão com o servidor de autenticação.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-between bg-canvas px-4 py-6">
      <header className="mx-auto flex w-full max-w-md items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg-primary">
          <Factory className="size-4 text-accent" strokeWidth={1.75} />
          <span>Uzina Studio</span>
        </div>
        <ThemeToggle />
      </header>

      <section className="mx-auto w-full max-w-md rounded-lg border border-border-default bg-surface p-6">
        <div className="mb-5 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            Acesso Operacional
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-fg-primary">
            {mode === "signin"
              ? "Entrar na Torre de Controle"
              : "Criar conta de Operador"}
          </h1>
          <p className="text-sm text-fg-secondary">
            Fábrica de Software orientada a especificações e evidências.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Modo de autenticação"
          className="mb-5 grid grid-cols-2 gap-1 rounded-md border border-border-subtle bg-inset p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            data-testid="tab-signin"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "signin"
                ? "bg-surface text-fg-primary border border-border-default"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            data-testid="tab-signup"
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "signup"
                ? "bg-surface text-fg-primary border border-border-default"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {mode === "signup" && (
            <div className="space-y-1.5">
              <label
                htmlFor="auth-name"
                className="block text-xs font-medium text-fg-secondary"
              >
                Nome completo
              </label>
              <input
                id="auth-name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Matheus Gama"
                aria-invalid={Boolean(error)}
                className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="auth-email"
              className="block text-xs font-medium text-fg-secondary"
            >
              E-mail
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operador@uzina.studio"
              aria-invalid={Boolean(error)}
              className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-password"
              className="block text-xs font-medium text-fg-secondary"
            >
              Senha (mínimo 8 caracteres)
            </label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              aria-invalid={Boolean(error)}
              className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent"
            />
          </div>

          {error && (
            <div
              role="alert"
              data-testid="auth-error"
              className="flex items-start gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            data-testid="auth-submit"
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />}
            <span>
              {mode === "signin" ? "Entrar no Cockpit" : "Criar Conta e Iniciar"}
            </span>
          </button>
        </form>
      </section>

      <footer className="mx-auto flex w-full max-w-md items-center justify-between text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          {systemHealthy ? (
            <>
              <CheckCircle2
                className="size-3.5 text-status-ok"
                strokeWidth={1.75}
              />
              <span>Sistema Operacional</span>
            </>
          ) : (
            <>
              <AlertCircle
                className="size-3.5 text-status-danger"
                strokeWidth={1.75}
              />
              <span>Serviço Indisponível</span>
            </>
          )}
        </span>
        <span className="font-mono text-[11px]">Mastra Core Apache 2.0</span>
      </footer>
    </main>
  );
}
