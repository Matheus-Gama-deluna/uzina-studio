import {
  DastPassiveReportSchema,
  type DastHeaderCheck,
  type DastPassiveReport,
  type ScannerExecutionRecord,
  type SecuritySeverity,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import {
  assertSafeScanArg,
  defaultCommandRunner,
  sanitizeAdapterText,
  type ExternalCommandRunner,
} from "./adapters.js";
import { assertDastTargetAllowed, type DastGuardOptions } from "./dast-guard.js";
import {
  computeFindingFingerprint,
  redactFindingFields,
  type RawNormalizedFinding,
} from "./sarif.js";

export interface RunPassiveDastOptions {
  targetUrl: string;
  dastGuard: DastGuardOptions;
  fetchImpl?: typeof fetch;
  commandRunner?: ExternalCommandRunner;
  includeHttpPassive?: boolean;
  includeNuclei?: boolean;
  timeoutMs?: number;
  nucleiTimeoutMs?: number;
  signal?: AbortSignal;
  maxRedirects?: number;
}

export interface PassiveDastResult {
  report: DastPassiveReport;
  findings: RawNormalizedFinding[];
  scannerStatuses: ScannerExecutionRecord[];
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_NUCLEI_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;

function createTimeoutController(
  timeoutMs: number,
  parentSignal?: AbortSignal
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timeout DAST excedido (${timeoutMs}ms).`));
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  return {
    controller,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function makeDastFinding(params: {
  ruleId: string;
  scanner?: string;
  severity: SecuritySeverity;
  targetUrl: string;
  title: string;
  description: string;
  rawSnippet: string;
}): RawNormalizedFinding {
  const scanner = params.scanner ?? "dast_passive";
  const fingerprint = computeFindingFingerprint({
    ruleId: params.ruleId,
    scanner,
    filePath: params.targetUrl,
    lineStart: null,
    rawSnippet: params.rawSnippet,
  });
  return redactFindingFields({
    ruleId: params.ruleId,
    scanner,
    severity: params.severity,
    filePath: params.targetUrl,
    lineStart: null,
    title: params.title,
    description: params.description,
    fingerprint,
  });
}

function evaluateSecurityHeaders(
  headers: Headers,
  targetUrl: URL
): {
  checks: DastHeaderCheck[];
  findings: RawNormalizedFinding[];
} {
  const checks: DastHeaderCheck[] = [];
  const findings: RawNormalizedFinding[] = [];
  const urlStr = targetUrl.toString();

  // 1. Content-Security-Policy
  const cspRaw = headers.get("content-security-policy");
  if (!cspRaw || !cspRaw.trim()) {
    checks.push({
      header: "Content-Security-Policy",
      present: false,
      value: null,
      status: "missing",
      severity: "medium",
      recommendation:
        "Configure Content-Security-Policy restritivo (ex.: default-src 'self'; object-src 'none').",
    });
    findings.push(
      makeDastFinding({
        ruleId: "uzina/dast-missing-csp",
        severity: "medium",
        targetUrl: urlStr,
        title: "Header Content-Security-Policy ausente",
        description: `Resposta HTTP de ${urlStr} não define Content-Security-Policy, aumentando exposição a XSS.`,
        rawSnippet: `missing:Content-Security-Policy:${urlStr}`,
      })
    );
  } else {
    const lowerCsp = cspRaw.toLowerCase();
    const isWeakCsp =
      lowerCsp.includes("'unsafe-inline'") ||
      lowerCsp.includes("'unsafe-eval'") ||
      /(?:default-src|script-src)\s+[^;]*\*/.test(lowerCsp);
    checks.push({
      header: "Content-Security-Policy",
      present: true,
      value: cspRaw.slice(0, 1000),
      status: isWeakCsp ? "misconfigured" : "ok",
      severity: isWeakCsp ? "medium" : "info",
      recommendation: isWeakCsp
        ? "Remova 'unsafe-inline', 'unsafe-eval' e wildcards (*) do Content-Security-Policy."
        : "Header Content-Security-Policy presente e sem diretivas inseguras óbvias.",
    });
    if (isWeakCsp) {
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-weak-csp",
          severity: "medium",
          targetUrl: urlStr,
          title: "Content-Security-Policy permissivo detectado",
          description: `CSP em ${urlStr} contém diretivas permissivas ('unsafe-inline'/'unsafe-eval' ou wildcard): ${cspRaw.slice(0, 240)}`,
          rawSnippet: `weak:csp:${cspRaw.slice(0, 200)}`,
        })
      );
    }
  }

  // 2. Strict-Transport-Security
  const hstsRaw = headers.get("strict-transport-security");
  const isHttps = targetUrl.protocol === "https:";
  if (!hstsRaw || !hstsRaw.trim()) {
    const severity: SecuritySeverity = isHttps ? "medium" : "low";
    checks.push({
      header: "Strict-Transport-Security",
      present: false,
      value: null,
      status: "missing",
      severity,
      recommendation:
        "Configure Strict-Transport-Security: max-age=31536000; includeSubDomains em HTTPS.",
    });
    findings.push(
      makeDastFinding({
        ruleId: "uzina/dast-missing-hsts",
        severity,
        targetUrl: urlStr,
        title: "Header Strict-Transport-Security (HSTS) ausente",
        description: `Resposta de ${urlStr} não declara Strict-Transport-Security.`,
        rawSnippet: `missing:Strict-Transport-Security:${urlStr}`,
      })
    );
  } else {
    const maxAgeMatch = hstsRaw.match(/max-age\s*=\s*(\d+)/i);
    const maxAge = maxAgeMatch?.[1] ? Number.parseInt(maxAgeMatch[1], 10) : 0;
    const isWeakHsts = !maxAgeMatch || maxAge <= 0;
    checks.push({
      header: "Strict-Transport-Security",
      present: true,
      value: hstsRaw.slice(0, 1000),
      status: isWeakHsts ? "misconfigured" : "ok",
      severity: isWeakHsts ? "medium" : "info",
      recommendation: isWeakHsts
        ? "Defina max-age >= 31536000 no Strict-Transport-Security."
        : "Header Strict-Transport-Security configurado adequadamente.",
    });
    if (isWeakHsts) {
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-weak-hsts",
          severity: "medium",
          targetUrl: urlStr,
          title: "Strict-Transport-Security com max-age inválido ou zerado",
          description: `HSTS em ${urlStr} apresenta valor fraco: ${hstsRaw.slice(0, 200)}`,
          rawSnippet: `weak:hsts:${hstsRaw}`,
        })
      );
    }
  }

  // 3. X-Content-Type-Options
  const xctoRaw = headers.get("x-content-type-options");
  if (!xctoRaw || !xctoRaw.trim()) {
    checks.push({
      header: "X-Content-Type-Options",
      present: false,
      value: null,
      status: "missing",
      severity: "low",
      recommendation: "Defina X-Content-Type-Options: nosniff.",
    });
    findings.push(
      makeDastFinding({
        ruleId: "uzina/dast-missing-x-content-type-options",
        severity: "low",
        targetUrl: urlStr,
        title: "Header X-Content-Type-Options ausente",
        description: `Resposta de ${urlStr} não envia X-Content-Type-Options: nosniff.`,
        rawSnippet: `missing:X-Content-Type-Options:${urlStr}`,
      })
    );
  } else {
    const isNosniff = xctoRaw.trim().toLowerCase() === "nosniff";
    checks.push({
      header: "X-Content-Type-Options",
      present: true,
      value: xctoRaw.slice(0, 1000),
      status: isNosniff ? "ok" : "misconfigured",
      severity: isNosniff ? "info" : "low",
      recommendation: isNosniff
        ? "X-Content-Type-Options configurado como nosniff."
        : "Altere X-Content-Type-Options para exatamente 'nosniff'.",
    });
    if (!isNosniff) {
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-misconfigured-x-content-type-options",
          severity: "low",
          targetUrl: urlStr,
          title: "Header X-Content-Type-Options mal configurado",
          description: `Valor esperado 'nosniff', recebido '${xctoRaw.slice(0, 120)}'.`,
          rawSnippet: `misconfigured:xcto:${xctoRaw}`,
        })
      );
    }
  }

  // 4. Referrer-Policy
  const refRaw = headers.get("referrer-policy");
  if (!refRaw || !refRaw.trim()) {
    checks.push({
      header: "Referrer-Policy",
      present: false,
      value: null,
      status: "missing",
      severity: "low",
      recommendation:
        "Configure Referrer-Policy: strict-origin-when-cross-origin ou no-referrer.",
    });
    findings.push(
      makeDastFinding({
        ruleId: "uzina/dast-missing-referrer-policy",
        severity: "low",
        targetUrl: urlStr,
        title: "Header Referrer-Policy ausente",
        description: `Resposta de ${urlStr} não define Referrer-Policy.`,
        rawSnippet: `missing:Referrer-Policy:${urlStr}`,
      })
    );
  } else {
    const isUnsafe = refRaw.toLowerCase().includes("unsafe-url");
    checks.push({
      header: "Referrer-Policy",
      present: true,
      value: refRaw.slice(0, 1000),
      status: isUnsafe ? "misconfigured" : "ok",
      severity: isUnsafe ? "medium" : "info",
      recommendation: isUnsafe
        ? "Evite 'unsafe-url' em Referrer-Policy; prefira 'strict-origin-when-cross-origin'."
        : "Header Referrer-Policy configurado adequadamente.",
    });
    if (isUnsafe) {
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-weak-referrer-policy",
          severity: "medium",
          targetUrl: urlStr,
          title: "Referrer-Policy inseguro ('unsafe-url')",
          description: `Referrer-Policy em ${urlStr} vaza URL completa em navegações cross-origin.`,
          rawSnippet: `weak:referrer:${refRaw}`,
        })
      );
    }
  }

  return { checks, findings };
}

function evaluateCorsHeaders(
  headers: Headers,
  targetUrl: string
): {
  corsIssues: string[];
  findings: RawNormalizedFinding[];
} {
  const corsIssues: string[] = [];
  const findings: RawNormalizedFinding[] = [];

  const acao = headers.get("access-control-allow-origin")?.trim() ?? null;
  const acac =
    headers.get("access-control-allow-credentials")?.trim().toLowerCase() ?? null;

  if (acao === "*" && acac === "true") {
    const msg =
      "CORS inseguro: Access-Control-Allow-Origin: * combinado com Access-Control-Allow-Credentials: true.";
    corsIssues.push(msg);
    findings.push(
      makeDastFinding({
        ruleId: "uzina/dast-insecure-cors-wildcard-credentials",
        severity: "high",
        targetUrl,
        title: "Política CORS insegura (Origin * com Credentials true)",
        description: `${msg} Alvo: ${targetUrl}`,
        rawSnippet: `cors:*+credentials:${targetUrl}`,
      })
    );
  } else if (acao === "null") {
    const msg =
      "CORS inseguro: Access-Control-Allow-Origin: null permite bypass por origens sandboxed.";
    corsIssues.push(msg);
    findings.push(
      makeDastFinding({
        ruleId: "uzina/dast-insecure-cors-null-origin",
        severity: "medium",
        targetUrl,
        title: "Política CORS permite origem 'null'",
        description: `${msg} Alvo: ${targetUrl}`,
        rawSnippet: `cors:null:${targetUrl}`,
      })
    );
  }

  return { corsIssues, findings };
}

function evaluateSetCookies(
  headers: Headers,
  targetUrl: string
): {
  cookieIssues: string[];
  findings: RawNormalizedFinding[];
} {
  const cookieIssues: string[] = [];
  const findings: RawNormalizedFinding[] = [];
  const cookies = getSetCookieHeaders(headers);

  for (const rawCookie of cookies) {
    const parts = rawCookie.split(";").map((part) => part.trim());
    const nameValue = parts[0] ?? "";
    const eqIdx = nameValue.indexOf("=");
    const cookieName =
      (eqIdx > 0 ? nameValue.slice(0, eqIdx) : nameValue).trim() || "unnamed_cookie";
    const attrs = parts.slice(1).map((attr) => attr.toLowerCase());

    const hasHttpOnly = attrs.includes("httponly");
    const hasSecure = attrs.includes("secure");
    const sameSiteAttr = attrs.find((attr) => attr.startsWith("samesite="));

    if (!hasHttpOnly) {
      const msg = `Cookie '${cookieName}' emitido sem flag HttpOnly.`;
      cookieIssues.push(msg);
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-cookie-missing-httponly",
          severity: "medium",
          targetUrl,
          title: `Cookie '${cookieName}' sem atributo HttpOnly`,
          description: `${msg} Cookies sem HttpOnly ficam acessíveis via document.cookie em XSS.`,
          rawSnippet: `cookie:${cookieName}:no-httponly`,
        })
      );
    }

    if (!hasSecure) {
      const msg = `Cookie '${cookieName}' emitido sem flag Secure.`;
      cookieIssues.push(msg);
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-cookie-missing-secure",
          severity: "medium",
          targetUrl,
          title: `Cookie '${cookieName}' sem atributo Secure`,
          description: `${msg} Cookies sem Secure podem trafegar em conexões HTTP não criptografadas.`,
          rawSnippet: `cookie:${cookieName}:no-secure`,
        })
      );
    }

    if (!sameSiteAttr) {
      const msg = `Cookie '${cookieName}' emitido sem atributo SameSite.`;
      cookieIssues.push(msg);
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-cookie-missing-samesite",
          severity: "low",
          targetUrl,
          title: `Cookie '${cookieName}' sem atributo SameSite`,
          description: `${msg} Defina SameSite=Lax ou SameSite=Strict para mitigar CSRF.`,
          rawSnippet: `cookie:${cookieName}:no-samesite`,
        })
      );
    } else if (sameSiteAttr === "samesite=none" && !hasSecure) {
      const msg = `Cookie '${cookieName}' usa SameSite=None sem flag Secure.`;
      cookieIssues.push(msg);
      findings.push(
        makeDastFinding({
          ruleId: "uzina/dast-cookie-samesite-none-insecure",
          severity: "high",
          targetUrl,
          title: `Cookie '${cookieName}' com SameSite=None sem Secure`,
          description: msg,
          rawSnippet: `cookie:${cookieName}:samesite-none-no-secure`,
        })
      );
    }
  }

  return { cookieIssues, findings };
}

function mapNucleiSeverity(raw: unknown): SecuritySeverity {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  if (normalized === "low") return "low";
  return "info";
}

function parseNucleiJsonl(
  stdout: string,
  fallbackUrl: string
): RawNormalizedFinding[] {
  if (!stdout.trim()) {
    return [];
  }
  const findings: RawNormalizedFinding[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: {
      "template-id"?: string;
      "matched-at"?: string;
      info?: {
        name?: string;
        severity?: string;
        description?: string;
      };
    };
    try {
      parsed = JSON.parse(trimmed) as typeof parsed;
    } catch {
      continue;
    }

    const templateId = parsed["template-id"]?.trim() || "nuclei-finding";
    const ruleId = templateId.startsWith("nuclei/")
      ? templateId
      : `nuclei/${templateId}`;
    const matchedAt = parsed["matched-at"]?.trim() || fallbackUrl;
    const title = parsed.info?.name?.trim() || `Nuclei: ${templateId}`;
    const description =
      parsed.info?.description?.trim() ||
      `Template Nuclei '${templateId}' detectado em ${matchedAt}.`;

    findings.push(
      makeDastFinding({
        ruleId,
        scanner: "nuclei",
        severity: mapNucleiSeverity(parsed.info?.severity),
        targetUrl: matchedAt,
        title: redactSensitiveText(title),
        description: redactSensitiveText(description),
        rawSnippet: `${ruleId}::${matchedAt}`,
      })
    );
  }

  return findings;
}

export async function runPassiveDastScan(
  options: RunPassiveDastOptions
): Promise<PassiveDastResult> {
  const startedAt = Date.now();
  const allowedInitialUrl = await assertDastTargetAllowed(
    options.targetUrl,
    options.dastGuard
  );

  const fetchFn = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const includeHttpPassive = options.includeHttpPassive !== false;

  const findings: RawNormalizedFinding[] = [];
  const scannerStatuses: ScannerExecutionRecord[] = [];
  let currentUrl = allowedInitialUrl;
  let finalResponse: Response | null = null;
  let httpFailedMessage: string | null = null;

  if (includeHttpPassive) {
    const httpStartedAt = Date.now();
    try {
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const { controller, cleanup } = createTimeoutController(
          timeoutMs,
          options.signal
        );
        let resp: Response;
        try {
          resp = await fetchFn(currentUrl.toString(), {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "user-agent": "UzinaStudio-DAST-Passive/1.0",
            },
          });
        } finally {
          cleanup();
        }

        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get("location");
          await resp.body?.cancel?.().catch(() => undefined);
          if (location) {
            let nextUrl: URL;
            try {
              nextUrl = new URL(location, currentUrl);
            } catch {
              throw new Error(
                `Redirecionamento DAST inválido em Location: ${location}`
              );
            }
            // Anti-SSRF obrigatório antes de seguir qualquer redirecionamento
            currentUrl = await assertDastTargetAllowed(
              nextUrl.toString(),
              options.dastGuard
            );
            if (hop < maxRedirects) {
              continue;
            }
          }
        }

        finalResponse = resp;
        await resp.body?.cancel?.().catch(() => undefined);
        break;
      }
    } catch (error) {
      // Violações explícitas da trava anti-SSRF / allowlist devem abortar imediatamente
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Trava DAST") ||
        message.includes("Protocolo") ||
        message.includes("URL DAST") ||
        message.includes("Redirecionamento DAST")
      ) {
        throw error;
      }
      httpFailedMessage = sanitizeAdapterText(message);
    }

    let headerChecks: DastHeaderCheck[] = [];
    let corsIssues: string[] = [];
    let cookieIssues: string[] = [];

    if (finalResponse) {
      const headerEval = evaluateSecurityHeaders(
        finalResponse.headers,
        currentUrl
      );
      const corsEval = evaluateCorsHeaders(
        finalResponse.headers,
        currentUrl.toString()
      );
      const cookieEval = evaluateSetCookies(
        finalResponse.headers,
        currentUrl.toString()
      );

      headerChecks = headerEval.checks;
      corsIssues = corsEval.corsIssues;
      cookieIssues = cookieEval.cookieIssues;

      const passiveFindings = [
        ...headerEval.findings,
        ...corsEval.findings,
        ...cookieEval.findings,
      ];
      findings.push(...passiveFindings);

      scannerStatuses.push({
        scanner: "dast_passive",
        status: "executed",
        binaryName: null,
        installHint: null,
        findingsCount: passiveFindings.length,
        durationMs: Date.now() - httpStartedAt,
        errorMessage: null,
      });
    } else {
      scannerStatuses.push({
        scanner: "dast_passive",
        status: "failed",
        binaryName: null,
        installHint: null,
        findingsCount: 0,
        durationMs: Date.now() - httpStartedAt,
        errorMessage: httpFailedMessage ?? "Falha ao conectar no alvo DAST.",
      });
    }

    let nucleiFindingsCount = 0;
    if (options.includeNuclei !== false) {
      const safeNucleiUrl = assertSafeScanArg(
        "targetUrl",
        currentUrl.toString()
      );
      const runner = options.commandRunner ?? defaultCommandRunner;
      const nucleiRes = await runner(
        "nuclei",
        [
          "-u",
          safeNucleiUrl,
          "-tags",
          "misconfiguration,exposures",
          "-jsonl",
          "-silent",
          "-nc",
        ],
        {
          cwd: process.cwd(),
          timeoutMs: options.nucleiTimeoutMs ?? DEFAULT_NUCLEI_TIMEOUT_MS,
          signal: options.signal,
        }
      );

      if (nucleiRes.status === "missing_binary") {
        scannerStatuses.push({
          scanner: "nuclei",
          status: "skipped_missing_binary",
          binaryName: "nuclei",
          installHint: "uzina-sec install-tools (projectdiscovery/nuclei)",
          findingsCount: 0,
          durationMs: nucleiRes.durationMs,
          errorMessage: "Binário (nuclei) não encontrado no PATH.",
        });
      } else if (nucleiRes.status === "failed") {
        scannerStatuses.push({
          scanner: "nuclei",
          status: "failed",
          binaryName: "nuclei",
          installHint: "uzina-sec install-tools (projectdiscovery/nuclei)",
          findingsCount: 0,
          durationMs: nucleiRes.durationMs,
          errorMessage: sanitizeAdapterText(
            nucleiRes.stderr || "Erro ao executar nuclei."
          ),
        });
      } else {
        const nucleiFindings = parseNucleiJsonl(
          nucleiRes.stdout,
          currentUrl.toString()
        );
        nucleiFindingsCount = nucleiFindings.length;
        findings.push(...nucleiFindings);
        scannerStatuses.push({
          scanner: "nuclei",
          status: "executed",
          binaryName: "nuclei",
          installHint: null,
          findingsCount: nucleiFindings.length,
          durationMs: nucleiRes.durationMs,
          errorMessage: null,
        });
      }
    }

    const report = DastPassiveReportSchema.parse({
      targetUrl: currentUrl.toString(),
      statusCode: finalResponse ? finalResponse.status : null,
      executed: Boolean(finalResponse),
      status: finalResponse ? "executed" : "failed",
      headers: headerChecks,
      corsIssues,
      cookieIssues,
      nucleiFindingsCount,
      durationMs: Date.now() - startedAt,
    });

    return { report, findings, scannerStatuses };
  }

  // Modo somente Nuclei (quando includeHttpPassive === false)
  const safeNucleiUrl = assertSafeScanArg(
    "targetUrl",
    currentUrl.toString()
  );
  const runner = options.commandRunner ?? defaultCommandRunner;
  const nucleiRes = await runner(
    "nuclei",
    [
      "-u",
      safeNucleiUrl,
      "-tags",
      "misconfiguration,exposures",
      "-jsonl",
      "-silent",
      "-nc",
    ],
    {
      cwd: process.cwd(),
      timeoutMs: options.nucleiTimeoutMs ?? DEFAULT_NUCLEI_TIMEOUT_MS,
      signal: options.signal,
    }
  );

  let nucleiStatus: "executed" | "skipped_missing_binary" | "failed" =
    "executed";
  if (nucleiRes.status === "missing_binary") {
    nucleiStatus = "skipped_missing_binary";
    scannerStatuses.push({
      scanner: "nuclei",
      status: "skipped_missing_binary",
      binaryName: "nuclei",
      installHint: "uzina-sec install-tools (projectdiscovery/nuclei)",
      findingsCount: 0,
      durationMs: nucleiRes.durationMs,
      errorMessage: "Binário (nuclei) não encontrado no PATH.",
    });
  } else if (nucleiRes.status === "failed") {
    nucleiStatus = "failed";
    scannerStatuses.push({
      scanner: "nuclei",
      status: "failed",
      binaryName: "nuclei",
      installHint: "uzina-sec install-tools (projectdiscovery/nuclei)",
      findingsCount: 0,
      durationMs: nucleiRes.durationMs,
      errorMessage: sanitizeAdapterText(
        nucleiRes.stderr || "Erro ao executar nuclei."
      ),
    });
  } else {
    const nucleiFindings = parseNucleiJsonl(
      nucleiRes.stdout,
      currentUrl.toString()
    );
    findings.push(...nucleiFindings);
    scannerStatuses.push({
      scanner: "nuclei",
      status: "executed",
      binaryName: "nuclei",
      installHint: null,
      findingsCount: nucleiFindings.length,
      durationMs: nucleiRes.durationMs,
      errorMessage: null,
    });
  }

  const report = DastPassiveReportSchema.parse({
    targetUrl: currentUrl.toString(),
    statusCode: null,
    executed: nucleiStatus === "executed",
    status: nucleiStatus,
    headers: [],
    corsIssues: [],
    cookieIssues: [],
    nucleiFindingsCount: findings.length,
    durationMs: Date.now() - startedAt,
  });

  return { report, findings, scannerStatuses };
}
