import {
  decryptSecret,
  parseMasterKeyBuffer,
  redactSensitiveText,
  resolveMasterKey,
} from "@uzina/core";
import { providerProfiles, type UzinaDb } from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";

export interface GitHubOwnerRepo {
  owner: string;
  repo: string;
}

const VALID_GITHUB_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

function isValidGitHubSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("..") &&
    VALID_GITHUB_SEGMENT_RE.test(value)
  );
}

/**
 * Extrai `{ owner, repo }` estritamente para remotes `github.com` (anti-SSRF).
 * Aceita HTTPS (`https://github.com/owner/repo.git`) e SSH (`git@github.com:owner/repo.git`).
 */
export function parseGitHubOwnerRepo(remoteUrl: string): GitHubOwnerRepo | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  const sshMatch =
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    const owner = sshMatch[1] ?? "";
    const repo = (sshMatch[2] ?? "").replace(/\.git$/i, "");
    if (isValidGitHubSegment(owner) && isValidGitHubSegment(repo)) {
      return { owner, repo };
    }
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") ||
      parsed.hostname.toLowerCase() !== "github.com"
    ) {
      return null;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) {
      return null;
    }
    const owner = segments[0] ?? "";
    const repo = (segments[1] ?? "").replace(/\.git$/i, "");
    if (isValidGitHubSegment(owner) && isValidGitHubSegment(repo)) {
      return { owner, repo };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Descriptografa o GitHub PAT opcional armazenado no Cofre AES-256-GCM da organização.
 */
export async function resolveOrganizationGitHubPat(
  db: UzinaDb,
  params: {
    organizationId: string;
    masterKey?: Buffer | string | null;
    env?: NodeJS.ProcessEnv;
  }
): Promise<string | null> {
  const rows = await db
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.organizationId, params.organizationId),
        eq(providerProfiles.providerType, "github_pat")
      )
    )
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.updatedAt));

  const profile = rows.find((r) => Boolean(r.encryptedApiKey));
  if (!profile?.encryptedApiKey) {
    return null;
  }

  let mk: Buffer;
  try {
    if (Buffer.isBuffer(params.masterKey)) {
      mk = params.masterKey;
    } else if (
      typeof params.masterKey === "string" &&
      params.masterKey.trim().length > 0
    ) {
      mk = parseMasterKeyBuffer(params.masterKey);
    } else {
      const env = params.env ?? process.env;
      mk = resolveMasterKey(env, env.UZINA_DATA_DIR?.trim() || "./data");
    }

    const decrypted = decryptSecret({
      encrypted: profile.encryptedApiKey,
      masterKey: mk,
      organizationId: params.organizationId,
      providerType: "github_pat",
    }).trim();
    return decrypted.length > 0 ? decrypted : null;
  } catch {
    return null;
  }
}

export interface CreateGitHubDraftPrResult {
  ok: boolean;
  prUrl: string | null;
  number?: number;
  error?: string;
}

/**
 * Abre um Draft Pull Request via API REST do GitHub sem depender do binário local `gh`.
 */
export async function createGitHubDraftPrViaApi(params: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  pat: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<CreateGitHubDraftPrResult> {
  const pat = params.pat.trim();
  if (!pat) {
    return {
      ok: false,
      prUrl: null,
      error: "GitHub PAT ausente ou vazio.",
    };
  }
  if (!isValidGitHubSegment(params.owner) || !isValidGitHubSegment(params.repo)) {
    return {
      ok: false,
      prUrl: null,
      error: "Owner ou repositório GitHub inválido.",
    };
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(
    params.owner
  )}/${encodeURIComponent(params.repo)}/pulls`;

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(params.signal?.reason);
  if (params.signal) {
    if (params.signal.aborted) {
      return {
        ok: false,
        prUrl: null,
        error: "Criação de Draft PR cancelada por AbortSignal.",
      };
    }
    params.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "Uzina-Studio",
      },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
        draft: true,
      }),
      signal: controller.signal,
    });

    const json = (await response.json().catch(() => null)) as {
      html_url?: string;
      number?: number;
      message?: string;
    } | null;

    if (!response.ok) {
      const rawErr =
        json?.message ?? `GitHub REST API retornou HTTP ${response.status}.`;
      return {
        ok: false,
        prUrl: null,
        error: redactSensitiveText(rawErr, [pat]).slice(0, 380),
      };
    }

    return {
      ok: true,
      prUrl: typeof json?.html_url === "string" ? json.html_url : null,
      ...(typeof json?.number === "number" ? { number: json.number } : {}),
    };
  } catch (err) {
    const rawMsg =
      err instanceof Error
        ? err.message
        : "Falha de rede ao criar Draft PR no GitHub.";
    return {
      ok: false,
      prUrl: null,
      error: redactSensitiveText(rawMsg, [pat]).slice(0, 380),
    };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", forwardAbort);
  }
}
