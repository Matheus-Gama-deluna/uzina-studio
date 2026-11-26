import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--base-url") out.baseUrl = argv[i + 1];
    if (token === "--fixture-dir") out.fixtureDir = argv[i + 1];
    if (token === "--metrics-out") out.metricsOut = argv[i + 1];
  }
  return out;
}

function redactSecret(text, secret) {
  if (!secret || typeof text !== "string") return text;
  return text.split(secret).join("[REDACTED_KEY]");
}

function buildTinyWavBuffer(durationMs = 450, sampleRate = 16000) {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 4000
    );
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

function extractCookies(res) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  return setCookies
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function apiJson(baseUrl, route, opts = {}) {
  const startedAt = Date.now();
  const headers = {
    origin: baseUrl,
    ...(opts.body && !(opts.body instanceof FormData)
      ? { "content-type": "application/json" }
      : {}),
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(`${baseUrl}${route}`, {
    method: opts.method ?? "GET",
    headers,
    redirect: opts.redirect ?? "follow",
    body:
      opts.body instanceof FormData
        ? opts.body
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
  });
  const elapsedMs = Date.now() - startedAt;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, elapsedMs, json, text, headers: res.headers, res };
}

async function readSseStream(baseUrl, route, opts = {}) {
  const startedAt = Date.now();
  let firstEventMs = null;
  const res = await fetch(`${baseUrl}${route}`, {
    method: opts.method ?? "POST",
    headers: {
      origin: baseUrl,
      "content-type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
  });
  const events = [];
  const rawChunks = [];
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawChunks.push(chunk);
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim() || part.startsWith(":")) continue;
        if (firstEventMs === null) {
          firstEventMs = Date.now() - startedAt;
        }
        const dataLine = part
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (dataLine) {
          try {
            events.push(JSON.parse(dataLine.slice(5).trim()));
          } catch {
            // Ignora linha parcial
          }
        }
      }
    }
  }
  return {
    status: res.status,
    ttfbMs: firstEventMs,
    totalMs: Date.now() - startedAt,
    events,
    rawLength: rawChunks.join("").length,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args.baseUrl ?? "http://127.0.0.1:3050").replace(/\/+$/, "");
  const fixtureDir = path.resolve(args.fixtureDir);
  const metricsOut = args.metricsOut ? path.resolve(args.metricsOut) : null;
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const gabarito = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "gabarito.json"), "utf8")
  );

  const report = {
    startedAt: new Date().toISOString(),
    baseUrl,
    health: {},
    arc1_founder_gemini_voice: {},
    arc2_tech_lead_brownfield: {},
    arc3_rbac_ssrf_security: {},
    arc4_resilience_sse: {},
    errors: [],
  };

  try {
    // 0. Health & Auth Signup (Org A Owner + Org B Outsider)
    const healthPublic = await apiJson(baseUrl, "/api/health");
    report.health.public = {
      status: healthPublic.status,
      body: healthPublic.json,
    };

    const suffix = `${Date.now()}`;
    const ownerSignUp = await apiJson(baseUrl, "/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Fundador Live QA",
        email: `live-owner-${suffix}@uzina.local`,
        password: "UzinaLiveQa!2026",
      },
    });
    const ownerCookie = extractCookies(ownerSignUp.res);

    const outsiderSignUp = await apiJson(baseUrl, "/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Outsider Org B",
        email: `live-outsider-${suffix}@uzina.local`,
        password: "UzinaLiveQa!2026",
      },
    });
    const outsiderCookie = extractCookies(outsiderSignUp.res);

    const clientsRes = await apiJson(baseUrl, "/api/clients", {
      cookie: ownerCookie,
    });
    await apiJson(baseUrl, "/api/clients", { cookie: outsiderCookie });
    const defaultClientId = clientsRes.json?.items?.[0]?.id;

    const healthDetails = await apiJson(baseUrl, "/api/health/details", {
      cookie: ownerCookie,
    });
    report.health.details = {
      status: healthDetails.status,
      body: healthDetails.json,
    };

    // 1. Arco 1 — Cofre AES-256-GCM + Ping Gemini + Voz + Clínica VidaPlena
    if (geminiKey) {
      const providerCreate = await apiJson(baseUrl, "/api/providers", {
        method: "POST",
        cookie: ownerCookie,
        body: {
          name: "Google Gemini Live QA",
          providerType: "google",
          apiKey: geminiKey,
          isDefault: true,
          roleBindings: {
            discovery: { modelId: "gemini-2.5-flash" },
            architect: { modelId: "gemini-2.5-pro" },
            visual: { modelId: "gemini-2.5-flash" },
            builder: { modelId: "gemini-2.5-flash" },
            verifier: { modelId: "gemini-2.5-pro" },
            security: { modelId: "gemini-2.5-flash" },
            copilot: { modelId: "gemini-2.5-flash" },
          },
        },
      });
      const providerId = providerCreate.json?.id;
      const providerTest = providerId
        ? await apiJson(baseUrl, "/api/providers/test", {
            method: "POST",
            cookie: ownerCookie,
            body: { providerId, modelId: "gemini-2.5-flash" },
          })
        : null;

      report.arc1_founder_gemini_voice.providerVault = {
        createStatus: providerCreate.status,
        keyPreview: providerCreate.json?.keyPreview ?? null,
        pingStatus: providerTest?.status ?? null,
        pingElapsedMs: providerTest?.elapsedMs ?? null,
        pingResult: providerTest?.json ?? null,
      };
    } else {
      report.arc1_founder_gemini_voice.providerVault = {
        skipped: "GEMINI_API_KEY não informada no ambiente",
      };
    }

    // Greenfield Project: Clínica VidaPlena
    const greenfieldCreate = await apiJson(baseUrl, "/api/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        clientId: defaultClientId,
        name: `Clínica VidaPlena ${suffix}`,
        description:
          "Plataforma SaaS de agenda médica, prontuário LGPD e repasse financeiro.",
        defaultDevelopmentStrategy: "frontend_first_msw",
      },
    });
    const greenfieldId = greenfieldCreate.json?.id;

    // Share Target test
    const shareForm = new FormData();
    shareForm.set("title", "Ideia Clínica VidaPlena");
    shareForm.set("text", "Triagem médica com prontuário LGPD e confirmação WhatsApp.");
    const shareRes = await apiJson(baseUrl, "/api/share", {
      method: "POST",
      cookie: ownerCookie,
      body: shareForm,
      redirect: "manual",
    });

    // Voice STT & TTS
    const wavBuf = buildTinyWavBuffer();
    const sttForm = new FormData();
    sttForm.set(
      "file",
      new Blob([wavBuf], { type: "audio/wav" }),
      "clinica-teste.wav"
    );
    sttForm.set("language", "pt");
    const sttRes = await apiJson(baseUrl, "/api/voice/transcribe", {
      method: "POST",
      cookie: ownerCookie,
      body: sttForm,
    });
    const ttsRes = await apiJson(baseUrl, "/api/voice/speak", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        text: "Resumo técnico: arquitetura da Clínica VidaPlena pronta para revisão.",
      },
    });

    // Agency Chat SSE real com Gemini
    const agencySse = await readSseStream(baseUrl, "/api/agency/chat/stream", {
      cookie: ownerCookie,
      body: {
        clientId: defaultClientId,
        projectId: greenfieldId,
        intent: "general_chat",
        teamTopology: "lean_mvp",
        voiceMode: true,
        message:
          "Quero estruturar a Clínica VidaPlena com agenda médica, prontuário LGPD e controle de repasses por médico. Defina o MVP e os riscos principais.",
      },
    });
    const doneEvent = agencySse.events.find((e) => e.type === "done")?.response;

    // Prototype LLM + XSS sanitization test
    const protoCreate = greenfieldId
      ? await apiJson(baseUrl, `/api/projects/${greenfieldId}/prototypes`, {
          method: "POST",
          cookie: ownerCookie,
          body: {
            title: "Painel Agenda VidaPlena",
            level: 2,
            source: "stitch_import",
            html: `<!doctype html><html><body><main><h1>Agenda Clínica VidaPlena</h1><script>alert('xss')</script><img src=x onerror="alert(1)"><section data-slot="kpi">12 consultas hoje</section></main></body></html>`,
          },
        })
      : null;

    const protoPreview = protoCreate?.json?.id
      ? await apiJson(
          baseUrl,
          `/api/prototypes/${protoCreate.json.id}/preview`,
          { cookie: ownerCookie }
        )
      : null;

    // Notifications test + prefs
    const notifTest = await apiJson(baseUrl, "/api/notifications/test", {
      method: "POST",
      cookie: ownerCookie,
      body: {},
    });
    const notifList = await apiJson(baseUrl, "/api/notifications", {
      cookie: ownerCookie,
    });

    report.arc1_founder_gemini_voice.greenfield = {
      projectStatus: greenfieldCreate.status,
      projectId: greenfieldId,
      shareStatus: shareRes.status,
      shareLocation: shareRes.headers.get("location"),
      stt: {
        status: sttRes.status,
        elapsedMs: sttRes.elapsedMs,
        body: sttRes.json,
      },
      tts: {
        status: ttsRes.status,
        elapsedMs: ttsRes.elapsedMs,
        body: ttsRes.json,
      },
      agencySse: {
        status: agencySse.status,
        ttfbMs: agencySse.ttfbMs,
        totalMs: agencySse.totalMs,
        eventCount: agencySse.events.length,
        llmExecutionMode: doneEvent?.llmExecutionMode ?? null,
        spokenSummaryLength: doneEvent?.spokenSummary?.length ?? null,
        replyPreview: doneEvent?.reply?.slice(0, 280) ?? null,
      },
      prototypeXssCheck: {
        status: protoCreate?.status ?? null,
        previewStatus: protoPreview?.status ?? null,
        sanitizedContainsScript:
          protoPreview?.text?.includes("<script") ?? null,
        sanitizedContainsOnerror:
          protoPreview?.text?.includes("onerror") ?? null,
      },
      notifications: {
        testStatus: notifTest.status,
        unreadCount: notifList.json?.unreadCount ?? null,
      },
    };

    // 2. Arco 2 — Tech Lead Brownfield (`LegacyPay Gateway`)
    const brownfieldCreate = await apiJson(baseUrl, "/api/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        clientId: defaultClientId,
        name: `LegacyPay Gateway ${suffix}`,
        description: "Gateway de liquidação financeira poliglota TS + Python + SQL",
        defaultDevelopmentStrategy: "domain_first",
        repository: {
          name: "legacypay-gateway",
          localPath: fixtureDir,
          defaultBranch: "main",
        },
      },
    });
    const brownfieldId = brownfieldCreate.json?.id;
    const repoId = brownfieldCreate.json?.repositories?.[0]?.id;

    const codebaseReindex = brownfieldId
      ? await apiJson(
          baseUrl,
          `/api/projects/${brownfieldId}/codebase/reindex`,
          {
            method: "POST",
            cookie: ownerCookie,
            body: { repositoryId: repoId, rebuild: true },
          }
        )
      : null;

    const codebaseSymbols = brownfieldId
      ? await apiJson(
          baseUrl,
          `/api/projects/${brownfieldId}/codebase/symbols`,
          {
            method: "POST",
            cookie: ownerCookie,
            body: { limit: 100 },
          }
        )
      : null;

    const indexedSymbolNames = new Set(
      (codebaseSymbols?.json?.items ?? codebaseSymbols?.json?.symbols ?? []).map(
        (s) => s.name
      )
    );
    const expectedAll = [
      ...gabarito.expectedAst.typescriptSymbols,
      ...gabarito.expectedAst.pythonSymbols,
      ...gabarito.expectedAst.sqlSymbols,
    ];
    const matchedAst = expectedAll.filter((name) => indexedSymbolNames.has(name));
    const missingAst = expectedAll.filter((name) => !indexedSymbolNames.has(name));

    // QMD Memory + Reindex + Search
    const adrContent = fs.readFileSync(
      path.join(fixtureDir, "docs/adr-010-idempotency-keys.md"),
      "utf8"
    );
    const memCreate = brownfieldId
      ? await apiJson(baseUrl, "/api/memories", {
          method: "POST",
          cookie: ownerCookie,
          body: {
            scopeType: "project",
            scopeId: brownfieldId,
            category: "architecture",
            title: "ADR-010 Chaves de Idempotência",
            content: adrContent,
          },
        })
      : null;
    const qmdReindex = brownfieldId
      ? await apiJson(baseUrl, "/api/qmd/reindex", {
          method: "POST",
          cookie: ownerCookie,
          body: { projectId: brownfieldId, includeDocs: true, force: true },
        })
      : null;
    const qmdSearch = brownfieldId
      ? await apiJson(baseUrl, "/api/memories/search", {
          method: "POST",
          cookie: ownerCookie,
          body: {
            query: gabarito.expectedQmd.query,
            projectId: brownfieldId,
            mode: "hybrid",
            limit: 5,
          },
        })
      : null;

    // Security Scan on LegacyPay
    const secScan = brownfieldId
      ? await apiJson(baseUrl, "/api/security/scans", {
          method: "POST",
          cookie: ownerCookie,
          body: {
            projectId: brownfieldId,
            targetType: "git_repo",
            triage: true,
          },
        })
      : null;

    // Deliverable + FinOps + Skills + Entropy
    const delivCreate = brownfieldId
      ? await apiJson(baseUrl, `/api/projects/${brownfieldId}/deliverables`, {
          method: "POST",
          cookie: ownerCookie,
          body: {
            title: "Blindar captura contra SQL Injection",
            description: "Parametrizar query de charges e validar X-Idempotency-Key.",
            hasUi: false,
            developmentStrategy: "domain_first",
            riskLevel: "high",
          },
        })
      : null;

    const finopsSummary = await apiJson(baseUrl, "/api/finops/summary", {
      cookie: ownerCookie,
    });
    const finopsEff = await apiJson(baseUrl, "/api/finops/effectiveness", {
      cookie: ownerCookie,
    });
    const skillsCat = await apiJson(baseUrl, "/api/skills/catalog", {
      cookie: ownerCookie,
    });
    const entropy = brownfieldId
      ? await apiJson(baseUrl, `/api/projects/${brownfieldId}/entropy`, {
          cookie: ownerCookie,
        })
      : null;

    report.arc2_tech_lead_brownfield = {
      projectStatus: brownfieldCreate.status,
      projectId: brownfieldId,
      ast: {
        reindexStatus: codebaseReindex?.status ?? null,
        reindexElapsedMs: codebaseReindex?.elapsedMs ?? null,
        reindexBody: codebaseReindex?.json ?? null,
        totalSymbolsReturned: codebaseSymbols?.json?.items?.length ?? 0,
        matchedExpectedCount: matchedAst.length,
        expectedTotalCount: expectedAll.length,
        missingExpectedSymbols: missingAst,
      },
      qmd: {
        memCreateStatus: memCreate?.status ?? null,
        reindexStatus: qmdReindex?.status ?? null,
        reindexBody: qmdReindex?.json ?? null,
        searchStatus: qmdSearch?.status ?? null,
        searchElapsedMs: qmdSearch?.elapsedMs ?? null,
        embeddingModel: qmdSearch?.json?.embeddingModel ?? null,
        degraded: qmdSearch?.json?.degraded ?? null,
        top3Titles: (qmdSearch?.json?.hits ?? [])
          .slice(0, 3)
          .map((h) => h.title ?? h.sourcePath ?? h.headingPath),
      },
      securityScan: {
        status: secScan?.status ?? null,
        elapsedMs: secScan?.elapsedMs ?? null,
        scanStatus: secScan?.json?.status ?? null,
        findingsCount: secScan?.json?.findings?.length ?? secScan?.json?.totalFindings ?? null,
        scannerSummary: secScan?.json?.scannerStatuses ?? secScan?.json?.summaryJson ?? null,
      },
      deliverableStatus: delivCreate?.status ?? null,
      finops: {
        summaryStatus: finopsSummary.status,
        effectivenessStatus: finopsEff.status,
        skillsCount: skillsCat.json?.items?.length ?? null,
        entropyStatus: entropy?.status ?? null,
        entropyBody: entropy?.json ?? null,
      },
    };

    // 3. Arco 3 — Probes IDOR Cross-Tenant + SSRF no ambiente Live Postgres
    const idorProject = brownfieldId
      ? await apiJson(baseUrl, `/api/projects/${brownfieldId}/deliverables`, {
          cookie: outsiderCookie,
        })
      : null;
    const idorCodebase = brownfieldId
      ? await apiJson(baseUrl, `/api/projects/${brownfieldId}/codebase`, {
          cookie: outsiderCookie,
        })
      : null;
    const ssrfGoogle = await apiJson(baseUrl, "/api/providers", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        name: "SSRF Probe",
        providerType: "google",
        baseUrl: "http://127.0.0.1:8080/v1",
        apiKey: "fake-key-for-ssrf-test-only",
      },
    });
    const ssrfDast = await apiJson(baseUrl, "/api/security/scans", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        targetType: "staging_url",
        stagingUrl: "http://169.254.169.254/latest/meta-data",
      },
    });

    report.arc3_rbac_ssrf_security = {
      idorProjectStatus: idorProject?.status ?? null,
      idorCodebaseStatus: idorCodebase?.status ?? null,
      ssrfGoogleStatus: ssrfGoogle.status,
      ssrfDastStatus: ssrfDast.status,
    };

    // 4. Arco 4 — SSE Agency Threads + Deliverable Events Resume Probe
    const threads = await apiJson(
      baseUrl,
      `/api/agency/threads?projectId=${greenfieldId}`,
      { cookie: ownerCookie }
    );
    report.arc4_resilience_sse = {
      threadsStatus: threads.status,
      threadsCount: threads.json?.items?.length ?? null,
    };
  } catch (err) {
    report.errors.push(
      redactSecret(
        err instanceof Error ? err.stack ?? err.message : String(err),
        geminiKey
      )
    );
  }

  report.finishedAt = new Date().toISOString();
  const outputJson = redactSecret(JSON.stringify(report, null, 2), geminiKey);
  if (metricsOut) {
    fs.mkdirSync(path.dirname(metricsOut), { recursive: true });
    fs.writeFileSync(metricsOut, outputJson, "utf8");
  }
  console.log(outputJson);
}

run();
