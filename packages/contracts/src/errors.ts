import { z } from "zod";

const IMDS_HOST_RE =
  /^(169\.254\.\d{1,3}\.\d{1,3}|metadata\.google\.internal|metadata\.goog|\[?fe80:.*\]?|\[?::ffff:169\.254\.\d{1,3}\.\d{1,3}\]?|\[?::ffff:a9fe:a9fe\]?)$/i;

const PRIVATE_OR_LOOPBACK_HOST_RE =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[?::1?\]?|\[?::ffff:.*\]?|\[?fc[0-9a-f]{2}:.*\]?|\[?fd[0-9a-f]{2}:.*\]?)$/i;

export function isPrivateOrLoopbackUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    return (
      IMDS_HOST_RE.test(hostname) ||
      PRIVATE_OR_LOOPBACK_HOST_RE.test(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    );
  } catch {
    return true;
  }
}

export const HttpUrlSchema = z.url().refine((raw) => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (IMDS_HOST_RE.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}, "URL deve utilizar protocolo http:// ou https:// e não pode apontar para endpoints IMDS link-local");

export const ApiErrorSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
