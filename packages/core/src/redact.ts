const MIN_SECRET_LENGTH = 4;

function normalizeSecrets(
  secrets: readonly (string | null | undefined)[]
): string[] {
  const unique = new Set<string>();
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= MIN_SECRET_LENGTH) {
      unique.add(s);
    }
  }
  return Array.from(unique).sort((a, b) => b.length - a.length);
}

export function redactSecrets(
  text: string,
  secrets: readonly (string | null | undefined)[]
): string {
  const cleanSecrets = normalizeSecrets(secrets);
  if (cleanSecrets.length === 0 || !text) {
    return text;
  }
  let output = text;
  for (const secret of cleanSecrets) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

export function redactSecretsInValue<T>(
  value: T,
  secrets: readonly (string | null | undefined)[]
): T {
  const cleanSecrets = normalizeSecrets(secrets);
  if (cleanSecrets.length === 0) {
    return value;
  }
  return redactRecursive(value, cleanSecrets, new WeakSet<object>()) as T;
}

function redactRecursive(
  value: unknown,
  cleanSecrets: string[],
  seen: WeakSet<object>
): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, cleanSecrets);
  }
  if (value instanceof Error) {
    return sanitizeErrorInPlace(value, cleanSecrets, seen);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    return value.map((item) => redactRecursive(item, cleanSecrets, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactRecursive(entry, cleanSecrets, seen);
    }
    return out;
  }
  return value;
}

function sanitizeErrorInPlace(
  error: Error,
  cleanSecrets: string[],
  seen: WeakSet<object>
): Error {
  if (seen.has(error)) {
    return error;
  }
  seen.add(error);

  error.message = redactSecrets(error.message, cleanSecrets);
  if (error.stack) {
    error.stack = redactSecrets(error.stack, cleanSecrets);
  }

  const errorWithExtras: Error & { cause?: unknown; errors?: unknown } = error;
  if (errorWithExtras.cause !== undefined) {
    errorWithExtras.cause = redactRecursive(
      errorWithExtras.cause,
      cleanSecrets,
      seen
    );
  }

  if (Array.isArray(errorWithExtras.errors)) {
    errorWithExtras.errors = errorWithExtras.errors.map((item) =>
      redactRecursive(item, cleanSecrets, seen)
    );
  }

  for (const [key, val] of Object.entries(error)) {
    Reflect.set(error, key, redactRecursive(val, cleanSecrets, seen));
  }

  return error;
}

export function redactError(
  error: unknown,
  secrets: readonly (string | null | undefined)[]
): Error {
  const cleanSecrets = normalizeSecrets(secrets);
  if (error instanceof Error) {
    if (cleanSecrets.length === 0) {
      return error;
    }
    return sanitizeErrorInPlace(error, cleanSecrets, new WeakSet<object>());
  }
  return new Error(redactSecrets(String(error), cleanSecrets));
}
