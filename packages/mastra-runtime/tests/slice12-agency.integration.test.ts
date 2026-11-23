import {
  closeDb,
  ensureDefaultOrgAndInternalClient,
  getDb,
  users,
} from "@uzina/db";
import { describe, expect, it } from "vitest";
import {
  getAgencyOverviewScoped,
  handleAgencyChatScoped,
} from "../src/index.js";

describe("@uzina/mastra-runtime — Slice 12 (Onboarding, Central Multi-Agente, Model Tiering & Ciclos)", () => {
  it("executa fluxos Greenfield (do zero), Brownfield (URL Git + AST), Ciclo Autônomo até Portão HITL e Retorno Cíclico ao Arquiteto (#2)", async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    try {
      const seeded = await ensureDefaultOrgAndInternalClient(ctx.db);
      const [user] = await ctx.db
        .insert(users)
        .values({
          email: "diretor@uzina.local",
          name: "Diretor de Engenharia",
        })
        .returning();

      const actor = {
        organizationId: seeded.organizationId,
        userId: user!.id,
        role: "owner" as const,
      };

      // 1. Visão inicial (Onboarding sem projetos)
      const initialOverview = await getAgencyOverviewScoped(ctx.db, {
        organizationId: seeded.organizationId,
      });
      expect(initialOverview.readiness.projectsCount).toBe(0);
      expect(initialOverview.agents).toHaveLength(6);
      expect(
        initialOverview.agents.find((a) => a.role === "software_architect")
          ?.recommendedTier
      ).toBe("tier3_deep_reasoning");
      expect(
        initialOverview.agents.find((a) => a.role === "tech_lead")
          ?.recommendedTier
      ).toBe("tier2_fast_execution");

      // 2. Iniciar Projeto Greenfield (do zero) via Chat com Agente de Descoberta
      const greenfieldRes = await handleAgencyChatScoped(ctx.db, {
        actor,
        request: {
          message:
            "Quero criar uma plataforma SaaS de telemedicina com prontuário eletrônico e agendamento inteligente.",
          intent: "start_greenfield",
          projectName: "TeleMed Cloud",
          autonomyMode: "semi_autonomous",
        },
      });

      expect(greenfieldRes.activeAgent.role).toBe("product_discovery");
      expect(greenfieldRes.projectState).not.toBeNull();
      expect(greenfieldRes.projectState?.originKind).toBe("greenfield");
      expect(greenfieldRes.projectState?.totalDeliverables).toBe(3);
      expect(greenfieldRes.projectState?.longTermArtifacts).toHaveLength(4);
      expect(
        greenfieldRes.projectState?.sliceArtifacts[0]?.specMarkdown
      ).toContain("# Dossiê do Slice");

      // 3. Importar Projeto Brownfield via URL Git remota com Agente Arquiteto
      const brownfieldRes = await handleAgencyChatScoped(ctx.db, {
        actor,
        request: {
          message:
            "Analise nosso repositório legado https://github.com/uzina-org/core-erp.git e estruture a migração para multi-tenant.",
          intent: "import_git_or_repo",
          projectName: "Core ERP Multi-Tenant",
          gitUrl: "https://github.com/uzina-org/core-erp.git",
          autonomyMode: "full_autonomous",
        },
      });

      expect(brownfieldRes.activeAgent.role).toBe("software_architect");
      expect(brownfieldRes.projectState?.originKind).toBe("brownfield");
      expect(brownfieldRes.projectState?.repositoryUrl).toBe(
        "https://github.com/uzina-org/core-erp.git"
      );
      expect(
        brownfieldRes.actionsExecuted.map((a) => a.type)
      ).toEqual(
        expect.arrayContaining([
          "created_project",
          "linked_git_repository",
          "executed_brownfield_scan",
          "indexed_polyglot_ast",
          "saved_qmd_memory",
          "created_deliverables_wave",
        ])
      );

      const brownfieldProjectId = brownfieldRes.projectState!.projectId;
      const firstSliceId =
        brownfieldRes.projectState!.sliceArtifacts[0]!.deliverableId;

      // 4. Executar Ciclo Autônomo (avança sem pular fases e pausa obrigatoriamente em decision_pending)
      const cycleRes = await handleAgencyChatScoped(ctx.db, {
        actor,
        request: {
          message: "Executar ciclo autônomo até o próximo portão obrigatório.",
          projectId: brownfieldProjectId,
          intent: "advance_cycle",
          autonomyMode: "full_autonomous",
        },
      });

      expect(
        cycleRes.actionsExecuted.some(
          (a) => a.type === "paused_at_mandatory_gate"
        )
      ).toBe(true);
      expect(cycleRes.projectState?.pendingDecisionsCount).toBeGreaterThan(0);

      // 5. Devolver Slice em Ciclo para o Agente Arquiteto (Ciclo #2) com feedback de correção
      const revisionRes = await handleAgencyChatScoped(ctx.db, {
        actor,
        request: {
          message:
            "Ajuste o plano técnico para usar api_contract_first e isolar o schema de faturamento.",
          projectId: brownfieldProjectId,
          deliverableId: firstSliceId,
          targetAgentRole: "software_architect",
          intent: "request_slice_revision",
          preferredStrategy: "api_contract_first",
          autonomyMode: "semi_autonomous",
        },
      });

      expect(revisionRes.activeAgent.role).toBe("software_architect");
      expect(revisionRes.cycleNumber).toBe(2);
      const revisedSlice = revisionRes.projectState?.sliceArtifacts.find(
        (s) => s.deliverableId === firstSliceId
      );
      expect(revisedSlice?.cycleNumber).toBe(2);
      expect(revisedSlice?.strategy).toBe("api_contract_first");
      expect(revisedSlice?.specMarkdown).toContain("Revisão Cíclica — Ciclo #2");

      // 6. Aprovar o segundo slice que estava em decision_pending
      const secondSliceId =
        revisionRes.projectState!.sliceArtifacts[1]!.deliverableId;
      const approveRes = await handleAgencyChatScoped(ctx.db, {
        actor,
        request: {
          message: "Dossiê e evidências validados. Pode aprovar o slice.",
          projectId: brownfieldProjectId,
          deliverableId: secondSliceId,
          intent: "approve_slice_artifact",
          autonomyMode: "semi_autonomous",
        },
      });

      const approvedSlice = approveRes.projectState?.sliceArtifacts.find(
        (s) => s.deliverableId === secondSliceId
      );
      expect(approvedSlice?.status).toBe("approved");
    } finally {
      await closeDb();
    }
  });
});
