import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { readSymbolSliceFromWorkspace } from "@uzina/codebase-intel";
import {
  ChangeImpactInputSchema,
  ChangeImpactOutputSchema,
  ColorContrastValidationInputSchema,
  ColorContrastValidationOutputSchema,
  DeliverableEvidenceReadInputSchema,
  DeliverableEvidenceReadOutputSchema,
  DependencyBoundaryCheckInputSchema,
  DependencyBoundaryCheckOutputSchema,
  DesignSystemContractInputSchema,
  DesignSystemContractOutputSchema,
  DesignTokensW3CSchema,
  DistillRetrospectiveMemoryInputSchema,
  DistillRetrospectiveMemoryOutputSchema,
  EvidencePackSchema,
  FinopsRiskDigestInputSchema,
  FinopsRiskDigestOutputSchema,
  InspectPrototypeVersionInputSchema,
  InspectPrototypeVersionOutputSchema,
  ReadSymbolSliceInputSchema,
  ReadSymbolSliceOutputSchema,
  RequirementConflictCheckInputSchema,
  RequirementConflictCheckOutputSchema,
  SecurityFindingsQueryInputSchema,
  SecurityFindingsQueryOutputSchema,
  SymbolCallGraphInputSchema,
  SymbolCallGraphOutputSchema,
  TestAntiPatternAuditInputSchema,
  TestAntiPatternAuditOutputSchema,
  WorktreesAndLocksSnapshotInputSchema,
  WorktreesAndLocksSnapshotOutputSchema,
  type AgencyAgentRole,
  type CodebaseSymbol,
  type ColorContrastPairResult,
  type ColorContrastValidationOutput,
  type DependencyBoundaryViolation,
  type OrgRole,
  type RequirementConflictItem,
  type RiskLevel,
  type SecurityFindingDTO,
  type SemanticDiffFile,
  type TestAuditReport,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  auditTestDirectory,
  auditTestSource,
  mergeTestAuditReports,
  redactSensitiveText,
  sanitizePrototypeHtml,
} from "@uzina/core";
import {
  clients,
  codebaseFiles,
  codebaseSymbols,
  deliverables,
  designAssets,
  designPrototypes,
  memories,
  projectRepositories,
  projects,
  resolveDataDir,
  securityFindings,
  securityScans,
  type UzinaDb,
} from "@uzina/db";
import { listProjectWorktrees } from "@uzina/opencode-bridge";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  computeProjectChangeImpactScoped,
  queryProjectSymbolsScoped,
} from "../codebase.js";
import {
  getProjectAccumulatedCostUsd,
  getProjectAccumulatedTokens,
} from "../finops.js";
import { createMemoryScoped } from "../memories.js";
import { collectOrganizationKnownSecrets } from "../model-resolver.js";
import { isSensitiveWorkspaceFile } from "../processors.js";
import { searchQmdScoped } from "../qmd.js";
import type { SymbolLockManager } from "../symbol-locks.js";

export const WRITE_ROLES = new Set<OrgRole>(["owner", "admin", "developer"]);

export interface WorkspaceToolActor {
  organizationId: string;
  userId: string;
  role: OrgRole;
}

export interface RoleSpecializedToolsDeps {
  db: UzinaDb;
  masterKey?: Buffer | string | null;
  dataDir?: string;
  workspaceRoot?: string;
  symbolLockManager?: SymbolLockManager;
}

export interface ToolExecutionRuntimeContext {
  requestContext?: { get?: (key: string) => unknown };
}

export function resolveActorFromContext(
  context?: ToolExecutionRuntimeContext
): WorkspaceToolActor {
  const raw = context?.requestContext?.get?.("actor");
  if (
    raw &&
    typeof raw === "object" &&
    "organizationId" in raw &&
    "userId" in raw &&
    "role" in raw
  ) {
    const candidate = raw as Partial<WorkspaceToolActor>;
    if (
      typeof candidate.organizationId === "string" &&
      candidate.organizationId.length > 0 &&
      typeof candidate.userId === "string" &&
      candidate.userId.length > 0 &&
      typeof candidate.role === "string"
    ) {
      return candidate as WorkspaceToolActor;
    }
  }
  throw new Error(
    "TOOL_ACTOR_REQUIRED: ator autenticado obrigatório no RequestContext."
  );
}

export function resolveProjectIdFromContext(
  explicitProjectId: string | undefined,
  context?: ToolExecutionRuntimeContext
): string | undefined {
  if (explicitProjectId) return explicitProjectId;
  const ctxVal = context?.requestContext?.get?.("projectId");
  return typeof ctxVal === "string" && ctxVal.length > 0 ? ctxVal : undefined;
}

export async function assertProjectScopeForTool(
  db: UzinaDb,
  projectId: string,
  organizationId: string
): Promise<{
  id: string;
  clientId: string;
  name: string;
  designMdPath: string | null;
  budgetCapUsd: string | null;
}> {
  const [proj] = await db
    .select({
      id: projects.id,
      clientId: projects.clientId,
      name: projects.name,
      designMdPath: projects.designMdPath,
      budgetCapUsd: projects.budgetCapUsd,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, projectId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!proj) {
    throw new Error("Projeto não encontrado ou não pertence à organização.");
  }
  return proj;
}

async function assertDeliverableInProject(
  db: UzinaDb,
  deliverableId: string,
  projectId: string
) {
  const [deliv] = await db
    .select()
    .from(deliverables)
    .where(
      and(
        eq(deliverables.id, deliverableId),
        eq(deliverables.projectId, projectId)
      )
    )
    .limit(1);

  if (!deliv) {
    throw new Error("Entregável não encontrado no projeto ou organização.");
  }
  return deliv;
}

async function collectOrgSecretsSafe(
  db: UzinaDb,
  organizationId: string,
  masterKey?: Buffer | string | null
): Promise<string[]> {
  return collectOrganizationKnownSecrets(db, {
    organizationId,
    masterKey,
  }).catch(() => [] as string[]);
}

async function loadRepoSymbolsForSlice(
  db: UzinaDb,
  repositoryId: string
): Promise<CodebaseSymbol[]> {
  const fileRows = await db
    .select({ id: codebaseFiles.id, path: codebaseFiles.path })
    .from(codebaseFiles)
    .where(eq(codebaseFiles.repositoryId, repositoryId));

  if (fileRows.length === 0) {
    return [];
  }

  const filePathById = new Map(fileRows.map((f) => [f.id, f.path]));
  const symRows = await db
    .select()
    .from(codebaseSymbols)
    .where(
      inArray(
        codebaseSymbols.fileId,
        fileRows.map((f) => f.id)
      )
    );

  return symRows.map((s) => {
    const filePath = filePathById.get(s.fileId) ?? "unknown";
    return {
      id: s.id,
      fileId: s.fileId,
      filePath,
      kind: s.kind,
      name: s.name,
      signature: s.signature,
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
      exported: s.exported,
      citation: `${filePath}#L${s.lineStart}-L${s.lineEnd}`,
    };
  });
}

function truncateUtf8ByBytes(
  value: string,
  maxBytes: number,
  suffix = "\n// ... [truncado por maxBytes]"
): { text: string; truncated: boolean } {
  const totalBytes = Buffer.byteLength(value, "utf8");
  if (totalBytes <= maxBytes) {
    return { text: value, truncated: false };
  }
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const targetBytes = Math.max(0, maxBytes - suffixBytes);
  const sliced = Buffer.from(value, "utf8")
    .subarray(0, targetBytes)
    .toString("utf8");
  return {
    text: `${sliced}${targetBytes > 0 ? suffix : ""}`,
    truncated: true,
  };
}

function countRedactedMarkers(text: string): number {
  const matches = text.match(/\[REDACTED(?:_[A-Z0-9_]+)?\]/g);
  return matches ? matches.length : 0;
}

function assertSafeNonSymlinkFileInsideWorkspace(
  workspaceRoot: string,
  relativePath: string
): string {
  if (!relativePath.trim() || relativePath.includes("\0")) {
    throw new Error(`Caminho inválido '${relativePath}'.`);
  }
  const normalized = relativePath.replace(/\\/g, "/").trim();
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.includes("..") ||
    isSensitiveWorkspaceFile(normalized) ||
    segments.some((seg) => isSensitiveWorkspaceFile(seg))
  ) {
    throw new Error(
      `Acesso negado ao arquivo sensível ou traversal '${relativePath}'.`
    );
  }

  const canonicalRoot = assertPathInsideWorkspace(workspaceRoot, workspaceRoot, {
    allowRoot: true,
  });
  const absCandidate = path.resolve(
    /*turbopackIgnore: true*/ canonicalRoot,
    relativePath
  );

  // Bloqueia explicitamente symlinks em qualquer segmento antes de acessar o arquivo
  let cursor = canonicalRoot;
  for (const seg of segments) {
    cursor = path.join(/*turbopackIgnore: true*/ cursor, seg);
    if (fs.existsSync(/*turbopackIgnore: true*/ cursor)) {
      const stat = fs.lstatSync(/*turbopackIgnore: true*/ cursor);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Symlink bloqueado na travessia do workspace: '${relativePath}'.`
        );
      }
    }
  }

  const safeAbs = assertPathInsideWorkspace(canonicalRoot, absCandidate, {
    followSymlinks: false,
  });

  if (fs.existsSync(/*turbopackIgnore: true*/ safeAbs)) {
    const stat = fs.lstatSync(/*turbopackIgnore: true*/ safeAbs);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink não permitido em '${relativePath}'.`);
    }
  }

  return safeAbs;
}

