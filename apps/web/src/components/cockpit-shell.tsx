"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AgencyOverviewResponse,
  ClientListResponse,
  DecisionListResponse,
  ProjectListResponse,
} from "@uzina/contracts";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  Code2,
  Coins,
  Command,
  Factory,
  KeyRound,
  Layers,
  Lightbulb,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

async function fetchShellStatus(
  projectId: string
): Promise<AgencyOverviewResponse | null> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`/api/agency/status${qs}`);
  if (!res.ok) return null;
  return (await res.json()) as AgencyOverviewResponse;
}

async function fetchPendingDecisionsCount(): Promise<number> {
  const res = await fetch("/api/decisions?status=pending");
  if (!res.ok) return 0;
  const data = (await res.json()) as DecisionListResponse;
  return data.items?.length ?? 0;
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [factoryOpenOverride, setFactoryOpenOverride] = useState<
    Record<string, boolean>
  >({});

  const switcherRef = useRef<HTMLDivElement | null>(null);

  const isFactoryRoute =
    pathname.startsWith("/app/ideas") ||
    pathname.startsWith("/app/memories") ||
    pathname.startsWith("/app/finops") ||
    pathname.startsWith("/app/providers");

  const factoryGroupKey = isFactoryRoute ? "factory" : "journey";
  const factoryExpanded = factoryOpenOverride[factoryGroupKey] ?? isFactoryRoute;

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const clientsList = useMemo(
    () => clientsQuery.data?.items ?? [],
    [clientsQuery.data]
  );
  const projectsList = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data]
  );
  const currentProject =
    projectsList.find((p) => p.id === activeProjectId) ??
    projectsList[0] ??
    null;

  const currentClient = currentProject
    ? clientsList.find((c) => c.id === currentProject.clientId) ?? null
    : null;

  const shellStatusQuery = useQuery({
    queryKey: ["agency-status", "shell", currentProject?.id ?? ""],
    queryFn: () => fetchShellStatus(currentProject?.id ?? ""),
  });

  const pendingDecisionsQuery = useQuery({
    queryKey: ["decisions", "pending-count"],
    queryFn: fetchPendingDecisionsCount,
  });

  const projectState = shellStatusQuery.data?.activeProjectState ?? null;
  const pendingDecisionsCount = pendingDecisionsQuery.data ?? 0;

  useEffect(() => {
    if (!switcherOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSwitcherOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(e.target as Node)
      ) {
        setSwitcherOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [switcherOpen]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projectsList;
    return projectsList.filter((p) => {
      const cli = clientsList.find((c) => c.id === p.clientId);
      return (
        p.name.toLowerCase().includes(q) ||
        (cli?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [projectsList, clientsList, projectSearch]);

  async function handleSignOut() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  function navItemCls(active: boolean): string {
    return `flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
      active
        ? "border border-border-subtle bg-elevated font-medium text-fg-primary"
        : "border border-transparent text-fg-secondary hover:bg-elevated/60 hover:text-fg-primary"
    }`;
  }

  function renderProjectSwitcher(isDrawer: boolean) {
    return (
      <div
        ref={isDrawer ? undefined : switcherRef}
        className="relative"
      >
        <button
          type="button"
          data-testid={
            isDrawer
              ? "sidebar-project-switcher-mobile"
              : "sidebar-project-switcher"
          }
          aria-expanded={switcherOpen}
          aria-haspopup="listbox"
          onClick={() => setSwitcherOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${
                  currentProject ? "bg-status-ok" : "bg-fg-muted"
                }`}
              />
              <span className="truncate text-sm font-semibold text-fg-primary">
                {projectsQuery.isLoading
                  ? "Carregando..."
                  : currentProject?.name ?? "Sem projeto ativo"}
              </span>
            </div>
            <p className="mt-0.5 truncate pl-4 text-xs text-fg-muted">
              {currentProject
                ? `${currentClient?.name ?? "Internos"}${
                    projectState ? ` · Ciclo #${projectState.cycleNumber}` : ""
                  }`
                : "Crie sua primeira ideia"}
            </p>
          </div>
          <ChevronsUpDown
            className="size-4 shrink-0 text-fg-muted"
            strokeWidth={1.75}
          />
        </button>

        {switcherOpen && (
          <div
            role="listbox"
            aria-label="Selecionar projeto ativo"
            data-testid="sidebar-project-switcher-menu"
            className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-lg border border-border-default bg-elevated p-1.5 shadow-xl"
          >
            {projectsList.length > 4 && (
              <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-border-subtle bg-inset px-2.5 py-1.5">
                <Search className="size-3.5 text-fg-muted" />
                <input
                  type="text"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  placeholder="Buscar projeto..."
                  className="w-full bg-transparent text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none"
                />
              </div>
            )}

            <div className="max-h-60 space-y-1 overflow-y-auto">
              {filteredProjects.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-xs text-fg-muted">
                  Nenhum projeto encontrado.
                </p>
              ) : (
                clientsList.map((client) => {
                  const clientProjects = filteredProjects.filter(
                    (p) => p.clientId === client.id
                  );
                  if (clientProjects.length === 0) return null;
                  return (
                    <div key={client.id} className="space-y-0.5">
                      <p className="px-2 pt-1 text-xs font-medium text-fg-muted">
                        {client.name}
                      </p>
                      {clientProjects.map((project) => {
                        const isSelected = currentProject?.id === project.id;
                        return (
                          <button
                            key={project.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-testid={`switcher-project-${project.id}`}
                            onClick={() => {
                              setActiveContext({
                                clientId: client.id,
                                projectId: project.id,
                              });
                              setSwitcherOpen(false);
                              setMobileMenuOpen(false);
                              setProjectSearch("");
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                              isSelected
                                ? "bg-surface font-medium text-fg-primary"
                                : "text-fg-secondary hover:bg-surface/70 hover:text-fg-primary"
                            }`}
                          >
                            <span className="truncate">{project.name}</span>
                            {isSelected && (
                              <Check className="size-3.5 shrink-0 text-accent" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-1.5 border-t border-border-subtle pt-1.5">
              <Link
                href="/app/ideas"
                onClick={() => {
                  setSwitcherOpen(false);
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:bg-surface"
              >
                <Plus className="size-3.5 text-accent" />
                <span>Nova Ideia / Projeto</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSidebarContent(isDrawer: boolean) {
    const visualApproved = Boolean(projectState?.visualFlow?.approvedForCodeHandoff);
    const slicesCount = projectState?.sliceArtifacts.length ?? 0;

    return (
      <div className="flex h-full flex-col justify-between bg-sidebar">
        <div className="space-y-4 overflow-y-auto p-3.5">
          {/* Identidade + Papel */}
          <div
            className={`flex items-center justify-between pb-1 ${
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
            <span className="rounded border border-border-subtle bg-inset px-1.5 py-0.5 font-mono text-xs uppercase text-fg-muted">
              {actor.role}
            </span>
          </div>

          {/* Seletor de Projeto Ativo no Topo */}
          {renderProjectSwitcher(isDrawer)}

          {/* Grupo 1: Jornada do Projeto Ativo */}
          <nav aria-label="Navegação principal" className="space-y-5 pt-1">
            <div className="space-y-1">
              <p className="px-2.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Projeto Ativo
              </p>

              <Link
                href="/app"
                data-testid="nav-chat"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname === "/app")}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <MessageSquare className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Chat da Engenharia</span>
                </span>
                {projectState && (
                  <span className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">
                    C#{projectState.cycleNumber}
                  </span>
                )}
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
                <span className="flex min-w-0 items-center gap-2.5">
                  <Palette className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Estúdio Visual</span>
                </span>
                {projectState && (
                  <span
                    title={
                      visualApproved
                        ? "Fluxo visual aprovado"
                        : "Aguardando aprovação visual"
                    }
                    className={`shrink-0 text-xs ${
                      visualApproved ? "text-status-ok" : "text-fg-muted"
                    }`}
                  >
                    {visualApproved ? "✓" : "○"}
                  </span>
                )}
              </Link>

              <Link
                href="/app/deliverables"
                data-testid="nav-deliverables"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/deliverables"))}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Layers className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Entregas &amp; Docs</span>
                </span>
                {slicesCount > 0 && (
                  <span className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">
                    {slicesCount}
                  </span>
                )}
              </Link>

              <Link
                href="/app/decisions"
                data-testid="nav-decisions"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/decisions"))}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ClipboardCheck
                    className="size-4 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="truncate">Decisões (HITL)</span>
                </span>
                {pendingDecisionsCount > 0 && (
                  <span className="shrink-0 rounded-full bg-accent-subtle px-1.5 py-0.5 font-mono text-xs font-medium text-accent tabular-nums">
                    {pendingDecisionsCount}
                  </span>
                )}
              </Link>

              <Link
                href="/app/security"
                data-testid="nav-security"
                onClick={() => setMobileMenuOpen(false)}
                className={navItemCls(pathname.startsWith("/app/security"))}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">AppSec &amp; Código</span>
                </span>
              </Link>

              {currentProject && (
                <Link
                  href={`/app/projects/${encodeURIComponent(currentProject.id)}/code`}
                  data-testid="nav-codebase"
                  onClick={() => setMobileMenuOpen(false)}
                  className={navItemCls(pathname.includes("/code"))}
                >
                  <span className="flex min-w-0 items-center gap-2.5 pl-1">
                    <Code2 className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />
                    <span className="truncate text-xs">Mapa do Código AST</span>
                  </span>
                </Link>
              )}
            </div>

            {/* Grupo 2: Fábrica & Sistema (Recolhível) */}
            <div className="space-y-1 border-t border-border-subtle pt-3">
              <button
                type="button"
                data-testid="toggle-factory-nav-group"
                aria-expanded={factoryExpanded}
                onClick={() =>
                  setFactoryOpenOverride((prev) => ({
                    ...prev,
                    [factoryGroupKey]: !factoryExpanded,
                  }))
                }
                className="flex w-full items-center justify-between rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:text-fg-primary"
              >
                <span>Fábrica &amp; Sistema</span>
                {factoryExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>

              {factoryExpanded && (
                <div className="space-y-1 pt-1">
                  <Link
                    href="/app/ideas"
                    data-testid="nav-ideas"
                    onClick={() => setMobileMenuOpen(false)}
                    className={navItemCls(pathname.startsWith("/app/ideas"))}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Lightbulb className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">Ideias &amp; Portfólio</span>
                    </span>
                  </Link>

                  <Link
                    href="/app/memories"
                    data-testid="nav-memories"
                    onClick={() => setMobileMenuOpen(false)}
                    className={navItemCls(pathname.startsWith("/app/memories"))}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Brain className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">Memórias (QMD)</span>
                    </span>
                  </Link>

                  <Link
                    href="/app/finops"
                    data-testid="nav-finops"
                    onClick={() => setMobileMenuOpen(false)}
                    className={navItemCls(pathname.startsWith("/app/finops"))}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Coins className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">FinOps &amp; Motores</span>
                    </span>
                  </Link>

                  <Link
                    href="/app/providers"
                    data-testid="nav-providers"
                    onClick={() => setMobileMenuOpen(false)}
                    className={navItemCls(pathname.startsWith("/app/providers"))}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <KeyRound className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">Provedores &amp; LLM</span>
                    </span>
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Rodapé do Operador */}
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
              className="rounded-md border border-border-subtle bg-surface p-2 text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <LogOut className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const breadcrumbLabel = pathname.startsWith("/app/ideas")
    ? "Ideias & Portfólio"
    : pathname.startsWith("/app/studio") || pathname.includes("/studio")
      ? "Estúdio Visual"
      : pathname.startsWith("/app/deliverables")
        ? "Entregas & Docs"
        : pathname.includes("/code")
          ? "Mapa do Código (AST)"
          : pathname.startsWith("/app/finops")
            ? "FinOps & Motores"
            : pathname.startsWith("/app/decisions")
              ? "Caixa de Decisões"
              : pathname.startsWith("/app/security")
                ? "Auditoria AppSec"
                : pathname.startsWith("/app/memories")
                  ? "Memórias (QMD)"
                  : pathname.startsWith("/app/providers")
                    ? "Provedores & LLM"
                    : "Chat da Engenharia";

  return (
    <div className="flex min-h-screen bg-canvas text-fg-primary">
      {/* Sidebar Desktop recolhível (248px <-> 0px) */}
      {!sidebarCollapsed && (
        <aside className="hidden w-62 shrink-0 border-r border-border-subtle lg:block">
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
          <aside className="relative z-10 w-64 border-r border-border-default bg-sidebar">
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
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b border-border-subtle bg-sidebar/95 px-3 backdrop-blur-xs sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu lateral"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface text-fg-secondary hover:text-fg-primary lg:hidden"
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
              className="hidden size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary lg:inline-flex"
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
              <span className="hidden text-fg-muted sm:inline">
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
              title="Co-piloto Executivo (Resumo Read-Only)"
              className="inline-flex size-8 items-center justify-center rounded-md border border-border-default bg-surface text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <Bot className="size-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="open-command-palette"
              aria-label="Abrir paleta de comandos"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-surface px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <Command className="size-3.5" strokeWidth={1.75} />
              <kbd className="hidden font-mono text-xs text-fg-muted md:inline">
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-3 sm:px-6 sm:py-5">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenCopilot={() => setCopilotOpen(true)}
      />
      <CopilotDrawer open={copilotOpen} onOpenChange={setCopilotOpen} />
    </div>
  );
}
