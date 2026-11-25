import type { SemanticDiffCategory, SemanticDiffFile } from "@uzina/contracts";
import { redactSensitiveText } from "./redact.js";

const DOCS_EXTENSIONS = /\.(md|mdx|txt|rst|adoc)$/i;
const TEST_PATH_PATTERN =
  /(^|\/)(__tests__|tests?|e2e|spec)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i;
const CONFIG_NAME_PATTERN =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig[^/]*\.json|dockerfile[^/]*|docker-compose[^/]*\.ya?ml|\.env[^/]*|\.eslintrc[^/]*|eslint\.config\.[a-z]+|prettier[^/]*|vitest\.config\.[a-z]+|playwright\.config\.[a-z]+|drizzle\.config\.[a-z]+|next\.config\.[a-z]+|tailwind\.config\.[a-z]+|postcss\.config\.[a-z]+)$/i;
const CONFIG_EXTENSIONS = /\.(json|ya?ml|toml|ini|conf|lock)$/i;

export function classifyDiffFileCategory(
  filePath: string
): SemanticDiffCategory {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (TEST_PATH_PATTERN.test(normalized)) {
    return "test";
  }
  if (DOCS_EXTENSIONS.test(normalized) || /(^|\/)docs(\/|$)/i.test(normalized)) {
    return "docs";
  }
  if (
    CONFIG_NAME_PATTERN.test(normalized) ||
    CONFIG_EXTENSIONS.test(normalized)
  ) {
    return "config";
  }
  return "code";
}

export interface ParseUnifiedDiffOptions {
  maxFiles?: number;
  maxHunkChars?: number;
  knownSecrets?: readonly (string | null | undefined)[];
}

export function parseUnifiedDiffSemantic(
  rawDiff: string,
  options: ParseUnifiedDiffOptions = {}
): SemanticDiffFile[] {
  const trimmed = rawDiff.trim();
  if (!trimmed) {
    return [];
  }

  const maxFiles = Math.min(Math.max(options.maxFiles ?? 200, 1), 200);
  const maxHunkChars = Math.min(Math.max(options.maxHunkChars ?? 4096, 32), 4096);

  const chunks: string[] = [];
  let currentLines: string[] = [];

  for (const line of rawDiff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (currentLines.length > 0) {
        chunks.push(currentLines.join("\n"));
      }
      currentLines = [line];
    } else if (currentLines.length > 0 || line.startsWith("--- ")) {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    chunks.push(currentLines.join("\n"));
  }

  const results: SemanticDiffFile[] = [];

  for (const chunk of chunks) {
    if (results.length >= maxFiles) {
      break;
    }

    const lines = chunk.split(/\r?\n/);
    let oldPath = "";
    let newPath = "";
    let additions = 0;
    let deletions = 0;
    const hunkLines: string[] = [];
    let inHunk = false;

    for (const line of lines) {
      if (line.startsWith("diff --git ")) {
        const match = /^diff --git a\/(.+?)\s+b\/(.+)$/.exec(line);
        if (match) {
          oldPath = match[1] ?? oldPath;
          newPath = match[2] ?? newPath;
        }
        continue;
      }
      if (line.startsWith("--- ")) {
        const candidate = line.slice(4).trim().replace(/^a\//, "");
        if (candidate && candidate !== "/dev/null") {
          oldPath = candidate;
        }
        continue;
      }
      if (line.startsWith("+++ ")) {
        const candidate = line.slice(4).trim().replace(/^b\//, "");
        if (candidate && candidate !== "/dev/null") {
          newPath = candidate;
        }
        continue;
      }
      if (line.startsWith("@@ ")) {
        inHunk = true;
        hunkLines.push(line);
        continue;
      }
      if (inHunk) {
        hunkLines.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) {
          additions += 1;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions += 1;
        }
      }
    }

    const resolvedPath = (newPath || oldPath || "").trim();
    if (!resolvedPath) {
      continue;
    }

    const rawPreview = (hunkLines.length > 0 ? hunkLines : lines).join("\n");
    const redactedPreview = redactSensitiveText(
      rawPreview,
      options.knownSecrets
    ).slice(0, maxHunkChars);

    results.push({
      filePath: resolvedPath.slice(0, 512),
      category: classifyDiffFileCategory(resolvedPath),
      additions,
      deletions,
      hunkPreview: redactedPreview,
    });
  }

  return results;
}