// ============================================================================
// Regras de fronteira de dependências do monorepo Uzina Studio
// ============================================================================

const MONOREPO_LAYER_ALLOWED_INTERNAL: Record<string, readonly string[]> = {
  "@uzina/contracts": [],
  "@uzina/db": ["@uzina/contracts"],
  "@uzina/core": ["@uzina/contracts"],
  "@uzina/codebase-intel": ["@uzina/contracts", "@uzina/core"],
  "@uzina/opencode-bridge": ["@uzina/contracts", "@uzina/core"],
  "@uzina/security-engine": ["@uzina/contracts", "@uzina/core"],
  "@uzina/mastra-runtime": [
    "@uzina/contracts",
    "@uzina/core",
    "@uzina/db",
    "@uzina/codebase-intel",
    "@uzina/opencode-bridge",
    "@uzina/security-engine",
  ],
  "@uzina/web": [
    "@uzina/contracts",
    "@uzina/core",
    "@uzina/db",
    "@uzina/codebase-intel",
    "@uzina/opencode-bridge",
    "@uzina/security-engine",
    "@uzina/mastra-runtime",
  ],
  "@uzina/cli": [
    "@uzina/contracts",
    "@uzina/core",
    "@uzina/db",
    "@uzina/codebase-intel",
    "@uzina/opencode-bridge",
    "@uzina/security-engine",
    "@uzina/mastra-runtime",
  ],
};

function normalizeMonorepoPackageName(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (cleaned.startsWith("@uzina/")) {
    const parts = cleaned.split("/");
    return `${parts[0]}/${parts[1] ?? ""}`;
  }
  if (cleaned.startsWith("packages/")) {
    const pkg = cleaned.slice("packages/".length).split("/")[0] ?? "";
    return `@uzina/${pkg}`;
  }
  if (cleaned.startsWith("apps/")) {
    const app = cleaned.slice("apps/".length).split("/")[0] ?? "";
    return `@uzina/${app}`;
  }
  const simple = cleaned.split("/")[0] ?? cleaned;
  return `@uzina/${simple}`;
}

function extractInternalImportTarget(rawImport: string): string | null {
  const trimmed = rawImport.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("@uzina/")) {
    const parts = trimmed.split("/");
    return `${parts[0]}/${parts[1] ?? ""}`;
  }
  if (trimmed.includes("packages/")) {
    const after = trimmed.split("packages/")[1] ?? "";
    const pkg = after.split("/")[0];
    return pkg ? `@uzina/${pkg}` : null;
  }
  if (trimmed.includes("apps/")) {
    const after = trimmed.split("apps/")[1] ?? "";
    const app = after.split("/")[0];
    return app ? `@uzina/${app}` : null;
  }
  return null;
}

// ============================================================================
// Utilitários de Contraste WCAG 2.1 (Hex, RGB e OKLCH -> sRGB)
// ============================================================================

interface RgbLinear {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function srgbChannelToLinear(channel01: number): number {
  const c = clamp01(channel01);
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parseHexColor(raw: string): RgbLinear | null {
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  let r255 = 0;
  let g255 = 0;
  let b255 = 0;

  if (hex.length === 3 || hex.length === 4) {
    r255 = parseInt(hex[0]! + hex[0]!, 16);
    g255 = parseInt(hex[1]! + hex[1]!, 16);
    b255 = parseInt(hex[2]! + hex[2]!, 16);
  } else if (hex.length === 6 || hex.length === 8) {
    r255 = parseInt(hex.slice(0, 2), 16);
    g255 = parseInt(hex.slice(2, 4), 16);
    b255 = parseInt(hex.slice(4, 6), 16);
  } else {
    return null;
  }

  return {
    r: srgbChannelToLinear(r255 / 255),
    g: srgbChannelToLinear(g255 / 255),
    b: srgbChannelToLinear(b255 / 255),
  };
}

function parseRgbColor(raw: string): RgbLinear | null {
  const match = /^rgba?\(\s*([^)]+)\s*\)$/i.exec(raw.trim());
  if (!match) return null;
  const body = match[1]!.split("/")[0]!.trim();
  const parts = body.includes(",")
    ? body.split(",").map((p) => p.trim())
    : body.split(/\s+/).map((p) => p.trim());
  if (parts.length < 3) return null;

  const parseChannel = (token: string): number | null => {
    if (token.endsWith("%")) {
      const pct = Number(token.slice(0, -1));
      return Number.isFinite(pct) ? clamp01(pct / 100) : null;
    }
    const num = Number(token);
    return Number.isFinite(num) ? clamp01(num / 255) : null;
  };

  const r = parseChannel(parts[0]!);
  const g = parseChannel(parts[1]!);
  const b = parseChannel(parts[2]!);
  if (r === null || g === null || b === null) return null;

  return {
    r: srgbChannelToLinear(r),
    g: srgbChannelToLinear(g),
    b: srgbChannelToLinear(b),
  };
}

function parseHueRadians(rawToken: string): number | null {
  const lower = rawToken.trim().toLowerCase();
  if (lower.endsWith("deg")) {
    const val = Number(lower.slice(0, -3));
    return Number.isFinite(val) ? (val * Math.PI) / 180 : null;
  }
  if (lower.endsWith("rad")) {
    const val = Number(lower.slice(0, -3));
    return Number.isFinite(val) ? val : null;
  }
  if (lower.endsWith("turn")) {
    const val = Number(lower.slice(0, -4));
    return Number.isFinite(val) ? val * 2 * Math.PI : null;
  }
  const val = Number(lower);
  return Number.isFinite(val) ? (val * Math.PI) / 180 : null;
}

function parseOklchColor(raw: string): RgbLinear | null {
  const match = /^oklch\(\s*([^)]+)\s*\)$/i.exec(raw.trim());
  if (!match) return null;
  const body = match[1]!.split("/")[0]!.trim();
  const parts = body.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;

  const rawL = parts[0]!;
  const L = rawL.endsWith("%")
    ? Number(rawL.slice(0, -1)) / 100
    : Number(rawL);
  const C = Number(parts[1]!);
  const hueRad = parseHueRadians(parts[2]!);

  if (
    !Number.isFinite(L) ||
    !Number.isFinite(C) ||
    hueRad === null ||
    L < 0 ||
    L > 1 ||
    C < 0
  ) {
    return null;
  }

  const a = C * Math.cos(hueRad);
  const b = C * Math.sin(hueRad);

  const lPrime = L + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = L - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = L - 0.0894841775 * a - 1.291485548 * b;

