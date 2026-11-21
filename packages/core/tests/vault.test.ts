import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  maskApiKey,
  parseMasterKeyBuffer,
  resolveMasterKey,
} from "../src/index.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const MASTER_HEX = "a".repeat(64);
const MASTER_KEY = parseMasterKeyBuffer(MASTER_HEX);

describe("@uzina/core — Vault AES-256-GCM", () => {
  test("executa round-trip encrypt/decrypt preservando plaintext com IV 12B e AuthTag 16B", () => {
    const plaintext = "sk-uzina-live-9876543210abcdef";
    const encrypted = encryptSecret({
      plaintext,
      masterKey: MASTER_KEY,
      organizationId: ORG_A,
      providerType: "omniroute",
    });

    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1] ?? "", "hex")).toHaveLength(12);
    expect(Buffer.from(parts[2] ?? "", "hex")).toHaveLength(16);

    const decrypted = decryptSecret({
      encrypted,
      masterKey: MASTER_KEY,
      organizationId: ORG_A,
      providerType: "omniroute",
    });
    expect(decrypted).toBe(plaintext);
  });

  test("gera IV e ciphertext únicos a cada cifragem do mesmo segredo", () => {
    const first = encryptSecret({
      plaintext: "sk-same-secret-1234",
      masterKey: MASTER_KEY,
      organizationId: ORG_A,
      providerType: "anthropic",
    });
    const second = encryptSecret({
      plaintext: "sk-same-secret-1234",
      masterKey: MASTER_KEY,
      organizationId: ORG_A,
      providerType: "anthropic",
    });

    expect(first).not.toBe(second);
    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
    expect(first.split(":")[3]).not.toBe(second.split(":")[3]);
  });

  test("detecta adulteração de ciphertext, IV, authTag e violação de AAD (cross-tenant/provider)", () => {
    const encrypted = encryptSecret({
      plaintext: "sk-secret-tamper-check",
      masterKey: MASTER_KEY,
      organizationId: ORG_A,
      providerType: "openai_compatible",
    });
    const [ver, ivHex, tagHex, cipherHex] = encrypted.split(":") as [
      string,
      string,
      string,
      string,
    ];

    const flipFirstByte = (hex: string): string => {
      const buf = Buffer.from(hex, "hex");
      buf[0] = (buf[0] ?? 0) ^ 0xff;
      return buf.toString("hex");
    };

    const tamperedCipher = `${ver}:${ivHex}:${tagHex}:${flipFirstByte(cipherHex)}`;
    const tamperedIv = `${ver}:${flipFirstByte(ivHex)}:${tagHex}:${cipherHex}`;
    const tamperedTag = `${ver}:${ivHex}:${flipFirstByte(tagHex)}:${cipherHex}`;

    expect(() =>
      decryptSecret({
        encrypted: tamperedCipher,
        masterKey: MASTER_KEY,
        organizationId: ORG_A,
        providerType: "openai_compatible",
      })
    ).toThrow();
    expect(() =>
      decryptSecret({
        encrypted: tamperedIv,
        masterKey: MASTER_KEY,
        organizationId: ORG_A,
        providerType: "openai_compatible",
      })
    ).toThrow();
    expect(() =>
      decryptSecret({
        encrypted: tamperedTag,
        masterKey: MASTER_KEY,
        organizationId: ORG_A,
        providerType: "openai_compatible",
      })
    ).toThrow();

    expect(() =>
      decryptSecret({
        encrypted,
        masterKey: MASTER_KEY,
        organizationId: ORG_B,
        providerType: "openai_compatible",
      })
    ).toThrow();

    expect(() =>
      decryptSecret({
        encrypted,
        masterKey: MASTER_KEY,
        organizationId: ORG_A,
        providerType: "anthropic",
      })
    ).toThrow();
  });

  test.each([
    { input: "sk-proj-1234567890abcd", expected: "sk-...abcd" },
    { input: "gsk_abcdefgh", expected: "gsk...efgh" },
    { input: "short", expected: "***" },
    { input: "   ", expected: "" },
  ])("maskApiKey('$input') => '$expected'", ({ input, expected }) => {
    expect(maskApiKey(input)).toBe(expected);
  });

  test("parseMasterKeyBuffer aceita hex 64 ou base64 32B e rejeita chaves inválidas", () => {
    const base64Key = crypto.randomBytes(32).toString("base64");
    expect(parseMasterKeyBuffer(base64Key)).toHaveLength(32);

    expect(() => parseMasterKeyBuffer("short")).toThrow(/32 bytes/i);
    expect(() => parseMasterKeyBuffer("z".repeat(64))).toThrow(/32 bytes/i);
  });

  test("resolveMasterKey falha fechado em strict mode e persiste .master-key em disco no modo local", () => {
    expect(() =>
      resolveMasterKey(
        { DATABASE_URL: "postgres://uzina:uzina@localhost:5432/uzina" },
        ":memory:"
      )
    ).toThrow(/MASTER_ENCRYPTION_KEY/);

    expect(() =>
      resolveMasterKey({ UZINA_STRICT_SECRETS: "true" }, ":memory:")
    ).toThrow(/MASTER_ENCRYPTION_KEY/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-vault-"));
    try {
      const k1 = resolveMasterKey({}, tmpDir);
      const k2 = resolveMasterKey({}, tmpDir);
      expect(k1).toHaveLength(32);
      expect(k2.equals(k1)).toBe(true);

      fs.writeFileSync(path.join(tmpDir, ".master-key"), "corrompida", "utf8");
      expect(() => resolveMasterKey({}, tmpDir)).toThrow(/32 bytes/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test.each([
    { label: "versão v2 não suportada", payload: "v2:00:11:22" },
    { label: "segmentos incompletos", payload: "v1:001122" },
    { label: "IV menor que 12 bytes", payload: "v1:0011:00112233445566778899aabbccddeeff:aa" },
    { label: "envelope vazio", payload: "" },
  ])("decryptSecret rejeita payload malformado ($label)", ({ payload }) => {
    expect(() =>
      decryptSecret({
        encrypted: payload,
        masterKey: MASTER_KEY,
        organizationId: ORG_A,
        providerType: "omniroute",
      })
    ).toThrow();
  });

  test("encryptSecret/decryptSecret preserva round-trip em plaintext vazio sem falhar silenciosamente", () => {
    const encrypted = encryptSecret({
      plaintext: "",
      masterKey: MASTER_KEY,
      organizationId: ORG_A,
      providerType: "ollama",
    });
    expect(
      decryptSecret({
        encrypted,
        masterKey: MASTER_KEY,
        organizationId: ORG_A,
        providerType: "ollama",
      })
    ).toBe("");
  });
});
