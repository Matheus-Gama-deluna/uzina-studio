import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WINDOWS_RESERVED_NAME_RE =
  /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(\..*)?$/i;

const MAX_SYMLINK_DEPTH = 16;

export class WorkspaceBoundaryError extends Error {
  readonly code = "PATH_OUTSIDE_WORKSPACE" as const;

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export interface AssertPathOptions {
  followSymlinks?: boolean;
  allowRoot?: boolean;
}

function stripExtendedWindowsPrefix(p: string): string {
  if (p.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${p.slice("\\\\?\\UNC\\".length)}`;
  }
  if (p.startsWith("\\\\?\\")) {
    return p.slice("\\\\?\\".length);
  }
  return p;
}

function normalizeComparisonPath(p: string): string {
  const cleaned = stripExtendedWindowsPrefix(path.resolve(p));
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return null;
    }
    throw err;
  }
}

function realpathThroughNearestExistingAncestor(
  targetAbs: string,
  depth = 0
): string {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new WorkspaceBoundaryError(
      `Profundidade máxima de symlinks excedida ao resolver caminho: ${targetAbs}`
    );
  }

  const missingSegments: string[] = [];
  let cursor = targetAbs;

  for (;;) {
    const stat = lstatOrNull(cursor);
    if (stat === null) {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return stripExtendedWindowsPrefix(targetAbs);
      }
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
      continue;
    }

    if (stat.isSymbolicLink()) {
      try {
        const real = stripExtendedWindowsPrefix(fs.realpathSync.native(cursor));
        return missingSegments.length > 0
          ? path.join(real, ...missingSegments)
          : real;
      } catch {
        // Dangling symlink (destino ainda nao existe): resolve manualmente e segue recursivamente
        const rawTarget = fs.readlinkSync(cursor);
        const resolvedTarget = path.resolve(path.dirname(cursor), rawTarget);
        const chained =
          missingSegments.length > 0
            ? path.join(resolvedTarget, ...missingSegments)
            : resolvedTarget;
        return realpathThroughNearestExistingAncestor(chained, depth + 1);
      }
    }

    // Existe e nao e symlink na folha, mas um ancestral pode ser symlink
    const realAncestor = stripExtendedWindowsPrefix(
      fs.realpathSync.native(cursor)
    );
    return missingSegments.length > 0
      ? path.join(realAncestor, ...missingSegments)
      : realAncestor;
  }
}

function validateWindowsSafeSegments(rawTarget: string): void {
  const segments = rawTarget.split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    // NTFS Alternate Data Streams (permite apenas drive Windows no primeiro segmento, ex: C:)
    const colonIdx = seg.indexOf(":");
    if (colonIdx !== -1) {
      const isDrivePrefix = i === 0 && /^[a-zA-Z]:$/.test(seg);
      if (!isDrivePrefix) {
        throw new WorkspaceBoundaryError(
          `Caractere ':' / NTFS ADS não permitido em segmento de caminho: ${seg}`
        );
      }
    }

    // Remove trailing dots/spaces (inclusive antes da extensao) antes de checar nomes reservados do Windows
    const cleanFull = seg.replace(/[. ]+$/, "");
    const dotIdx = seg.indexOf(".");
    const basePart = (dotIdx === -1 ? seg : seg.slice(0, dotIdx)).replace(
      /[. ]+$/,
      ""
    );
    if (
      (cleanFull && WINDOWS_RESERVED_NAME_RE.test(cleanFull)) ||
      (basePart && WINDOWS_RESERVED_NAME_RE.test(basePart))
    ) {
      throw new WorkspaceBoundaryError(
        `Nome reservado do sistema não permitido: ${seg}`
      );
    }
  }
}

export function assertPathInsideWorkspace(
  workspaceRoot: string,
  targetPath: string,
  options: AssertPathOptions = {}
): string {
  const trimmedRoot = workspaceRoot.trim();
  const trimmedTarget = targetPath.trim();

  if (!trimmedRoot || !trimmedTarget) {
    throw new WorkspaceBoundaryError("Caminho de workspace ou alvo vazio.");
  }
  if (trimmedRoot.includes("\0") || trimmedTarget.includes("\0")) {
    throw new WorkspaceBoundaryError("Null byte não permitido em caminho.");
  }
  if (/^[\\/]{2}/.test(trimmedTarget)) {
    throw new WorkspaceBoundaryError(
      `Caminho UNC ou device path não permitido fora do workspace: ${targetPath}`
    );
  }
  if (/^[a-zA-Z]:(?![\\/])/.test(trimmedTarget)) {
    throw new WorkspaceBoundaryError(
      `Caminho drive-relative não permitido: ${targetPath}`
    );
  }

  validateWindowsSafeSegments(trimmedTarget);

  const rootAbs = path.resolve(trimmedRoot);
  const targetAbs = path.isAbsolute(trimmedTarget)
    ? path.resolve(trimmedTarget)
    : path.resolve(rootAbs, trimmedTarget);

  const followSymlinks = options.followSymlinks !== false;
  const effectiveRoot = followSymlinks
    ? realpathThroughNearestExistingAncestor(rootAbs)
    : stripExtendedWindowsPrefix(rootAbs);
  const effectiveTarget = followSymlinks
    ? realpathThroughNearestExistingAncestor(targetAbs)
    : stripExtendedWindowsPrefix(targetAbs);

  const cmpRoot = normalizeComparisonPath(effectiveRoot);
  const cmpTarget = normalizeComparisonPath(effectiveTarget);
  const rel = path.relative(cmpRoot, cmpTarget);

  if (
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    throw new WorkspaceBoundaryError(
      `Caminho escapa dos limites do workspace (${workspaceRoot}): ${targetPath}`
    );
  }
  if (rel === "" && !options.allowRoot) {
    throw new WorkspaceBoundaryError(
      "Operação requer arquivo ou subdiretório interno, não a raiz do workspace."
    );
  }

  return effectiveTarget;
}

export function sanitizeWorktreeSlug(
  input: string,
  uniqueSuffix?: string
): string {
  const ascii = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (uniqueSuffix !== undefined && uniqueSuffix.trim().length > 0) {
    const hash = crypto
      .createHash("sha256")
      .update(uniqueSuffix.trim())
      .digest("hex")
      .slice(0, 8);
    const maxBaseLen = 48 - hash.length - 1;
    const base = (ascii || "task").slice(0, maxBaseLen).replace(/-+$/g, "");
    return `${base || "task"}-${hash}`;
  }

  const trimmed = ascii.slice(0, 48).replace(/-+$/g, "");
  return trimmed || "task";
}

export function assertSafeGitRef(ref: string, label = "git ref"): string {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new WorkspaceBoundaryError(`${label} não pode ser vazio.`);
  }
  if (trimmed.startsWith("-")) {
    throw new WorkspaceBoundaryError(
      `${label} não pode iniciar com '-' (option injection): ${ref}`
    );
  }
  if (trimmed === "@" || trimmed.startsWith("/") || trimmed.endsWith("/")) {
    throw new WorkspaceBoundaryError(`${label} inválido: ${ref}`);
  }
  if (
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.includes("@{") ||
    trimmed.endsWith(".lock") ||
    trimmed.endsWith(".")
  ) {
    throw new WorkspaceBoundaryError(`${label} inválido: ${ref}`);
  }
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(trimmed)) {
    throw new WorkspaceBoundaryError(
      `${label} contém caracteres não permitidos: ${ref}`
    );
  }
  const segments = trimmed.split("/");
  for (const seg of segments) {
    if (!seg || seg.startsWith(".")) {
      throw new WorkspaceBoundaryError(
        `${label} contém segmento inválido: ${ref}`
      );
    }
  }
  return trimmed;
}
