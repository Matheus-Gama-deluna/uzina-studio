import { ApiErrorSchema, type ApiError } from "@uzina/contracts";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export function jsonError(
  status: number,
  payload: ApiError
): NextResponse<ApiError> {
  return NextResponse.json(ApiErrorSchema.parse(payload), { status });
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<
  { ok: true; data: T } | { ok: false; response: NextResponse<ApiError> }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonError(400, {
        error: "Corpo JSON inválido",
        code: "INVALID_JSON",
      }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(400, {
        error: parsed.error.issues[0]?.message ?? "Payload inválido",
        code: "VALIDATION_ERROR",
      }),
    };
  }

  return { ok: true, data: parsed.data };
}

export function slugify(input: string): string {
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized.length >= 2 ? normalized : `item-${Date.now()}`;
}

export function isPgUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "23505") {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    return (cause as { code?: unknown }).code === "23505";
  }
  return false;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
