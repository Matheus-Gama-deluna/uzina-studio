import { redactSensitiveText } from "@uzina/core";
import { getDb, resolveDataDir, type UzinaDb } from "@uzina/db";
import {
  createMastraRuntime,
  WorkflowRuntimeError,
  type MastraWorkflowService,
} from "@uzina/mastra-runtime";
import { jsonError } from "./api-utils";
import { getServerMasterKey } from "./vault";

interface WebWorkflowSingletonState {
  service?: MastraWorkflowService;
  dbRef?: UzinaDb;
  dataDirKey?: string;
  initPromise?: Promise<MastraWorkflowService>;
}

const SINGLETON_KEY = Symbol.for("@uzina/web/workflow-runtime");

function getSingletonState(): WebWorkflowSingletonState {
  const holder = globalThis as Record<
    symbol,
    WebWorkflowSingletonState | undefined
  >;
  if (!holder[SINGLETON_KEY]) {
    holder[SINGLETON_KEY] = {};
  }
  return holder[SINGLETON_KEY];
}

export async function getWebWorkflowRuntime(): Promise<MastraWorkflowService> {
  const state = getSingletonState();
  const { db } = await getDb();
  const dataDir = resolveDataDir(process.env);
  const dataDirKey = `${process.env.DATABASE_URL ?? ""}:${dataDir}`;

  if (state.service && state.dbRef === db && state.dataDirKey === dataDirKey) {
    return state.service;
  }

  if (state.initPromise) {
    const inFlight = await state.initPromise;
    if (state.dbRef === db && state.dataDirKey === dataDirKey) {
      return inFlight;
    }
  }

  if (state.service) {
    await state.service.close();
    state.service = undefined;
  }

  state.dbRef = db;
  state.dataDirKey = dataDirKey;
  state.initPromise = createMastraRuntime({
    db,
    dataDir,
    databaseUrl: process.env.DATABASE_URL,
    masterKey: getServerMasterKey(),
  });

  try {
    state.service = await state.initPromise;
    return state.service;
  } finally {
    state.initPromise = undefined;
  }
}

export async function resetWebWorkflowRuntimeForTests(): Promise<void> {
  const state = getSingletonState();
  const current = state.service;
  state.service = undefined;
  state.dbRef = undefined;
  state.dataDirKey = undefined;
  if (current) {
    await current.close();
  }
}

function sanitizeClientErrorMessage(message: string): string {
  const withoutSecrets = redactSensitiveText(message);
  return withoutSecrets
    .replace(/[A-Za-z]:\\[^\s'"]+/g, "[PATH]")
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, "[PATH]")
    .slice(0, 400);
}

export function handleWorkflowRouteError(err: unknown) {
  if (err instanceof WorkflowRuntimeError) {
    return jsonError(err.statusCode, {
      error:
        err.statusCode >= 500
          ? "Erro interno ao operar workflow durável."
          : sanitizeClientErrorMessage(err.message),
      code: err.code,
    });
  }
  console.error("[workflow-runtime] erro inesperado:", err);
  return jsonError(500, {
    error: "Erro interno ao operar workflow durável.",
    code: "WORKFLOW_INTERNAL_ERROR",
  });
}
