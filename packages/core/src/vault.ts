import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProviderType } from "@uzina/contracts";
import { z } from "zod";

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const GLOBAL_MASTER_KEY_SYMBOL = Symbol.for("@uzina/core/ephemeralMasterKey");

export const MasterKeyInputSchema = z
  .string()
  .trim()
  .min(44)
  .refine(
    (raw) => {
      if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        return true;
      }
      const decoded = Buffer.from(raw, "base64");
      return (
        decoded.length === MASTER_KEY_BYTES &&
        decoded.toString("base64").replace(/=+$/, "") ===
          raw.replace(/=+$/, "")
      );
    },
    {
      message:
        "Chave mestra inválida: esperado exatos 32 bytes (64 chars hex ou base64 de 32 bytes).",
    }
  );

export function parseMasterKeyBuffer(raw: string): Buffer {
  const validated = MasterKeyInputSchema.parse(raw);
  if (/^[0-9a-fA-F]{64}$/.test(validated)) {
    return Buffer.from(validated, "hex");
  }
  return Buffer.from(validated, "base64");
}

export function resolveMasterKey(
  env: Record<string, string | undefined> = process.env,
  dataDir = "./data"
): Buffer {
  const rawEnv =
    env.MASTER_ENCRYPTION_KEY?.trim() || env.VAULT_MASTER_KEY?.trim();
  if (rawEnv) {
    return parseMasterKeyBuffer(rawEnv);
  }

  const strictMode =
    Boolean(env.DATABASE_URL?.trim()) || env.UZINA_STRICT_SECRETS === "true";
  if (strictMode) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY obrigatória quando DATABASE_URL ou UZINA_STRICT_SECRETS=true estão ativos."
    );
  }

  if (dataDir !== ":memory:") {
    const keyPath = path.join(dataDir, ".master-key");
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const generatedHex = crypto.randomBytes(MASTER_KEY_BYTES).toString("hex");
      fs.writeFileSync(keyPath, generatedHex, { flag: "wx", mode: 0o600 });
      return Buffer.from(generatedHex, "hex");
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === "EEXIST") {
        const existing = fs.readFileSync(keyPath, "utf8").trim();
        return parseMasterKeyBuffer(existing);
      }
      throw error;
    }
  }

  const holder = globalThis as Record<symbol, Buffer | undefined>;
  if (!holder[GLOBAL_MASTER_KEY_SYMBOL]) {
    holder[GLOBAL_MASTER_KEY_SYMBOL] = crypto.randomBytes(MASTER_KEY_BYTES);
  }
  return holder[GLOBAL_MASTER_KEY_SYMBOL];
}

export interface EncryptSecretParams {
  plaintext: string;
  masterKey: Buffer;
  organizationId: string;
  providerType: ProviderType;
}

export interface DecryptSecretParams {
  encrypted: string;
  masterKey: Buffer;
  organizationId: string;
  providerType: ProviderType;
}

function buildAad(organizationId: string, providerType: ProviderType): Buffer {
  return Buffer.from(`${organizationId}:${providerType}`, "utf8");
}

export function encryptSecret(params: EncryptSecretParams): string {
  if (params.masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error("Master key deve possuir exatamente 32 bytes.");
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", params.masterKey, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(buildAad(params.organizationId, params.providerType));

  const encrypted = Buffer.concat([
    cipher.update(params.plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decryptSecret(params: DecryptSecretParams): string {
  if (params.masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error("Master key deve possuir exatamente 32 bytes.");
  }

  const parts = params.encrypted.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("Envelope criptográfico inválido.");
  }

  const iv = Buffer.from(parts[1] ?? "", "hex");
  const authTag = Buffer.from(parts[2] ?? "", "hex");
  const ciphertext = Buffer.from(parts[3] ?? "", "hex");

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("IV ou AuthTag com tamanho inválido.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    params.masterKey,
    iv,
    { authTagLength: AUTH_TAG_BYTES }
  );
  decipher.setAAD(buildAad(params.organizationId, params.providerType));
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function maskApiKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length < 8) {
    return "***";
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}
