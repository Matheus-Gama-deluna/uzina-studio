import { createRequire } from "node:module";
import {
  HttpUrlSchema,
  VisualA11yVerifyReportSchema,
  type VisualA11yVerifyReport,
  type VisualA11yViolation,
} from "@uzina/contracts";

export const VISUAL_A11Y_VIEWPORTS = [
  { label: "1440x900" as const, width: 1440, height: 900 },
  { label: "390x844" as const, width: 390, height: 844 },
];

export interface VisualA11yViewportMeasurement {
  consoleErrors: string[];
  horizontalOverflowPx: number;
  axeViolations: VisualA11yViolation[];
}

export type VisualA11yViewportRunner = (params: {
  previewUrl: string;
  viewport: { label: "1440x900" | "390x844"; width: number; height: number };
  signal?: AbortSignal;
}) => Promise<VisualA11yViewportMeasurement>;

export interface RunVisualA11yVerifyInput {
  previewUrl?: string | null;
  previewCommand?: string | null;
  workspacePath?: string;
  runner?: VisualA11yViewportRunner;
  signal?: AbortSignal;
}

interface PlaywrightBrowserLike {
  newPage(opts: {
    viewport: { width: number; height: number };
  }): Promise<{
    on(event: "console" | "pageerror", listener: (arg: unknown) => void): void;
    goto(
      url: string,
      opts: { waitUntil: "domcontentloaded" | "networkidle"; timeout: number }
    ): Promise<unknown>;
    evaluate<T>(fn: () => T): Promise<T>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

interface PlaywrightModuleLike {
  chromium?: {
    launch(opts: { headless: boolean }): Promise<PlaywrightBrowserLike>;
  };
}

interface AxeBuilderLike {
  analyze(): Promise<{
    violations?: Array<{
      id: string;
      impact?: string | null;
      nodes?: unknown[];
      help?: string;
    }>;
  }>;
}

type AxeBuilderConstructor = new (opts: { page: unknown }) => AxeBuilderLike;

function normalizeAxeImpact(
  rawImpact: string | null | undefined
): VisualA11yViolation["impact"] {
  if (
    rawImpact === "minor" ||
    rawImpact === "moderate" ||
    rawImpact === "serious" ||
    rawImpact === "critical"
  ) {
    return rawImpact;
  }
  return "moderate";
}

function tryLoadPlaywrightAndAxe(): {
  playwright: PlaywrightModuleLike;
  AxeBuilder: AxeBuilderConstructor | null;
} | null {
  try {
    const req = createRequire(import.meta.url);
    const playwright = req(
      /*turbopackIgnore: true*/ "playwright"
    ) as PlaywrightModuleLike;
    if (!playwright?.chromium?.launch) {
      return null;
    }
    let AxeBuilder: AxeBuilderConstructor | null = null;
    try {
      const axePkg = req(
        /*turbopackIgnore: true*/ "@axe-core/playwright"
      ) as {
        default?: AxeBuilderConstructor;
        AxeBuilder?: AxeBuilderConstructor;
      };
      AxeBuilder = axePkg.default ?? axePkg.AxeBuilder ?? null;
    } catch {
      AxeBuilder = null;
    }
    return { playwright, AxeBuilder };
  } catch {
    return null;
  }
}

export async function runVisualA11yVerify(
  input: RunVisualA11yVerifyInput
): Promise<VisualA11yVerifyReport> {
  const previewUrlRaw = input.previewUrl?.trim() ?? "";
  const previewCmdRaw = input.previewCommand?.trim() ?? "";

  if (!previewUrlRaw && !previewCmdRaw) {
    return VisualA11yVerifyReportSchema.parse({
      executed: false,
      status: "skipped_missing_binary",
      viewports: ["1440x900", "390x844"],
      consoleErrors: [],
      horizontalOverflowPx: 0,
      axeViolations: [],
    });
  }

  const effectiveUrl = previewUrlRaw
    ? HttpUrlSchema.parse(previewUrlRaw)
    : "http://127.0.0.1:3000";

  if (input.runner) {
    return executeWithViewportRunner(effectiveUrl, input.runner, input.signal);
  }

  const loaded = tryLoadPlaywrightAndAxe();
  if (!loaded?.playwright.chromium) {
    return VisualA11yVerifyReportSchema.parse({
      executed: false,
      status: "skipped_missing_binary",
      viewports: ["1440x900", "390x844"],
      consoleErrors: [],
      horizontalOverflowPx: 0,
      axeViolations: [],
    });
  }

  let browser: PlaywrightBrowserLike | null = null;
  try {
    browser = await loaded.playwright.chromium.launch({ headless: true });
  } catch {
    return VisualA11yVerifyReportSchema.parse({
      executed: false,
      status: "skipped_missing_binary",
      viewports: ["1440x900", "390x844"],
      consoleErrors: [],
      horizontalOverflowPx: 0,
      axeViolations: [],
    });
  }

  try {
    const activeBrowser = browser;
    const playwrightRunner: VisualA11yViewportRunner = async ({
      previewUrl,
      viewport,
    }) => {
      const page = await activeBrowser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        const msgObj = msg as { type?: () => string; text?: () => string };
        if (msgObj?.type?.() === "error") {
          const text = msgObj.text?.() ?? "console.error";
          consoleErrors.push(text.slice(0, 1000));
        }
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(
          (err instanceof Error ? err.message : String(err)).slice(0, 1000)
        );
      });

      try {
        await page.goto(previewUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        const horizontalOverflowPx = await page.evaluate(() => {
          const g = globalThis as {
            document?: {
              documentElement?: {
                scrollWidth?: number;
                clientWidth?: number;
              };
            };
          };
          const docEl = g.document?.documentElement;
          if (
            !docEl ||
            typeof docEl.scrollWidth !== "number" ||
            typeof docEl.clientWidth !== "number"
          ) {
            return 0;
          }
          return Math.max(0, docEl.scrollWidth - docEl.clientWidth);
        });

        const axeViolations: VisualA11yViolation[] = [];
        if (loaded.AxeBuilder) {
          const axeResults = await new loaded.AxeBuilder({ page }).analyze();
          for (const violation of axeResults.violations ?? []) {
            axeViolations.push({
              id: violation.id.slice(0, 120),
              impact: normalizeAxeImpact(violation.impact),
              nodesCount: violation.nodes?.length ?? 0,
              help: (violation.help ?? violation.id).slice(0, 500),
            });
          }
        }

        return {
          consoleErrors,
          horizontalOverflowPx,
          axeViolations,
        };
      } finally {
        await page.close();
      }
    };

    return await executeWithViewportRunner(
      effectiveUrl,
      playwrightRunner,
      input.signal
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function executeWithViewportRunner(
  previewUrl: string,
  runner: VisualA11yViewportRunner,
  signal?: AbortSignal
): Promise<VisualA11yVerifyReport> {
  const allConsoleErrors: string[] = [];
  let maxOverflowPx = 0;
  const violationMap = new Map<string, VisualA11yViolation>();

  for (const vp of VISUAL_A11Y_VIEWPORTS) {
    if (signal?.aborted) {
      throw new Error("Execução Visual/A11y abortada por AbortSignal.");
    }
    const res = await runner({ previewUrl, viewport: vp, signal });
    for (const err of res.consoleErrors) {
      allConsoleErrors.push(`[${vp.label}] ${err}`.slice(0, 1000));
    }
    maxOverflowPx = Math.max(maxOverflowPx, Math.max(0, res.horizontalOverflowPx));
    for (const violation of res.axeViolations) {
      const existing = violationMap.get(violation.id);
      if (existing) {
        violationMap.set(violation.id, {
          ...existing,
          nodesCount: existing.nodesCount + violation.nodesCount,
        });
      } else {
        violationMap.set(violation.id, violation);
      }
    }
  }

  const axeViolations = Array.from(violationMap.values());
  const hasBlockingAxe = axeViolations.some(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  const passed =
    allConsoleErrors.length === 0 && maxOverflowPx === 0 && !hasBlockingAxe;

  return VisualA11yVerifyReportSchema.parse({
    executed: true,
    status: passed ? "passed" : "failed",
    viewports: ["1440x900", "390x844"],
    consoleErrors: allConsoleErrors,
    horizontalOverflowPx: maxOverflowPx,
    axeViolations,
  });
}
