"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClientListResponse, Project, ProjectListResponse } from "@uzina/contracts";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  setActiveContext,
  useActiveClientId,
  useActiveProjectId,
} from "@/lib/active-project-store";
import { AgencyCommandCenter } from "./agency-command-center";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(err?.error ?? `Erro HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function WorkspaceBoard() {
  const selectedClientId = useActiveClientId();
  const storedProjectId = useActiveProjectId();
  const [localProjectId, setLocalProjectId] = useState<string>("");

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => fetchJson<ClientListResponse>("/api/clients"),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectListResponse>("/api/projects"),
  });

  const allProjects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data?.items]
  );

  const visibleProjects = useMemo(() => {
    if (selectedClientId === "all") return allProjects;
    return allProjects.filter((p) => p.clientId === selectedClientId);
  }, [allProjects, selectedClientId]);

  const effectiveId = localProjectId || storedProjectId;
  const activeProject: Project | null = useMemo(() => {
    if (visibleProjects.length === 0) return null;
    const found = visibleProjects.find((p) => p.id === effectiveId);
    return found ?? visibleProjects[0] ?? null;
  }, [visibleProjects, effectiveId]);

  const isBootLoading = clientsQuery.isLoading || projectsQuery.isLoading;
  const bootError = clientsQuery.error || projectsQuery.error;

  if (isBootLoading) {
    return (
      <div
        className="mx-auto max-w-4xl space-y-4"
        aria-label="Carregando espaço de conversa"
      >
        <div className="h-10 animate-pulse rounded-lg border border-border-subtle bg-surface" />
        <div className="h-96 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      </div>
    );
  }

  if (bootError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-lg border border-status-danger/40 bg-status-danger/10 p-4 text-sm text-status-danger"
      >
        <span className="flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
          <span>
            {(bootError as Error).message || "Falha ao carregar dados."}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            void clientsQuery.refetch();
            void projectsQuery.refetch();
          }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-status-danger/40 bg-surface px-3 text-xs font-medium text-fg-primary"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          <span>Tentar novamente</span>
        </button>
      </div>
    );
  }

  return (
    <AgencyCommandCenter
      selectedClientId={selectedClientId}
      activeProjectId={activeProject?.id ?? ""}
      bootReady={!isBootLoading}
      hasAnyProjects={allProjects.length > 0}
      availableProjects={visibleProjects.map((p) => ({
        id: p.id,
        name: p.name,
        clientId: p.clientId,
      }))}
      onSelectProject={(projectId) => {
        setLocalProjectId(projectId);
        setActiveContext({ projectId });
      }}
    />
  );
}
