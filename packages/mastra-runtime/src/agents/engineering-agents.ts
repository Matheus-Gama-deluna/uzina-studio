import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { Memory } from "@mastra/memory";
import type { AgencyAgentRole, OrgRole } from "@uzina/contracts";
import type { UzinaDb } from "@uzina/db";
import { createTenantModelResolver } from "../model-resolver.js";
import {
  createUzinaErrorProcessors,
  createUzinaInputProcessors,
  createUzinaOutputProcessors,
} from "../processors.js";
import { createWorkspaceToolsForRole } from "../tools/workspace-tools.js";

const ROLE_INSTRUCTIONS: Record<AgencyAgentRole, string> = {
  orchestrator: [
    "Você é o Supervisor Executivo da Uzina Studio.",
    "Coordene a equipe de engenharia, responda sempre em Português do Brasil, e use as ferramentas do workspace para consultar entregas, memórias QMD e arquitetura real antes de responder.",
    "Nunca exponha chaves de API, segredos ou caminhos internos do sistema.",
  ].join("\n"),
  product_discovery: [
    "Você é o Agente de Descoberta & Produto da Uzina Studio.",
    "Estruture requisitos, critérios de aceite e escopo de produto em Português do Brasil usando o contexto real do projeto e as memórias QMD.",
  ].join("\n"),
  software_architect: [
    "Você é o Arquiteto de Software & Codebase da Uzina Studio.",
    "Inspecione o grafo AST, esqueleto do repositório, memórias QMD e entregas do projeto antes de propor decisões técnicas, ADRs ou revisões de slices.",
  ].join("\n"),
  ux_designer: [
    "Você é o Agente de Design & UX do Estúdio Visual da Uzina Studio.",
    "Alinhe fluxos visuais, tokens de design e critérios de usabilidade (Warm Stone 90/10, responsividade e estados de dados) consultando o projeto real.",
  ].join("\n"),
  tech_lead: [
    "Você é o Tech Lead & Builder da Uzina Studio.",
    "Apoie a decomposição em Vertical Slices, contratos Zod primeiro, TDD e execução isolada consultando os símbolos e entregas reais.",
  ].join("\n"),
  qa_appsec: [
    "Você é o Auditor de QA & AppSec da Uzina Studio.",
    "Avalie riscos de segurança, aderência a contratos, qualidade de testes (anti-teatro) e pendências HITL com base nos dados reais do projeto.",
  ].join("\n"),
};

export function createEngineeringSpecialistAgent(params: {
  role: AgencyAgentRole;
  db: UzinaDb;
  masterKey?: Buffer | string | null;
  memory?: Memory;
  actorRole: OrgRole;
  providerType?: string;
  knownSecrets?: readonly string[];
  modelOverride?: MastraModelConfig;
  extraInstructions?: string;
  onTailFlushed?: (flushedTail: string) => void;
}): Agent {
  const resolver = createTenantModelResolver({
    db: params.db,
    masterKey: params.masterKey,
    modelOverride: params.modelOverride,
  });

  const tools = createWorkspaceToolsForRole({
    db: params.db,
    role: params.role,
    actorRole: params.actorRole,
    masterKey: params.masterKey,
  });

  const dynamicModel: MastraModelConfig | (({ requestContext }: { requestContext: { get: (key: string) => unknown } }) => Promise<MastraModelConfig>) =
    params.modelOverride
      ? params.modelOverride
      : async ({ requestContext }) => {
          const actor = requestContext.get("actor") as
            | { organizationId?: string }
            | undefined;
          const orgId = actor?.organizationId;
          if (!orgId) {
            throw new Error(
              "AGENT_ORG_REQUIRED: organizationId ausente no RequestContext."
            );
          }
          const resolved = await resolver.resolveForRole(orgId, params.role);
          if (!resolved) {
            throw new Error(
              "AGENT_PROVIDER_UNAVAILABLE: Organização sem provedor LLM ativo."
            );
          }
          return resolved.mastraModel.model;
        };

  const instructions = params.extraInstructions?.trim()
    ? `${ROLE_INSTRUCTIONS[params.role]}\n\n${params.extraInstructions.trim()}`
    : ROLE_INSTRUCTIONS[params.role];

  return new Agent({
    id: `uzina_agent_${params.role}`,
    name: `Uzina ${params.role}`,
    instructions,
    model: dynamicModel as MastraModelConfig,
    tools,
    memory: params.memory,
    inputProcessors: createUzinaInputProcessors({
      knownSecrets: params.knownSecrets,
      toolsCatalog: tools,
      providerType: params.providerType,
    }),
    outputProcessors: createUzinaOutputProcessors({
      knownSecrets: params.knownSecrets,
      onTailFlushed: params.onTailFlushed,
    }),
    errorProcessors: createUzinaErrorProcessors(),
  });
}
