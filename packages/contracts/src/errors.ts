import { z } from "zod";

const IMDS_HOST_RE =
  /^(169\.254\.\d{1,3}\.\d{1,3}|metadata\.google\.internal|metadata\.goog|\[?fe80:.*\]?)$/i;

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
