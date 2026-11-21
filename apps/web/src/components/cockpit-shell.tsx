"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClientListResponse, ProjectListResponse } from "@uzina/contracts";
import {
  Building2,
  Command,
  Factory,
  FolderGit2,
  Kanban,
  KeyRound,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";

interface CockpitActor {
  name: string;
  email: string;
  role: string;
}

async function fetchClients(): Promise<ClientListResponse> {
  const res = await fetch("/api/clients");
  if (!res.ok) throw new Error("Falha ao carregar clientes");
  return (await res.json()) as ClientListResponse;
}

async function fetchProjects(): Promise<ProjectListResponse> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Falha ao carregar projetos");
  return (await res.json()) as ProjectListResponse;
}

export function CockpitShell({
  actor,
  children,
}: {
  actor: CockpitActor;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const clientsList = clientsQuery.data?.items ?? [];
  const projectsList = projectsQuery.data?.items ?? [];

  async function handleSignOut() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  function renderSidebarContent(isDrawer: boolean) {
    return (
      <div className="flex h-full flex-col justify-between bg-surface">
        <div className="space-y-5 p-3">
          <div
            className={`flex items-center justify-between border-b border-border-subtle pb-3 ${
              isDrawer ? "pr-8" : ""
            }`}
          >
            <Link
              href="/app"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg-primary"
            >
              <Factory className="size-4 text-accent" strokeWidth={1.75} />
              <span>Uzina Studio</span>
            </Link>
            <span className="rounded border border-border-default bg-inset px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-muted">
              {actor.role}
            </span>
          </div>

        <nav aria-label="Navegação principal" className="space-y-1">
          <Link
            href="/app"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              pathname === "/app"
                ? "bg-accent-subtle text-accent"
                : "text-fg-secondary hover:bg-elevated hover:text-fg-primary"
            }`}
          >
            <Kanban className="size-4" strokeWidth={1.75} />
            <span>Torre de Controle</span>
          </Link>

          <Link
            href="/app/providers"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              pathname.startsWith("/app/providers")
                ? "bg-accent-subtle text-accent"
                : "text-fg-secondary hover:bg-elevated hover:text-fg-primary"
            }`}
          >
            <KeyRound className="size-4" strokeWidth={1.75} />
            <span>Provedores & Cofre</span>
          </Link>
        </nav>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Hierarquia (Clientes)
            </span>
            <span className="tabular-nums font-mono text-[11px] text-fg-muted">
              {clientsList.length}
            </span>
          </div>

          {clientsQuery.isLoading ? (
            <div className="space-y-1.5 px-2" aria-label="Carregando clientes">
              <div className="h-6 animate-pulse rounded bg-elevated" />
              <div className="h-6 animate-pulse rounded bg-elevated" />
            </div>
          ) : (
            <ul
              className="space-y-1"
              data-testid={
                isDrawer ? "sidebar-hierarchy-mobile" : "sidebar-hierarchy"
              }
            >
              {clientsList.map((client) => {
                const clientProjects = projectsList.filter(
                  (p) => p.clientId === client.id
                );
                return (
                  <li key={client.id} className="space-y-0.5">
                    <div className="flex items-center justify-between rounded px-2 py-1 text-xs font-medium text-fg-primary">
                      <span className="flex items-center gap-1.5 truncate">
                        <Building2
                          className="size-3.5 shrink-0 text-fg-muted"
                          strokeWidth={1.75}
                        />
                        <span className="truncate">{client.name}</span>
                      </span>
                      {client.isDefaultInternal && (
                        <span className="rounded border border-border-default bg-inset px-1.5 py-0.5 text-[10px] text-fg-secondary">
                          Padrão
                        </span>
                      )}
                    </div>
                    {clientProjects.length > 0 && (
                      <ul className="ml-4 space-y-0.5 border-l border-border-subtle pl-2">
                        {clientProjects.map((project) => (
                          <li
                            key={project.id}
                            className="flex items-center gap-1.5 truncate py-0.5 text-xs text-fg-secondary"
                          >
                            <FolderGit2
                              className="size-3 shrink-0 text-fg-muted"
                              strokeWidth={1.75}
                            />
                            <span className="truncate">{project.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-border-subtle p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-fg-primary">
              {actor.name}
            </p>
            <p className="truncate text-[11px] text-fg-muted">{actor.email}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sair da sessão"
            title="Sair"
            className="rounded-md border border-border-subtle p-1.5 text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
          >
            <LogOut className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-canvas text-fg-primary">
      {/* Sidebar Desktop 240px */}
      <aside className="hidden w-60 shrink-0 border-r border-border-subtle lg:block">
        {renderSidebarContent(false)}
      </aside>

      {/* Drawer Mobile/Tablet */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 border-r border-border-default bg-surface">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu lateral"
              className="absolute right-2.5 top-2.5 rounded p-1 text-fg-secondary hover:text-fg-primary"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Coluna Principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border-subtle bg-surface/95 px-4 backdrop-blur-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu lateral"
              className="rounded border border-border-default p-1.5 text-fg-secondary hover:text-fg-primary lg:hidden"
            >
              <Menu className="size-4" strokeWidth={1.75} />
            </button>
            <nav aria-label="Breadcrumb" className="text-xs text-fg-secondary">
              <span>Uzina Studio</span>
              <span className="mx-1.5 text-fg-muted">/</span>
              <span className="font-medium text-fg-primary">
                {pathname.includes("/studio")
                  ? "Estúdio Visual"
                  : pathname.startsWith("/app/providers")
                    ? "Provedores & Cofre"
                    : "Torre de Controle"}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="open-command-palette"
              aria-label="Abrir paleta de comandos"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <Command className="size-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Comandos</span>
              <kbd className="hidden rounded border border-border-subtle bg-surface px-1 font-mono text-[10px] text-fg-muted sm:inline">
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
