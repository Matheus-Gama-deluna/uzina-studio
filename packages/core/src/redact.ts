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

const SENSITIVE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16,24}(?![A-Z0-9])/g, "[REDACTED_AWS_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, "[REDACTED_GITHUB_PAT]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,200}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_GOOGLE_API_KEY]"],
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,200}\b/g, "[REDACTED_API_KEY]"],
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  ],
  [
    /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@[^\s/]+)/gi,
    "$1[REDACTED_PASSWORD]$3",
  ],
  [
    /((?:password|passwd|secret|api_key|apikey|token|bearer|authorization)\s*[:=]\s*["']?)([A-Za-z0-9._~+/-]{8,})/gi,
    "$1[REDACTED]",
  ],
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "[REDACTED_JWT]",
  ],
];

export function redactSensitiveText(
  text: string,
  knownSecrets: readonly (string | null | undefined)[] = []
): string {
  if (!text) {
    return text;
  }
  let output = redactSecrets(text, knownSecrets);
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function redactSensitiveValue<T>(
  value: T,
  knownSecrets: readonly (string | null | undefined)[] = []
): T {
  const cleanSecrets = normalizeSecrets(knownSecrets);
  const redactDeep = (node: unknown, seen: WeakSet<object>): unknown => {
    if (typeof node === "string") {
      return redactSensitiveText(node, cleanSecrets);
    }
    if (node instanceof Error) {
      node.message = redactSensitiveText(node.message, cleanSecrets);
      if (node.stack) {
        node.stack = redactSensitiveText(node.stack, cleanSecrets);
      }
      return node;
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) {
        return node;
      }
      seen.add(node);
      return node.map((item) => redactDeep(item, seen));
    }
    if (node !== null && typeof node === "object") {
      if (seen.has(node)) {
        return "[Circular]";
      }
      seen.add(node);
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) {
        result[key] = redactDeep(entry, seen);
      }
      return result;
    }
    return node;
  };
  return redactDeep(value, new WeakSet<object>()) as T;
}
