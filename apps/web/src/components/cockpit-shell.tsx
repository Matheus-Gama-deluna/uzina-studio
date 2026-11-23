"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClientListResponse, ProjectListResponse } from "@uzina/contracts";
import {
  Bot,
  Brain,
  Building2,
  ClipboardCheck,
  Coins,
  Command,
  Factory,
  FolderGit2,
  KeyRound,
  Layers,
  Lightbulb,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  setActiveContext,
  useActiveProjectId,
} from "@/lib/active-project-store";
import { CommandPalette } from "./command-palette";
import { CopilotDrawer } from "./copilot-drawer";
import { FontScaleToggle } from "./font-scale-toggle";
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
  const activeProjectId = useActiveProjectId();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

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
  const currentProject =
    projectsList.find((p) => p.id === activeProjectId) ??
    projectsList[0] ??
    null;

  async function handleSignOut() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  function navItemCls(active: boolean): string {
    return `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
      active
        ? "border border-border-subtle bg-elevated font-medium text-fg-primary"
        : "border border-transparent text-fg-secondary hover:bg-elevated/60 hover:text-fg-primary"
    }`;
  }

  function renderSidebarContent(isDrawer: boolean) {
    return (
      <div className="flex h-full flex-col justify-between bg-surface">
        <div className="space-y-5 overflow-y-auto p-3.5">
          <div
            className={`flex items-center justify-between border-b border-border-subtle pb-3 ${
              isDrawer ? "pr-8" : ""
            }`}
          >
            <Link
              href="/app"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg-primary"
            >
              <Factory className="size-4 text-fg-primary" strokeWidth={1.75} />
              <span>Uzina Studio</span>
            </Link>
            <span className="rounded border border-border-default bg-inset px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-muted">
              {actor.role}
            </span>
          </div>

          <nav aria-label="Navegação principal" className="space-y-5">
            <div className="space-y-1">
              <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Criação &amp; Produto
              </p>

              <Link
                href="/app/ideas"
                data-testid="nav-ideas"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/ideas"))}
              >
                <Lightbulb className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Ideias &amp; Projetos</span>
              </Link>

              <Link
                href="/app"
                data-testid="nav-chat"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname === "/app")}
              >
                <MessageSquare className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Chat da Engenharia</span>
              </Link>

              <Link
                href="/app/studio"
                data-testid="nav-studio"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(
                  pathname.startsWith("/app/studio") ||
                    pathname.includes("/studio")
                )}
              >
                <Palette className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Estúdio Visual</span>
              </Link>

              <Link
                href="/app/deliverables"
                data-testid="nav-deliverables"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/deliverables"))}
              >
                <Layers className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Entregas &amp; Docs</span>
              </Link>
            </div>

            <div className="space-y-1">
              <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Operação &amp; Sistema
              </p>

              <Link
                href="/app/decisions"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/decisions"))}
              >
                <ClipboardCheck className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Caixa de Decisões</span>
              </Link>

              <Link
                href="/app/security"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/security"))}
              >
                <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Auditoria AppSec</span>
              </Link>

              <Link
                href="/app/memories"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/memories"))}
              >
                <Brain className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Memórias</span>
              </Link>

              <Link
                href="/app/finops"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/finops"))}
              >
                <Coins className="size-4 shrink-0" strokeWidth={1.75} />
                <span>FinOps &amp; Tokens</span>
              </Link>

              <Link
                href="/app/providers"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/providers"))}
              >
                <KeyRound className="size-4 shrink-0" strokeWidth={1.75} />
                <span>Provedores &amp; LLM</span>
              </Link>
            </div>
          </nav>

          <div className="space-y-2 border-t border-border-subtle pt-3">
            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Projetos ({projectsList.length})
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
                      <button
                        type="button"
                        data-testid={`sidebar-client-${client.id}`}
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setActiveContext({ clientId: client.id });
                          if (pathname !== "/app") {
                            router.push(
                              `/app?clientId=${encodeURIComponent(client.id)}`
                            );
                          }
                        }}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs font-medium text-fg-secondary transition-colors hover:bg-elevated hover:text-fg-primary"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Building2
                            className="size-3.5 shrink-0 text-fg-muted"
                            strokeWidth={1.75}
                          />
                          <span className="truncate">{client.name}</span>
                        </span>
                        {client.isDefaultInternal && (
                          <span className="rounded border border-border-subtle bg-inset px-1.5 py-0.5 text-[11px] text-fg-muted">
                            Padrão
                          </span>
                        )}
                      </button>
                      {clientProjects.length > 0 && (
                        <ul className="ml-3.5 space-y-0.5 border-l border-border-subtle pl-2">
                          {clientProjects.map((project) => {
                            const isActiveProj =
                              currentProject?.id === project.id;
                            return (
                              <li key={project.id}>
                                <button
                                  type="button"
                                  data-testid={`sidebar-project-${project.id}`}
                                  onClick={() => {
                                    setMobileMenuOpen(false);
                                    setActiveContext({
                                      clientId: client.id,
                                      projectId: project.id,
                                    });
                                    if (
                                      pathname !== "/app" &&
                                      pathname !== "/app/studio" &&
                                      pathname !== "/app/deliverables"
                                    ) {
                                      router.push(
                                        `/app?clientId=${encodeURIComponent(
                                          client.id
                                        )}&projectId=${encodeURIComponent(
                                          project.id
                                        )}`
                                      );
                                    }
                                  }}
                                  className={`flex w-full items-center gap-1.5 truncate rounded px-2 py-1.5 text-left text-xs transition-colors ${
                                    isActiveProj
                                      ? "bg-elevated font-medium text-fg-primary"
                                      : "text-fg-secondary hover:bg-elevated/60 hover:text-fg-primary"
                                  }`}
                                >
                                  <FolderGit2
                                    className="size-3.5 shrink-0 text-fg-muted"
                                    strokeWidth={1.75}
                                  />
                                  <span className="truncate">
                                    {project.name}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t border-border-subtle p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-fg-primary">
                {actor.name}
              </p>
              <p className="truncate text-xs text-fg-muted">{actor.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sair da sessão"
              title="Sair"
              className="rounded-md border border-border-subtle p-2 text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <LogOut className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const breadcrumbLabel = pathname.startsWith("/app/ideas")
    ? "Ideias & Projetos"
    : pathname.startsWith("/app/studio") || pathname.includes("/studio")
      ? "Estúdio Visual"
      : pathname.startsWith("/app/deliverables")
        ? "Entregas & Docs"
        : pathname.includes("/code")
          ? "Mapa do Código (AST)"
          : pathname.startsWith("/app/finops")
            ? "FinOps & Tokens"
            : pathname.startsWith("/app/decisions")
              ? "Caixa de Decisões"
              : pathname.startsWith("/app/security")
                ? "Auditoria AppSec"
                : pathname.startsWith("/app/memories")
                  ? "Memórias"
                  : pathname.startsWith("/app/providers")
                    ? "Provedores & LLM"
                    : "Chat da Engenharia";

  return (
    <div className="flex min-h-screen bg-canvas text-fg-primary">
      {/* Sidebar Desktop recolhível (240px <-> 0px) */}
      {!sidebarCollapsed && (
        <aside className="hidden w-60 shrink-0 border-r border-border-subtle lg:block">
          {renderSidebarContent(false)}
        </aside>
      )}

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
              className="absolute right-2.5 top-2.5 rounded p-1.5 text-fg-secondary hover:text-fg-primary"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Coluna Principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b border-border-subtle bg-surface/95 px-3 backdrop-blur-xs sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu lateral"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border-default text-fg-secondary hover:text-fg-primary lg:hidden"
            >
              <Menu className="size-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              data-testid="toggle-desktop-sidebar"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={
                sidebarCollapsed
                  ? "Mostrar barra lateral"
                  : "Recolher barra lateral"
              }
              title={
                sidebarCollapsed
                  ? "Mostrar barra lateral"
                  : "Recolher barra lateral"
              }
              className="hidden size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-inset text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary lg:inline-flex"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="size-4" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose className="size-4" strokeWidth={1.75} />
              )}
            </button>
            <nav
              aria-label="Breadcrumb"
              className="truncate whitespace-nowrap text-xs text-fg-secondary sm:text-sm"
            >
              <span className="hidden sm:inline text-fg-muted">
                Uzina Studio
              </span>
              <span className="mx-1.5 hidden text-fg-muted sm:inline">/</span>
              <span className="font-medium text-fg-primary">
                {breadcrumbLabel}
              </span>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <FontScaleToggle />
            <button
              type="button"
              onClick={() => setCopilotOpen(true)}
              data-testid="open-copilot-drawer"
              aria-label="Abrir Co-piloto Executivo"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-inset px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <Bot className="size-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Co-piloto</span>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="open-command-palette"
              aria-label="Abrir paleta de comandos"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <Command className="size-3.5" strokeWidth={1.75} />
              <span className="hidden md:inline">Comandos</span>
              <kbd className="hidden rounded border border-border-subtle bg-surface px-1 font-mono text-[11px] text-fg-muted md:inline">
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-3 sm:px-6 sm:py-5">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <CopilotDrawer open={copilotOpen} onOpenChange={setCopilotOpen} />
    </div>
  );
}