  const l = lPrime * lPrime * lPrime;
  const m = mPrime * mPrime * mPrime;
  const s = sPrime * sPrime * sPrime;

  return {
    r: clamp01(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function parseColorToLinearRgb(raw: string): {
  format: "hex" | "oklch" | "rgb" | "invalid";
  linear: RgbLinear | null;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith("#")) {
    const linear = parseHexColor(trimmed);
    return { format: linear ? "hex" : "invalid", linear };
  }
  if (/^oklch\(/i.test(trimmed)) {
    const linear = parseOklchColor(trimmed);
    return { format: linear ? "oklch" : "invalid", linear };
  }
  if (/^rgba?\(/i.test(trimmed)) {
    const linear = parseRgbColor(trimmed);
    return { format: linear ? "rgb" : "invalid", linear };
  }
  return { format: "invalid", linear: null };
}

function computeRelativeLuminance(linear: RgbLinear): number {
  return 0.2126 * linear.r + 0.7152 * linear.g + 0.0722 * linear.b;
}

function computeContrastRatio(fg: RgbLinear, bg: RgbLinear): number {
  const l1 = computeRelativeLuminance(fg);
  const l2 = computeRelativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

// ============================================================================
// Utilitários de Texto / Keywords / Protótipos / UI Components
// ============================================================================

const PT_EN_STOPWORDS = new Set([
  "para",
  "como",
  "com",
  "sem",
  "uma",
  "uns",
  "umas",
  "que",
  "por",
  "dos",
  "das",
  "nos",
  "nas",
  "sobre",
  "entre",
  "apenas",
  "todos",
  "todas",
  "esta",
  "este",
  "isso",
  "mais",
  "menos",
  "deve",
  "devem",
  "pode",
  "podem",
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "must",
  "should",
]);

function tokenizeKeywords(text: string): Set<string> {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = new Set<string>();
  for (const m of normalized.matchAll(/[a-z0-9_-]{3,}/g)) {
    const tok = m[0]!;
    if (!PT_EN_STOPWORDS.has(tok)) {
      tokens.add(tok);
    }
  }
  return tokens;
}

function countTokenOverlap(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = [];
  for (const tok of a) {
    if (b.has(tok)) {
      shared.push(tok);
    }
  }
  return shared;
}

function resolvePrototypesStorageDir(dataDir?: string): string {
  const base = dataDir ?? resolveDataDir();
  if (base === ":memory:") {
    return path.resolve(os.tmpdir(), "uzina-memory-prototypes");
  }
  return path.resolve(base, "uploads", "prototypes");
}

function extractDomSectionsFromHtml(html: string): string[] {
  const sections: string[] = [];
  const seen = new Set<string>();
  const addSection = (label: string) => {
    const clean = label.trim().slice(0, 100);
    if (clean && !seen.has(clean) && sections.length < 50) {
      seen.add(clean);
      sections.push(clean);
    }
  };

  for (const m of html.matchAll(
    /<(header|nav|main|section|aside|footer)\b([^>]*)>/gi
  )) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const slotMatch = /\bdata-(?:slot|section)\s*=\s*["']([^"']+)["']/i.exec(
      attrs
    );
    const suffix = idMatch?.[1] ?? slotMatch?.[1];
    addSection(suffix ? `<${tag}#${suffix}>` : `<${tag}>`);
  }

  for (const m of html.matchAll(/<h[1-3]\b[^>]*>([^<]{1,80})<\/h[1-3]>/gi)) {
    addSection(`heading:${m[1]!.trim()}`);
  }

  return sections;
}

function scanUiDataSlotComponents(
  workspaceRoot: string,
  limit: number
): Array<{ name: string; dataSlot: string; filePath: string }> {
  const searchDirs = [
    path.join(/*turbopackIgnore: true*/ workspaceRoot, "packages", "ui"),
    path.join(
      /*turbopackIgnore: true*/ workspaceRoot,
      "apps",
      "web",
      "src",
      "components"
    ),
  ];
  const results: Array<{ name: string; dataSlot: string; filePath: string }> =
    [];
  const seen = new Set<string>();

  const walk = (dir: string) => {
    if (
      results.length >= limit ||
      !fs.existsSync(/*turbopackIgnore: true*/ dir)
    ) {
      return;
    }
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ dir, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      const abs = path.join(/*turbopackIgnore: true*/ dir, entry.name);
      try {
        if (fs.lstatSync(/*turbopackIgnore: true*/ abs).isSymbolicLink()) {
          continue;
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && /\.(?:tsx|ts|jsx)$/i.test(entry.name)) {
        const content = fs.readFileSync(/*turbopackIgnore: true*/ abs, "utf8");
        const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
        for (const slotMatch of content.matchAll(
          /data-slot\s*=\s*["']([a-z0-9_-]+)["']/gi
        )) {
          const dataSlot = slotMatch[1]!;
          const key = `${rel}::${dataSlot}`;
          if (!seen.has(key) && results.length < limit) {
            seen.add(key);
            const compName = path.basename(entry.name, path.extname(entry.name));
            results.push({
              name: compName,
              dataSlot,
              filePath: rel,
            });
          }
        }
      }
    }
  };

  for (const dir of searchDirs) {
    walk(dir);
  }
  return results;
}

// ============================================================================
// Fábrica das 14 Tools Especializadas por Papel
// ============================================================================

/**
 * Cria as 14 tools especializadas de domínio da Uzina Studio com:
 * - Isolamento multi-tenant (`organizationId` + `projectId` resolvidos no servidor);
 * - RBAC fail-closed (`OrgRole`);
 * - Redação de segredos do tenant (`collectOrganizationKnownSecrets` + `redactSensitiveText`);
 * - Contenção estrita de workspace e limites de bytes/paginação.
 */
export function createRoleSpecializedToolsMap(
  deps: RoleSpecializedToolsDeps
): ToolsInput {
  // 1. trace_symbol_call_graph
  const traceSymbolCallGraphTool = createTool({
    id: "trace_symbol_call_graph",
    description:
      "Navega o grafo AST de chamadas, imports e relações de um símbolo em profundidade 1..3.",
    inputSchema: SymbolCallGraphInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );
      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const rawRes = await queryProjectSymbolsScoped(deps.db, {
        organizationId: actor.organizationId,
        projectId: inputData.projectId,
        query: {
          repositoryId: inputData.repositoryId,
          symbol: inputData.symbol,
          relation: inputData.relation,
          depth: inputData.depth,
          maxResults: inputData.maxResults + 1,
        },
      });

      const truncated =
        rawRes.nodes.length > inputData.maxResults || rawRes.edges.length > 200;
      const nodes = rawRes.nodes
        .slice(0, Math.min(100, inputData.maxResults))
        .map((n) => ({
          ...n,
          signature: redactSensitiveText(n.signature, knownSecrets),
        }));
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = rawRes.edges
        .filter((e) => nodeIds.has(e.fromSymbolId) && nodeIds.has(e.toSymbolId))
        .slice(0, 200);

      return SymbolCallGraphOutputSchema.parse({
        query: redactSensitiveText(rawRes.query, knownSecrets),
        nodes,
        edges,
        tokensEstimated: rawRes.tokensEstimated,
        truncated,
      });
    },
  });

  // 2. analyze_change_impact
  const analyzeChangeImpactTool = createTool({
    id: "analyze_change_impact",
    description:
      "Calcula o raio de impacto (símbolos e rotas afetadas) a partir de uma lista de arquivos modificados.",
    inputSchema: ChangeImpactInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const impact = await computeProjectChangeImpactScoped(deps.db, {
        organizationId: actor.organizationId,
        projectId: inputData.projectId,
        request: {
          repositoryId: inputData.repositoryId,
          changedFiles: inputData.changedFiles,
        },
      });

      const cap = Math.min(100, inputData.maxResults);
      const truncated =
        impact.affectedSymbols.length > cap || impact.affectedRoutes.length > 100;

      return ChangeImpactOutputSchema.parse({
        changedFiles: impact.changedFiles,
        affectedSymbols: impact.affectedSymbols.slice(0, cap).map((s) => ({
          ...s,
          signature: redactSensitiveText(s.signature, knownSecrets),
        })),
        affectedRoutes: impact.affectedRoutes.slice(0, 100).map((s) => ({
          ...s,
          signature: redactSensitiveText(s.signature, knownSecrets),
        })),
        tokensEstimated: impact.tokensEstimated,
        truncated,
      });
    },
  });

  // 3. read_symbol_source_slice
  const readSymbolSourceSliceTool = createTool({
    id: "read_symbol_source_slice",
    description:
      "Lê apenas a fatia exata de linhas de um símbolo AST no workspace com contenção de caminho e redação de segredos.",
    inputSchema: ReadSymbolSliceInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      const repos = await deps.db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, inputData.projectId));

      const repo = inputData.repositoryId
        ? repos.find((r) => r.id === inputData.repositoryId) ?? null
        : repos[0] ?? null;

      if (inputData.repositoryId && !repo) {
        throw new Error(
          `Repositório '${inputData.repositoryId}' não pertence ao projeto.`
        );
      }

      const workspaceRoot =
        deps.workspaceRoot ?? repo?.localPath ?? process.cwd();

      // Contenção explícita: bloqueia .env, .master-key, traversal (..) e symlinks
      assertSafeNonSymlinkFileInsideWorkspace(workspaceRoot, inputData.path);

      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );
      const symbols = repo
        ? await loadRepoSymbolsForSlice(deps.db, repo.id)
        : [];

      const slice = readSymbolSliceFromWorkspace(workspaceRoot, symbols, {
        repositoryId: inputData.repositoryId,
        path: inputData.path,
        symbol: inputData.symbol,
        maxBytes: inputData.maxBytes,
      });

      const redactedCode = redactSensitiveText(slice.code, knownSecrets);
      const capped = truncateUtf8ByBytes(redactedCode, inputData.maxBytes);
      const wasTruncated =
        capped.truncated || slice.code.includes("[truncado por maxBytes]");
      const redactedSecretsCount = countRedactedMarkers(capped.text);

      return ReadSymbolSliceOutputSchema.parse({
        path: slice.path,
        symbol: slice.symbol,
        kind: slice.kind,
        lineStart: slice.lineStart,
        lineEnd: slice.lineEnd,
        citation: slice.citation,
        code: capped.text,
        redactedSecretsCount,
        tokensEstimated: slice.tokensEstimated,
        baselineFileTokens: slice.baselineFileTokens,
        savingsPercent: slice.savingsPercent,
        truncated: wasTruncated,
      });
    },
  });

  // 4. check_dependency_boundaries
  const checkDependencyBoundariesTool = createTool({
    id: "check_dependency_boundaries",
    description:
      "Valida imports propostos contra as fronteiras de camadas do monorepo e bloqueia módulos @mastra/*-ee.",
    inputSchema: DependencyBoundaryCheckInputSchema,
    execute: async (inputData, context) => {
      resolveActorFromContext(context);
      const sourcePkg = normalizeMonorepoPackageName(inputData.sourcePackage);
      const allowedTargets = MONOREPO_LAYER_ALLOWED_INTERNAL[sourcePkg];
      const violations: DependencyBoundaryViolation[] = [];

      if (!allowedTargets) {
        violations.push({
          targetImport: sourcePkg,
          reason: `Pacote origem '${inputData.sourcePackage}' desconhecido na matriz de camadas do monorepo.`,
          severity: "error",
        });
        return DependencyBoundaryCheckOutputSchema.parse({
          passed: false,
          sourcePackage: sourcePkg,
          allowedInternalTargets: [],
          violations,
        });
      }

      const allowedSet = new Set(allowedTargets);
      for (const imp of inputData.proposedImports) {
        const trimmed = imp.trim();
        if (
          /@mastra\/[^\s/]+-ee\b/i.test(trimmed) ||
          /(?:^|\/)ee(?:\/|$)/i.test(trimmed)
        ) {
          violations.push({
            targetImport: trimmed,
            reason:
              "Proibição absoluta de licença: módulos Enterprise (@mastra/*-ee ou ee/) são vedados.",
            severity: "error",
          });
          continue;
        }

        const internalTarget = extractInternalImportTarget(trimmed);
        if (!internalTarget) {
          if (trimmed.startsWith("../") && trimmed.split("../").length > 3) {
            violations.push({
              targetImport: trimmed,
              reason:
                "Import relativo profundo pode estar cruzando fronteira de pacote sem entrypoint público.",
              severity: "warning",
            });
          }
          continue;
        }

        if (internalTarget === sourcePkg) {
          continue;
        }

        if (!allowedSet.has(internalTarget)) {
          violations.push({
            targetImport: trimmed,
            reason: `Violação de fronteira: '${sourcePkg}' não pode importar '${internalTarget}'. Permitidos: ${
              allowedTargets.length > 0 ? allowedTargets.join(", ") : "nenhum interno"
            }.`,
            severity: "error",
          });
        }
      }

      return DependencyBoundaryCheckOutputSchema.parse({
        passed: violations.every((v) => v.severity !== "error"),
        sourcePackage: sourcePkg,
        allowedInternalTargets: [...allowedTargets],
        violations: violations.slice(0, 100),
      });
    },
  });

  // 5. check_requirement_conflicts
  const checkRequirementConflictsTool = createTool({
    id: "check_requirement_conflicts",
    description:
      "Cruza um requisito proposto contra memórias QMD (domain_rule, architecture) e entregáveis ativos para detectar sobreposições ou conflitos.",
    inputSchema: RequirementConflictCheckInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );
      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const proposalTokens = tokenizeKeywords(
        `${inputData.proposedTitle} ${inputData.proposedScope}`
      );
      const conflicts: RequirementConflictItem[] = [];
      const seenRefIds = new Set<string>();

      const qmdRes = await searchQmdScoped(deps.db, {
        organizationId: actor.organizationId,
        request: {
          query: `${inputData.proposedTitle} ${inputData.proposedScope.slice(0, 260)}`,
          projectId: proj.id,
          limit: 15,
        },
      }).catch(() => null);

      const memoryRows = await deps.db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.organizationId, actor.organizationId),
            inArray(memories.category, ["domain_rule", "architecture"])
          )
        )
        .orderBy(desc(memories.updatedAt))
        .limit(40);

      for (const hit of qmdRes?.hits ?? []) {
        const hitTokens = tokenizeKeywords(`${hit.headingPath} ${hit.snippet}`);
        const shared = countTokenOverlap(proposalTokens, hitTokens);
        if (shared.length >= 2) {
          const refId = hit.memoryId ?? hit.sourcePath ?? hit.id;
          if (!seenRefIds.has(refId)) {
            seenRefIds.add(refId);
            const strong =
              shared.length >= 4 ||
              (proposalTokens.size > 0 &&
                shared.length / proposalTokens.size >= 0.5);
            conflicts.push({
              sourceType:
                hit.sourceType === "markdown" ? "spec_doc" : "qmd_memory",
              referenceId: refId.slice(0, 200),
              title: redactSensitiveText(hit.headingPath, knownSecrets).slice(
                0,
                240
              ),
              overlapSummary: redactSensitiveText(
                `Sobreposição nos termos [${shared.slice(0, 6).join(", ")}]: ${hit.snippet.slice(0, 280)}`,
                knownSecrets
              ).slice(0, 600),
              severity: strong ? "blocking" : "advisory",
            });
          }
        }
      }

      for (const mem of memoryRows) {
        if (mem.scopeType === "project" && mem.scopeId !== proj.id) {
          continue;
        }
        if (mem.scopeType === "client" && mem.scopeId !== proj.clientId) {
          continue;
        }
        if (seenRefIds.has(mem.id)) continue;

        const memTokens = tokenizeKeywords(`${mem.title} ${mem.content}`);
        const shared = countTokenOverlap(proposalTokens, memTokens);
        if (shared.length >= 2) {
          seenRefIds.add(mem.id);
          const strong =
            shared.length >= 4 ||
            /\b(?:nunca|proibido|vedado|somente|apenas|obrigatório)\b/i.test(
              mem.content
            );
          conflicts.push({
            sourceType: "qmd_memory",
            referenceId: mem.id,
            title: redactSensitiveText(mem.title, knownSecrets).slice(0, 240),
            overlapSummary: redactSensitiveText(
              `Regra '${mem.category}' compartilha [${shared.slice(0, 6).join(", ")}]: ${mem.content.slice(0, 260)}`,
              knownSecrets
            ).slice(0, 600),
            severity: strong ? "blocking" : "advisory",
          });
        }
      }

      const activeDelivs = await deps.db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, proj.id))
        .orderBy(desc(deliverables.updatedAt))
        .limit(40);

      for (const deliv of activeDelivs) {
        if (deliv.status === "merged" || deliv.status === "failed") {
          continue;
        }
        const delivTokens = tokenizeKeywords(
          `${deliv.title} ${deliv.description ?? ""} ${deliv.specMarkdown ?? ""}`
        );
        const shared = countTokenOverlap(proposalTokens, delivTokens);
        if (shared.length >= 2) {
          const isActiveCodeStage =
            deliv.status === "building" ||
            deliv.status === "contract_tests" ||
            deliv.status === "verifying";
          conflicts.push({
            sourceType: "deliverable",
            referenceId: deliv.id,
            title: redactSensitiveText(deliv.title, knownSecrets).slice(0, 240),
            overlapSummary: redactSensitiveText(
              `Entregável em '${deliv.status}' compartilha [${shared.slice(0, 6).join(", ")}].`,
              knownSecrets
            ).slice(0, 600),
            severity:
              isActiveCodeStage && shared.length >= 3 ? "blocking" : "advisory",
          });
        }
      }

      const limited = conflicts.slice(0, inputData.limit);
      return RequirementConflictCheckOutputSchema.parse({
        hasConflicts: limited.length > 0,
        conflicts: limited,
        checkedDeliverablesCount: activeDelivs.length,
        checkedMemoriesCount:
          memoryRows.length + (qmdRes?.hits.length ?? 0),
      });
    },
  });

  // 6. read_finops_and_risk_digest
  const readFinopsAndRiskDigestTool = createTool({
    id: "read_finops_and_risk_digest",
    description:
      "Retorna consumo de tokens/USD, teto de orçamento, taxa de retrabalho e achados de segurança abertos do projeto.",
    inputSchema: FinopsRiskDigestInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      if (inputData.deliverableId) {
        await assertDeliverableInProject(
          deps.db,
          inputData.deliverableId,
          proj.id
        );
      }

      const [tokensTotal, estimatedCostUsd, delivRows, scanRows] =
        await Promise.all([
          getProjectAccumulatedTokens(deps.db, proj.id),
          getProjectAccumulatedCostUsd(deps.db, proj.id),
          deps.db
            .select({
              id: deliverables.id,
              status: deliverables.status,
              verifyAttempts: deliverables.verifyAttempts,
            })
            .from(deliverables)
            .where(eq(deliverables.projectId, proj.id)),
          deps.db
            .select({ id: securityScans.id })
            .from(securityScans)
            .where(
              and(
                eq(securityScans.organizationId, actor.organizationId),
                eq(securityScans.projectId, proj.id)
              )
            ),
        ]);

      const scopedDelivs = inputData.deliverableId
        ? delivRows.filter((d) => d.id === inputData.deliverableId)
        : delivRows;

      const reworked = scopedDelivs.filter(
        (d) => d.verifyAttempts > 1 || d.status === "failed"
      ).length;
      const reworkRatePercent =
        scopedDelivs.length > 0
          ? Number(((reworked / scopedDelivs.length) * 100).toFixed(1))
          : 0;
      const averageVerifyAttempts =
        scopedDelivs.length > 0
          ? Number(
              (
                scopedDelivs.reduce((acc, d) => acc + d.verifyAttempts, 0) /
                scopedDelivs.length
              ).toFixed(2)
            )
          : 0;

      const scanIds = scanRows.map((s) => s.id);
      const findingRows =
        scanIds.length > 0
          ? await deps.db
              .select({
                severity: securityFindings.severity,
                triageVerdict: securityFindings.triageVerdict,
                suppressedInMemory: securityFindings.suppressedInMemory,
              })
              .from(securityFindings)
              .where(inArray(securityFindings.scanId, scanIds))
          : [];

      const openSecurityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const f of findingRows) {
        if (f.suppressedInMemory || f.triageVerdict === "false_positive") {
          continue;
        }
        if (f.severity === "critical") openSecurityCounts.critical += 1;
        else if (f.severity === "high") openSecurityCounts.high += 1;
        else if (f.severity === "medium") openSecurityCounts.medium += 1;
        else if (f.severity === "low") openSecurityCounts.low += 1;
      }

      const rawCap = proj.budgetCapUsd ? Number(proj.budgetCapUsd) : null;
      const budgetCapUsd =
        rawCap !== null && Number.isFinite(rawCap) && rawCap > 0
          ? rawCap
          : null;
      const budgetUtilizationPercent =
        budgetCapUsd !== null
          ? Math.min(
              1000,
              Number(((estimatedCostUsd / budgetCapUsd) * 100).toFixed(2))
            )
          : null;

      let overallRiskLevel: RiskLevel = "low";
      if (
        openSecurityCounts.critical > 0 ||
        reworkRatePercent >= 50 ||
        (budgetUtilizationPercent !== null && budgetUtilizationPercent >= 90)
      ) {
        overallRiskLevel = "high";
      } else if (
        openSecurityCounts.high > 0 ||
        reworkRatePercent >= 20 ||
        (budgetUtilizationPercent !== null && budgetUtilizationPercent >= 70)
      ) {
        overallRiskLevel = "medium";
      }

      return FinopsRiskDigestOutputSchema.parse({
        projectId: proj.id,
        tokensTotal,
        estimatedCostUsd,
        budgetCapUsd,
        budgetUtilizationPercent,
        reworkRatePercent,
        averageVerifyAttempts,
        openSecurityCounts,
        overallRiskLevel,
      });
    },
  });

  // 7. read_design_system_contract
  const readDesignSystemContractTool = createTool({
    id: "read_design_system_contract",
    description:
      "Lê .uzina/DESIGN.md, designAssets aprovados, tokens visuais e componentes UI com data-slot no workspace.",
    inputSchema: DesignSystemContractInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );
      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const [repo] = await deps.db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, proj.id))
        .limit(1);

      const workspaceRoot =
        deps.workspaceRoot ?? repo?.localPath ?? process.cwd();

      const candidateRelPath = proj.designMdPath?.trim() || ".uzina/DESIGN.md";
      let resolvedDesignMdPath: string | null = null;
      let rawMarkdown = "";

      try {
        const absDesignMd = assertSafeNonSymlinkFileInsideWorkspace(
          workspaceRoot,
          candidateRelPath
        );
        if (fs.existsSync(/*turbopackIgnore: true*/ absDesignMd)) {
          resolvedDesignMdPath = candidateRelPath.replace(/\\/g, "/");
          rawMarkdown = fs.readFileSync(
            /*turbopackIgnore: true*/ absDesignMd,
            "utf8"
          );
        }
      } catch {
        // Fallback para registros de designAssets no banco quando caminho em disco não existir
      }

      const assets = await deps.db
        .select()
        .from(designAssets)
        .where(eq(designAssets.projectId, proj.id))
        .orderBy(desc(designAssets.updatedAt));

      const approvedAssetsCount = assets.filter((a) => a.approved).length;
      if (!rawMarkdown) {
        const designMdAsset =
          assets.find((a) => a.assetType === "design_md" && a.approved) ??
          assets.find((a) => a.assetType === "design_md");
        if (designMdAsset?.notes) {
          rawMarkdown = designMdAsset.notes;
        }
      }

      const redactedMd = redactSensitiveText(rawMarkdown, knownSecrets);
      const cappedMd = truncateUtf8ByBytes(
        redactedMd,
        inputData.maxMarkdownBytes,
        "\n... [DESIGN.md truncado]"
      );

      const latestProtos = await deps.db
        .select()
        .from(designPrototypes)
        .where(eq(designPrototypes.projectId, proj.id))
        .orderBy(desc(designPrototypes.approved), desc(designPrototypes.createdAt))
        .limit(1);

      const tokensPreview: Array<{
        category: string;
        name: string;
        value: string;
      }> = [];
      const proto = latestProtos[0];
      if (proto?.tokensJson) {
        const parsedTokens = DesignTokensW3CSchema.safeParse(proto.tokensJson);
        if (parsedTokens.success) {
          for (const [cat, entries] of Object.entries(parsedTokens.data)) {
            for (const [name, tok] of Object.entries(entries)) {
              if (tokensPreview.length < 100) {
                tokensPreview.push({
                  category: cat,
                  name,
                  value: redactSensitiveText(tok.$value, knownSecrets),
                });
              }
            }
          }
        }
      }

      if (tokensPreview.length === 0 && redactedMd) {
        for (const m of redactedMd.matchAll(
          /(`?--[a-z0-9-]+`?)\s*\|\s*`?(oklch\([^`|\n]+\)|#[0-9a-fA-F]{3,8})`?/gi
        )) {
          if (tokensPreview.length >= 100) break;
          tokensPreview.push({
            category: "color",
            name: m[1]!.replace(/`/g, "").trim(),
            value: m[2]!.trim(),
          });
        }
      }

      const uiComponents = fs.existsSync(/*turbopackIgnore: true*/ workspaceRoot)
        ? scanUiDataSlotComponents(workspaceRoot, inputData.componentsLimit)
        : [];

      return DesignSystemContractOutputSchema.parse({
        designMdPath: resolvedDesignMdPath,
        designMdExcerpt: cappedMd.text,
        approvedAssetsCount,
        tokensPreview,
        uiComponents,
        truncated: cappedMd.truncated,
      });
    },
  });

  // 8. inspect_prototype_version
  const inspectPrototypeVersionTool = createTool({
    id: "inspect_prototype_version",
    description:
      "Inspeciona versões v1..vN de protótipos em designPrototypes com metadados, seções DOM e HTML sanitizado.",
    inputSchema: InspectPrototypeVersionInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      if (inputData.deliverableId) {
        await assertDeliverableInProject(
          deps.db,
          inputData.deliverableId,
          proj.id
        );
      }

      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const allProtos = await deps.db
        .select()
        .from(designPrototypes)
        .where(eq(designPrototypes.projectId, proj.id))
        .orderBy(asc(designPrototypes.createdAt));

      const filtered = allProtos.filter((p) => {
        if (inputData.prototypeId && p.id !== inputData.prototypeId) {
          return false;
        }
        if (
          inputData.deliverableId &&
          p.deliverableId !== inputData.deliverableId
        ) {
          return false;
        }
        return true;
      });

      const versionNumberById = new Map(
        allProtos.map((p, idx) => [p.id, idx + 1])
      );
      const slice = filtered.slice(-inputData.versionLimit);
      let anyTruncated = filtered.length > slice.length;
      const storageDir = resolvePrototypesStorageDir(deps.dataDir);

      const versions = slice.map((row) => {
        let htmlContent = "";
        try {
          const absHtml = assertPathInsideWorkspace(
            storageDir,
            path.basename(row.htmlStoragePath)
          );
          if (fs.existsSync(/*turbopackIgnore: true*/ absHtml)) {
            htmlContent = fs.readFileSync(
              /*turbopackIgnore: true*/ absHtml,
              "utf8"
            );
          }
        } catch {
          htmlContent = "";
        }

        const sanitized = htmlContent
          ? sanitizePrototypeHtml(redactSensitiveText(htmlContent, knownSecrets))
          : redactSensitiveText(
              `<main><h1>${row.title}</h1>${row.wireframeMermaid ?? ""}</main>`,
              knownSecrets
            );
        const domSections = extractDomSectionsFromHtml(sanitized);
        const cappedSummary = truncateUtf8ByBytes(
          sanitized,
          inputData.maxSummaryBytes,
          "<!-- truncado -->"
        );
        if (cappedSummary.truncated) anyTruncated = true;

        const parsedTokens = DesignTokensW3CSchema.safeParse(row.tokensJson);

        return {
          prototypeId: row.id,
          versionNumber: versionNumberById.get(row.id) ?? 1,
          title: redactSensitiveText(row.title, knownSecrets),
          level: row.level,
          source: row.source,
          approved: row.approved,
          domSections,
          sanitizedHtmlSummary: cappedSummary.text,
          ...(parsedTokens.success ? { tokensJson: parsedTokens.data } : {}),
          createdAt: row.createdAt.toISOString(),
        };
      });

      return InspectPrototypeVersionOutputSchema.parse({
        projectId: proj.id,
        versions,
        totalVersions: filtered.length,
        truncated: anyTruncated,
      });
    },
  });

  // 9. validate_color_contrast_and_tokens
  const validateColorContrastAndTokensTool = createTool({
    id: "validate_color_contrast_and_tokens",
    description:
      "Calcula luminância relativa e razão de contraste WCAG 2.1 real para pares hex/rgb/oklch e detecta cores hardcoded.",
    inputSchema: ColorContrastValidationInputSchema,
    execute: async (inputData, context) => {
      resolveActorFromContext(context);

      const requiredRatioByLevel = {
        aa_normal: 4.5,
        aa_large: 3.0,
        aaa_normal: 7.0,
      } as const;

      const results: ColorContrastPairResult[] = [];
      const invalidTokens: ColorContrastValidationOutput["invalidTokens"] = [];
      const hardcodedSet = new Set<string>();

      for (const pair of inputData.pairs) {
        const fg = parseColorToLinearRgb(pair.foreground);
        const bg = parseColorToLinearRgb(pair.background);
        const requiredRatio = requiredRatioByLevel[pair.level];

        if (!fg.linear || !bg.linear) {
          if (!fg.linear) {
            invalidTokens.push({
              token: `${pair.label}.foreground`,
              value: pair.foreground,
              reason: "Formato de cor inválido (esperado hex, rgb ou oklch).",
            });
          }
          if (!bg.linear) {
            invalidTokens.push({
              token: `${pair.label}.background`,
              value: pair.background,
              reason: "Formato de cor inválido (esperado hex, rgb ou oklch).",
            });
          }
          results.push({
            label: pair.label,
            foreground: pair.foreground,
            background: pair.background,
            contrastRatio: 0,
            requiredRatio,
            passed: false,
            formatDetected: "invalid",
          });
          continue;
        }

        const ratio = computeContrastRatio(fg.linear, bg.linear);
        const formatDetected =
          fg.format === "oklch" || bg.format === "oklch"
            ? "oklch"
            : fg.format === "rgb" || bg.format === "rgb"
              ? "rgb"
              : "hex";

        results.push({
          label: pair.label,
          foreground: pair.foreground,
          background: pair.background,
          contrastRatio: ratio,
          requiredRatio,
          passed: ratio >= requiredRatio,
          formatDetected,
        });
      }

      if (inputData.rawTokens) {
        for (const [tokenName, rawVal] of Object.entries(inputData.rawTokens)) {
          const val = rawVal.trim();
          if (val.startsWith("var(--")) {
            continue;
          }
          const parsed = parseColorToLinearRgb(val);
          if (!parsed.linear) {
            invalidTokens.push({
              token: tokenName,
              value: rawVal,
              reason: "Token de cor inválido ou não reconhecido.",
            });
          } else if (parsed.format === "hex" || parsed.format === "rgb") {
            hardcodedSet.add(`${tokenName}:${val}`);
          }
        }
      }

      return ColorContrastValidationOutputSchema.parse({
        allPassed: results.every((r) => r.passed) && invalidTokens.length === 0,
        results: results.slice(0, 50),
        invalidTokens: invalidTokens.slice(0, 50),
        hardcodedColorsDetected: Array.from(hardcodedSet).slice(0, 50),
      });
    },
  });

  // 10. read_security_scan_findings
  const readSecurityScanFindingsTool = createTool({
    id: "read_security_scan_findings",
    description:
      "Consulta achados de segurança (securityScans + securityFindings) com filtros por severidade, scanner e veredito de triagem.",
    inputSchema: SecurityFindingsQueryInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      if (inputData.deliverableId) {
        await assertDeliverableInProject(
          deps.db,
          inputData.deliverableId,
          proj.id
        );
      }

      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const scanConditions = [
        eq(securityScans.organizationId, actor.organizationId),
        eq(securityScans.projectId, proj.id),
      ];
      if (inputData.deliverableId) {
        scanConditions.push(
          eq(securityScans.deliverableId, inputData.deliverableId)
        );
      }
      if (inputData.scanId) {
        scanConditions.push(eq(securityScans.id, inputData.scanId));
      }

      const scans = await deps.db
        .select()
        .from(securityScans)
        .where(and(...scanConditions))
        .orderBy(desc(securityScans.createdAt))
        .limit(20);

      if (scans.length === 0) {
        return SecurityFindingsQueryOutputSchema.parse({
          projectId: proj.id,
          totalMatching: 0,
          hasMore: false,
          findings: [],
          scannerStatuses: [],
        });
      }

      const scanIds = scans.map((s) => s.id);
      const findingConditions = [inArray(securityFindings.scanId, scanIds)];
      if (inputData.severities && inputData.severities.length > 0) {
        findingConditions.push(
          inArray(securityFindings.severity, inputData.severities)
        );
      }
      if (inputData.scanner) {
        findingConditions.push(eq(securityFindings.scanner, inputData.scanner));
      }
      if (inputData.verdict) {
        findingConditions.push(
          eq(securityFindings.triageVerdict, inputData.verdict)
        );
      }

      const allMatching = await deps.db
        .select()
        .from(securityFindings)
        .where(and(...findingConditions))
        .orderBy(desc(securityFindings.createdAt));

      const paged = allMatching.slice(
        inputData.offset,
        inputData.offset + inputData.limit
      );

      const findings: SecurityFindingDTO[] = paged.map((row) => ({
        id: row.id,
        scanId: row.scanId,
        projectId: row.projectId ?? null,
        ruleId: row.ruleId,
        scanner: row.scanner,
        severity: row.severity,
        filePath: row.filePath
          ? redactSensitiveText(row.filePath, knownSecrets)
          : null,
        lineStart: row.lineStart ?? null,
        title: redactSensitiveText(row.title, knownSecrets),
        description: redactSensitiveText(row.description, knownSecrets),
        fingerprint: row.fingerprint,
        triageVerdict: row.triageVerdict,
        triageRationale: row.triageRationale
          ? redactSensitiveText(row.triageRationale, knownSecrets)
          : null,
        suppressedInMemory: row.suppressedInMemory,
        povTestStatus: row.povTestStatus,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));

      return SecurityFindingsQueryOutputSchema.parse({
        projectId: proj.id,
        totalMatching: allMatching.length,
        hasMore: inputData.offset + findings.length < allMatching.length,
        findings,
        scannerStatuses: (scans[0]?.scannerStatusesJson ?? []).slice(0, 20),
      });
    },
  });

  // 11. read_deliverable_evidence_and_diff
  const readDeliverableEvidenceAndDiffTool = createTool({
    id: "read_deliverable_evidence_and_diff",
    description:
      "Lê EvidencePack, diff semântico (fileDiffs) e saída de testes de um entregável com redação estrita de segredos.",
    inputSchema: DeliverableEvidenceReadInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );
      const deliv = await assertDeliverableInProject(
        deps.db,
        inputData.deliverableId,
        proj.id
      );

      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const parsedPack = EvidencePackSchema.safeParse(deliv.evidencePackJson);
      if (!parsedPack.success) {
        return DeliverableEvidenceReadOutputSchema.parse({
          deliverableId: deliv.id,
          found: false,
          verifyAttempts: deliv.verifyAttempts,
          verifyPassed: false,
          verifierVerdict: null,
          diffSummary: null,
          testCommandOutput: null,
          redactedSecretsCount: 0,
        });
      }

      const pack = parsedPack.data;
      const redactedPreviewRaw = redactSensitiveText(
        pack.diffSummary.preview,
        knownSecrets
      );
      const cappedPreview = truncateUtf8ByBytes(
        redactedPreviewRaw,
        inputData.maxDiffBytes,
        "\n// ... [diff truncado]"
      );

      const rawFileDiffs = pack.diffSummary.fileDiffs ?? [];
      const cappedFileDiffs: SemanticDiffFile[] = rawFileDiffs
        .slice(0, inputData.fileDiffsLimit)
        .map((fd) => ({
          ...fd,
          filePath: redactSensitiveText(fd.filePath, knownSecrets),
          hunkPreview: redactSensitiveText(fd.hunkPreview, knownSecrets).slice(
            0,
            4096
          ),
        }));

      const rawTestOutput = pack.testCommandOutput
        ? redactSensitiveText(pack.testCommandOutput, knownSecrets)
        : null;
      const cappedTestOutput = rawTestOutput
        ? truncateUtf8ByBytes(
            rawTestOutput,
            inputData.maxTestOutputBytes,
            "\n... [test output truncado]"
          )
        : null;

      let redactedSecretsCount = countRedactedMarkers(cappedPreview.text);
      if (cappedTestOutput) {
        redactedSecretsCount += countRedactedMarkers(cappedTestOutput.text);
      }
      for (const fd of cappedFileDiffs) {
        redactedSecretsCount += countRedactedMarkers(fd.hunkPreview);
      }

      return DeliverableEvidenceReadOutputSchema.parse({
        deliverableId: deliv.id,
        found: true,
        verifyAttempts: pack.verifyAttempts,
        verifyPassed: pack.verifyPassed,
        verifierVerdict: pack.verifierVerdict,
        diffSummary: {
          filesChanged: pack.diffSummary.filesChanged,
          diffBytes: pack.diffSummary.diffBytes,
          preview: cappedPreview.text,
          fileDiffs: cappedFileDiffs,
          truncated:
            cappedPreview.truncated ||
            rawFileDiffs.length > inputData.fileDiffsLimit,
        },
        testCommandOutput: cappedTestOutput ? cappedTestOutput.text : null,
        redactedSecretsCount,
      });
    },
  });

  // 12. run_test_anti_pattern_audit
  const runTestAntiPatternAuditTool = createTool({
    id: "run_test_anti_pattern_audit",
    description:
      "Executa auditoria estática somente leitura de anti-padrões de testes (auditTestDirectory) no repositório ou worktree.",
    inputSchema: TestAntiPatternAuditInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      let delivWorktree: string | null = null;
      if (inputData.deliverableId) {
        const deliv = await assertDeliverableInProject(
          deps.db,
          inputData.deliverableId,
          proj.id
        );
        delivWorktree = deliv.worktreePath ?? null;
      }

      const [repo] = await deps.db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, proj.id))
        .limit(1);

      const candidateRoot =
        delivWorktree && fs.existsSync(/*turbopackIgnore: true*/ delivWorktree)
          ? delivWorktree
          : deps.workspaceRoot ?? repo?.localPath ?? null;

      if (
        !candidateRoot ||
        !fs.existsSync(/*turbopackIgnore: true*/ candidateRoot)
      ) {
        return TestAntiPatternAuditOutputSchema.parse({
          passed: true,
          scannedFiles: 0,
          scannedTests: 0,
          suppressedCount: 0,
          violations: [],
          truncated: false,
        });
      }

      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      let report: TestAuditReport;
      if (inputData.relativePaths && inputData.relativePaths.length > 0) {
        const subReports: TestAuditReport[] = [];
        for (const rel of inputData.relativePaths) {
          const safeAbs = assertSafeNonSymlinkFileInsideWorkspace(
            candidateRoot,
            rel
          );
          if (!fs.existsSync(/*turbopackIgnore: true*/ safeAbs)) {
            continue;
          }
          const st = fs.lstatSync(/*turbopackIgnore: true*/ safeAbs);
          if (st.isDirectory()) {
            subReports.push(auditTestDirectory(safeAbs));
          } else if (st.isFile()) {
            const content = fs.readFileSync(
              /*turbopackIgnore: true*/ safeAbs,
              "utf8"
            );
            subReports.push(
              auditTestSource(rel.replace(/\\/g, "/"), content)
            );
          }
        }
        report =
          subReports.length > 0
            ? mergeTestAuditReports(subReports)
            : {
                passed: true,
                scannedFiles: 0,
                scannedTests: 0,
                suppressedCount: 0,
                violations: [],
              };
      } else {
        report = auditTestDirectory(candidateRoot);
      }

      const redactedViolations = report.violations
        .slice(0, inputData.limit)
        .map((v) => ({
          ...v,
          filePath: redactSensitiveText(v.filePath, knownSecrets),
          testTitle: redactSensitiveText(v.testTitle, knownSecrets),
          message: redactSensitiveText(v.message, knownSecrets),
        }));

      return TestAntiPatternAuditOutputSchema.parse({
        passed: report.passed,
        scannedFiles: report.scannedFiles,
        scannedTests: report.scannedTests,
        suppressedCount: report.suppressedCount,
        violations: redactedViolations,
        truncated: report.violations.length > inputData.limit,
      });
    },
  });

  // 13. inspect_worktrees_and_locks
  const inspectWorktreesAndLocksTool = createTool({
    id: "inspect_worktrees_and_locks",
    description:
      "Inspeciona Git worktrees ativos/órfãos e locks semânticos de símbolos no projeto.",
    inputSchema: WorktreesAndLocksSnapshotInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      const [repos, delivs] = await Promise.all([
        deps.db
          .select()
          .from(projectRepositories)
          .where(eq(projectRepositories.projectId, proj.id)),
        deps.db
          .select()
          .from(deliverables)
          .where(eq(deliverables.projectId, proj.id)),
      ]);

      const items: Array<{
        deliverableId: string;
        branchName: string;
        workspacePath: string;
        isOrphan: boolean;
        status: string;
      }> = [];

      for (const repo of repos) {
        const entries = await listProjectWorktrees(repo.localPath);
        for (const entry of entries) {
          const matchedDeliv =
            delivs.find(
              (d) =>
                (d.worktreePath &&
                  path.resolve(d.worktreePath) ===
                    path.resolve(entry.worktreePath)) ||
                (!entry.isMain &&
                  entry.branchName &&
                  d.branchName === entry.branchName)
            ) ?? null;

          const isOrphan =
            !entry.isMain &&
            (!matchedDeliv ||
              matchedDeliv.status === "merged" ||
              matchedDeliv.status === "failed" ||
              matchedDeliv.status === "approved");

          if (inputData.includeOrphansOnly && !isOrphan) {
            continue;
          }

          items.push({
            deliverableId:
              matchedDeliv?.id ?? (entry.isMain ? "main" : "orphan"),
            branchName:
              entry.branchName ??
              (entry.isMain ? repo.defaultBranch : "detached"),
            workspacePath: entry.worktreePath,
            isOrphan,
            status: matchedDeliv?.status ?? (entry.isMain ? "main" : "orphan"),
          });
        }
      }

      const activeLocks = (
        deps.symbolLockManager?.listActiveLocks(proj.id) ?? []
      )
        .slice(0, 200)
        .map((lock) => ({
          symbolKey: lock.symbol,
          ownerDeliverableId: lock.deliverableId,
          acquiredAt: new Date(lock.acquiredAt).toISOString(),
          expiresAt: null,
        }));

      const queuedDeliverablesCount = delivs.filter(
        (d) =>
          d.status === "paused" ||
          ((d.status === "contract_tests" || d.status === "building") &&
            !d.lockedBy)
      ).length;

      return WorktreesAndLocksSnapshotOutputSchema.parse({
        projectId: proj.id,
        worktrees: items.slice(0, inputData.limit),
        activeSymbolLocks: activeLocks,
        queuedDeliverablesCount,
      });
    },
  });

  // 14. distill_retrospective_memory
  const distillRetrospectiveMemoryTool = createTool({
    id: "distill_retrospective_memory",
    description:
      "Persiste aprendizados destilados de retrospectiva na Memória QMD do projeto (proibido para perfil auditor).",
    inputSchema: DistillRetrospectiveMemoryInputSchema,
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      if (!WRITE_ROLES.has(actor.role)) {
        throw new Error(
          "Permissão insuficiente: perfil auditor não pode gravar memórias retrospectivas."
        );
      }

      const proj = await assertProjectScopeForTool(
        deps.db,
        inputData.projectId,
        actor.organizationId
      );

      if (inputData.deliverableId) {
        await assertDeliverableInProject(
          deps.db,
          inputData.deliverableId,
          proj.id
        );
      }

      const knownSecrets = await collectOrgSecretsSafe(
        deps.db,
        actor.organizationId,
        deps.masterKey
      );

      const safeTitle = redactSensitiveText(inputData.title, knownSecrets);
      const safeContent = redactSensitiveText(
        `[Retrospectiva:${inputData.sourceTrigger}] ${inputData.content}`,
        knownSecrets
      );

      const saved = await createMemoryScoped(deps.db, {
        organizationId: actor.organizationId,
        input: {
          scopeType: "project",
          scopeId: proj.id,
          category: inputData.category,
          title: safeTitle,
          content: safeContent,
          sourceDeliverableId: inputData.deliverableId ?? null,
        },
      });

      return DistillRetrospectiveMemoryOutputSchema.parse({
        persisted: true,
        memoryId: saved.id,
        scopeType: saved.scopeType,
        category: saved.category,
        title: saved.title,
        qmdReindexed: true,
      });
    },
  });

  return {
    trace_symbol_call_graph: traceSymbolCallGraphTool,
    analyze_change_impact: analyzeChangeImpactTool,
    read_symbol_source_slice: readSymbolSourceSliceTool,
    check_dependency_boundaries: checkDependencyBoundariesTool,
    check_requirement_conflicts: checkRequirementConflictsTool,
    read_finops_and_risk_digest: readFinopsAndRiskDigestTool,
    read_design_system_contract: readDesignSystemContractTool,
    inspect_prototype_version: inspectPrototypeVersionTool,
    validate_color_contrast_and_tokens: validateColorContrastAndTokensTool,
    read_security_scan_findings: readSecurityScanFindingsTool,
    read_deliverable_evidence_and_diff: readDeliverableEvidenceAndDiffTool,
    run_test_anti_pattern_audit: runTestAntiPatternAuditTool,
    inspect_worktrees_and_locks: inspectWorktreesAndLocksTool,
    distill_retrospective_memory: distillRetrospectiveMemoryTool,
  };
}

export function selectRoleSpecializedTools(params: {
  allTools: ToolsInput;
  role: AgencyAgentRole;
  actorRole: OrgRole;
}): ToolsInput {
  const selected: ToolsInput = {};
  const pick = (id: string) => {
    const tool = params.allTools[id];
    if (tool) {
      selected[id] = tool;
    }
  };

  if (
    params.role === "software_architect" ||
    params.role === "tech_lead" ||
    params.role === "qa_appsec"
  ) {
    pick("trace_symbol_call_graph");
    pick("analyze_change_impact");
    pick("read_symbol_source_slice");
    pick("check_dependency_boundaries");
  }

  if (params.role === "product_discovery" || params.role === "orchestrator") {
    pick("check_requirement_conflicts");
    pick("read_finops_and_risk_digest");
  }

  if (params.role === "ux_designer") {
    pick("read_design_system_contract");
    pick("inspect_prototype_version");
    pick("validate_color_contrast_and_tokens");
  }

  if (params.role === "qa_appsec") {
    pick("read_security_scan_findings");
    pick("read_deliverable_evidence_and_diff");
    pick("run_test_anti_pattern_audit");
  }

  if (params.role === "orchestrator") {
    pick("inspect_worktrees_and_locks");
    if (WRITE_ROLES.has(params.actorRole)) {
      pick("distill_retrospective_memory");
    }
  }

  return selected;
}
