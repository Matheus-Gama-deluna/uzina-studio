"use client";

import { useQuery } from "@tanstack/react-query";
import {
  EntropyAuditReportSchema,
  ProjectListResponseSchema,
  SkillsLockManifestSchema,
  type EntropyAuditReport,
} from "@uzina/contracts";
import {
  AlertCircle,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  FileWarning,
  FolderGit2,
  Lock,
  PackageX,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

export const SkillsCatalogItemSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    version: z.string().nullable(),
    license: z.string().nullable(),
    phase: z.string().nullable(),
    roleCategory: z.string().min(1),
    appliesToRoles: z.array(z.string().min(1)),
    resourcesCount: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    verified: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();
export type SkillsCatalogItem = z.infer<typeof SkillsCatalogItemSchema>;

export const SkillsCatalogResponseSchema = z
  .object({
    skills: z.array(SkillsCatalogItemSchema),
    lockManifest: SkillsLockManifestSchema,
    lockValid: z.boolean(),
    lockIssues: z.array(z.string()),
  })
  .strict();
export type SkillsCatalogResponse = z.infer<typeof SkillsCatalogResponseSchema>;

export interface SkillsCatalogPanelProps {
  initialCatalog?: SkillsCatalogResponse | null;
  initialEntropy?: EntropyAuditReport | null;
  defaultProjectId?: string;
}

export function filterSkillsCatalogItems(
  skills: readonly SkillsCatalogItem[],
  filters: {
    searchQuery: string;
    phaseFilter: string;
    roleCategoryFilter: string;
  }
): SkillsCatalogItem[] {
  const q = filters.searchQuery.trim().toLowerCase();
  return skills.filter((skill) => {
    if (
      filters.phaseFilter !== "all" &&
      (skill.phase ?? "geral") !== filters.phaseFilter
    ) {
      return false;
    }
    if (
      filters.roleCategoryFilter !== "all" &&
      skill.roleCategory !== filters.roleCategoryFilter
    ) {
      return false;
    }
    if (!q) return true;
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.appliesToRoles.some((r) => r.toLowerCase().includes(q))
    );
  });
}

export function SkillsCatalogPanel({
  initialCatalog,
  initialEntropy,
  defaultProjectId,
}: SkillsCatalogPanelProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    defaultProjectId ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [roleCategoryFilter, setRoleCategoryFilter] = useState<string>("all");
  const [expandedSkillName, setExpandedSkillName] = useState<string | null>(
    null
  );

  const catalogQuery = useQuery({
    queryKey: ["skills-catalog"],
    queryFn: async () => {
      const res = await fetch("/api/skills/catalog");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao carregar catálogo de skills.");
      }
      return SkillsCatalogResponseSchema.parse(await res.json());
    },
    ...(initialCatalog ? { initialData: initialCatalog } : {}),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects-for-entropy"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        throw new Error("Falha ao listar projetos para auditoria de entropia.");
      }
      return ProjectListResponseSchema.parse(await res.json());
    },
  });

  const projectsList = projectsQuery.data?.items ?? [];
  const effectiveProjectId = selectedProjectId || projectsList[0]?.id || "";

  const entropyQuery = useQuery({
    queryKey: ["project-entropy", effectiveProjectId],
    enabled: Boolean(effectiveProjectId),
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(effectiveProjectId)}/entropy`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? "Falha ao executar auditoria de entropia."
        );
      }
      return EntropyAuditReportSchema.parse(await res.json());
    },
    ...(initialEntropy ? { initialData: initialEntropy } : {}),
  });

  const catalog = catalogQuery.data;
  const entropy = entropyQuery.data;

  const availablePhases = useMemo(() => {
    const phases = new Set<string>();
    for (const s of catalog?.skills ?? []) {
      if (s.phase) phases.add(s.phase);
    }
    return Array.from(phases).sort();
  }, [catalog?.skills]);

  const filteredSkills = useMemo(
    () =>
      filterSkillsCatalogItems(catalog?.skills ?? [], {
        searchQuery,
        phaseFilter,
        roleCategoryFilter,
      }),
    [catalog?.skills, searchQuery, phaseFilter, roleCategoryFilter]
  );

  return (
    <div
      data-testid="skills-catalog-panel"
      className="grid min-w-0 gap-4 lg:grid-cols-2"
    >
      {/* Bloco 1: Catálogo & Integridade skills-lock.json */}
      <section
        aria-label="Catálogo de Skills e Integridade"
        className="uzina-card min-w-0 space-y-4 rounded-xl border border-border-subtle bg-surface p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <Lock className="size-4 text-fg-secondary" strokeWidth={1.75} />
              <span>skills-lock.json · SHA-256 &amp; Licenças</span>
            </div>
            <h2 className="text-sm font-semibold text-fg-primary">
              Catálogo de Skills Nativas
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {catalog && (
              <span
                data-testid="skills-lock-status"
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${
                  catalog.lockValid
                    ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                    : "border-status-danger/40 bg-status-danger/10 text-status-danger"
                }`}
              >
                {catalog.lockValid ? (
                  <ShieldCheck className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <ShieldAlert className="size-3.5" strokeWidth={1.75} />
                )}
                <span>
                  {catalog.lockValid ? "Lock Íntegro" : "Divergência de Lock"}
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={() => void catalogQuery.refetch()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default bg-inset px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {catalogQuery.isLoading ? (
          <div
            data-testid="skills-catalog-loading"
            className="space-y-2"
            aria-label="Carregando catálogo de skills"
          >
            <div className="h-14 animate-pulse rounded-lg border border-border-subtle bg-inset" />
            <div className="h-14 animate-pulse rounded-lg border border-border-subtle bg-inset" />
            <div className="h-14 animate-pulse rounded-lg border border-border-subtle bg-inset" />
          </div>
        ) : catalogQuery.isError ? (
          <div
            data-testid="skills-catalog-error"
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 p-3.5 text-xs text-status-danger"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
              <span>
                {catalogQuery.error instanceof Error
                  ? catalogQuery.error.message
                  : "Erro ao carregar catálogo de skills."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void catalogQuery.refetch()}
              className="min-h-8 rounded border border-status-danger/40 px-2.5 text-xs font-medium hover:bg-status-danger/15"
            >
              Tentar novamente
            </button>
          </div>
        ) : !catalog || catalog.skills.length === 0 ? (
          <div
            data-testid="skills-catalog-empty"
            className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-8 text-center text-xs text-fg-secondary"
          >
            Nenhuma skill nativa encontrada em packages/skills.
          </div>
        ) : (
          <div className="space-y-2.5">
            {catalog.lockIssues.length > 0 && (
              <div className="rounded-lg border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
                <p className="font-medium">Alertas de Integridade:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {catalog.lockIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-12">
              <div className="relative sm:col-span-6">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted"
                  strokeWidth={1.75}
                />
                <input
                  type="search"
                  data-testid="skills-search-input"
                  aria-label="Buscar skill por nome ou descrição"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar skills (ex.: stride, msw, debug)..."
                  className="h-8 w-full rounded-md border border-border-default bg-inset pl-8 pr-2.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
                />
              </div>
              <select
                data-testid="skills-phase-filter"
                aria-label="Filtrar skills por fase"
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
                className="h-8 rounded-md border border-border-default bg-inset px-2 py-1 text-xs leading-normal text-fg-primary focus:border-border-strong focus:outline-none sm:col-span-3"
              >
                <option value="all">Todas as fases</option>
                {availablePhases.map((phase) => (
                  <option key={phase} value={phase}>
                    Fase: {phase}
                  </option>
                ))}
              </select>
              <select
                data-testid="skills-role-category-filter"
                aria-label="Filtrar skills por categoria"
                value={roleCategoryFilter}
                onChange={(e) => setRoleCategoryFilter(e.target.value)}
                className="h-8 rounded-md border border-border-default bg-inset px-2 py-1 text-xs leading-normal text-fg-primary focus:border-border-strong focus:outline-none sm:col-span-3"
              >
                <option value="all">Todas categorias</option>
                <option value="lead">lead</option>
                <option value="reference">reference</option>
                <option value="critique">critique</option>
              </select>
            </div>

            <div className="flex items-center justify-between text-xs text-fg-muted tabular-nums">
              <span data-testid="skills-filtered-count">
                Exibindo {filteredSkills.length} de {catalog.skills.length} skill(s)
              </span>
              {(searchQuery || phaseFilter !== "all" || roleCategoryFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setPhaseFilter("all");
                    setRoleCategoryFilter("all");
                  }}
                  className="text-xs underline hover:text-fg-primary"
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {filteredSkills.length === 0 ? (
              <p
                data-testid="skills-filter-empty"
                className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-6 text-center text-xs text-fg-secondary"
              >
                Nenhuma skill corresponde aos filtros aplicados.
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {filteredSkills.map((skill) => {
                  const isExpanded = expandedSkillName === skill.name;
                  return (
                    <div
                      key={skill.name}
                      data-testid={`skill-item-${skill.name}`}
                      className="rounded-lg border border-border-subtle bg-inset p-3"
                    >
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedSkillName((prev) =>
                            prev === skill.name ? null : skill.name
                          )
                        }
                        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0 text-fg-muted" />
                          )}
                          <BookOpenCheck
                            className="size-3.5 shrink-0 text-fg-secondary"
                            strokeWidth={1.75}
                          />
                          <span className="truncate font-mono text-xs font-semibold text-fg-primary">
                            {skill.name}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs tabular-nums">
                          <span className="rounded border border-border-default bg-surface px-1.5 py-0.5 text-fg-secondary">
                            {skill.license ?? "Apache-2.0"}
                          </span>
                          <span className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-fg-muted">
                            v{skill.version ?? "1.0.0"}
                          </span>
                        </div>
                      </button>
                      <p
                        className={`mt-1.5 text-xs text-fg-secondary ${
                          isExpanded ? "leading-relaxed" : "line-clamp-2"
                        }`}
                      >
                        {skill.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-fg-muted tabular-nums">
                        <span>
                          {skill.phase ?? "geral"} · {skill.roleCategory} ·{" "}
                          {skill.resourcesCount} recurso(s)
                        </span>
                        <span>sha256:{skill.sha256.slice(0, 12)}</span>
                      </div>
                      {isExpanded && (
                        <div
                          data-testid={`skill-detail-${skill.name}`}
                          className="mt-2 space-y-1 border-t border-border-subtle pt-2 font-mono text-xs text-fg-muted"
                        >
                          <p className="break-words">
                            Papéis: {skill.appliesToRoles.join(", ")}
                          </p>
                          <p className="break-all">SHA-256: {skill.sha256}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Bloco 2: Auditoria de Entropia do Projeto */}
      <section
        aria-label="Auditoria de Entropia do Projeto"
        className="uzina-card min-w-0 space-y-4 rounded-xl border border-border-subtle bg-surface p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <Sparkles className="size-4 text-fg-secondary" strokeWidth={1.75} />
              <span>Manutenção Contínua &amp; Higiene</span>
            </div>
            <h2 className="text-sm font-semibold text-fg-primary">
              Auditoria de Entropia
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {projectsList.length > 0 && (
              <select
                aria-label="Projeto para auditoria de entropia"
                value={effectiveProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="h-8 max-w-[200px] truncate rounded-md border border-border-default bg-inset px-2 py-1 text-xs leading-normal text-fg-primary focus:border-border-strong focus:outline-none"
              >
                {projectsList.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              data-testid="entropy-refresh-btn"
              disabled={!effectiveProjectId || entropyQuery.isFetching}
              onClick={() => void entropyQuery.refetch()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default bg-inset px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
              <span>Auditar</span>
            </button>
          </div>
        </div>

        {!effectiveProjectId && !projectsQuery.isLoading ? (
          <div
            data-testid="entropy-empty"
            className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-8 text-center text-xs text-fg-secondary"
          >
            Cadastre um projeto com repositório local para executar a auditoria de entropia.
          </div>
        ) : entropyQuery.isLoading ? (
          <div
            data-testid="entropy-loading"
            className="space-y-3"
            aria-label="Executando auditoria de entropia"
          >
            <div className="grid grid-cols-2 gap-2.5">
              <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-inset" />
              <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-inset" />
              <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-inset" />
              <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-inset" />
            </div>
          </div>
        ) : entropyQuery.isError ? (
          <div
            data-testid="entropy-error"
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 p-3.5 text-xs text-status-danger"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
              <span>
                {entropyQuery.error instanceof Error
                  ? entropyQuery.error.message
                  : "Erro ao auditar entropia do projeto."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void entropyQuery.refetch()}
              className="min-h-8 rounded border border-status-danger/40 px-2.5 text-xs font-medium hover:bg-status-danger/15"
            >
              Tentar novamente
            </button>
          </div>
        ) : !entropy ? (
          <div
            data-testid="entropy-empty"
            className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-8 text-center text-xs text-fg-secondary"
          >
            Aguardando leitura de entropia do repositório selecionado.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div
                data-testid="entropy-dead-code-count"
                className="rounded-lg border border-border-subtle bg-inset p-3"
              >
                <span className="text-xs text-fg-secondary">Código Morto</span>
                <p className="mt-1 font-mono text-lg font-semibold text-fg-primary tabular-nums">
                  {entropy.deadCodeCandidates.length}
                </p>
              </div>
              <div
                data-testid="entropy-doc-drift-count"
                className="rounded-lg border border-border-subtle bg-inset p-3"
              >
                <span className="text-xs text-fg-secondary">Drifts de Spec</span>
                <p className="mt-1 font-mono text-lg font-semibold text-fg-primary tabular-nums">
                  {entropy.docSpecDrifts.length}
                </p>
              </div>
              <div
                data-testid="entropy-orphan-worktrees-count"
                className="rounded-lg border border-border-subtle bg-inset p-3"
              >
                <span className="text-xs text-fg-secondary">Worktrees Órfãos</span>
                <p className="mt-1 font-mono text-lg font-semibold text-fg-primary tabular-nums">
                  {entropy.orphanWorktrees.length}
                </p>
              </div>
              <div
                data-testid="entropy-unused-deps-count"
                className="rounded-lg border border-border-subtle bg-inset p-3"
              >
                <span className="text-xs text-fg-secondary">Deps Sem Uso</span>
                <p className="mt-1 font-mono text-lg font-semibold text-fg-primary tabular-nums">
                  {entropy.unusedDependencies.length}
                </p>
              </div>
            </div>

            {entropy.deadCodeCandidates.length === 0 &&
            entropy.docSpecDrifts.length === 0 &&
            entropy.orphanWorktrees.length === 0 &&
            entropy.unusedDependencies.length === 0 ? (
              <p className="rounded-lg border border-status-ok/30 bg-status-ok/10 px-3 py-2.5 text-xs text-status-ok">
                Nenhuma entropia relevante detectada neste repositório.
              </p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-xs">
                {entropy.orphanWorktrees.slice(0, 5).map((wt) => (
                  <div
                    key={wt.workspacePath}
                    className="flex items-center gap-2 rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-fg-secondary"
                  >
                    <FolderGit2 className="size-3.5 shrink-0 text-status-warn" />
                    <span className="truncate font-mono">
                      Worktree órfão: {wt.branchName} ({wt.workspacePath})
                    </span>
                  </div>
                ))}
                {entropy.docSpecDrifts.slice(0, 5).map((drift) => (
                  <div
                    key={`${drift.specPath}-${drift.missingTarget}`}
                    className="flex items-center gap-2 rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-fg-secondary"
                  >
                    <FileWarning className="size-3.5 shrink-0 text-status-warn" />
                    <span className="truncate">
                      {drift.specPath}: {drift.missingTarget}
                    </span>
                  </div>
                ))}
                {entropy.unusedDependencies.slice(0, 5).map((dep) => (
                  <div
                    key={`${dep.packageName}-${dep.dependencyName}`}
                    className="flex items-center gap-2 rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-fg-secondary"
                  >
                    <PackageX className="size-3.5 shrink-0 text-fg-muted" />
                    <span className="truncate font-mono">
                      {dep.packageName}: {dep.dependencyName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
