import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gera de forma determinística o repositório Brownfield "LegacyPay Gateway"
 * em um diretório isolado (fora do workspace do Uzina Studio) acompanhado de
 * um `gabarito.json` para aferir AST poliglota, busca QMD, migration-safety e
 * os 4 scanners SAST reais (Gitleaks, Opengrep, Trivy e OSV-Scanner).
 */
export function seedLegacyPayFixture(targetDir) {
  const outDir = path.resolve(
    targetDir ?? path.join(os.tmpdir(), "uzina-sim-legacypay")
  );

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Token sintético montado em runtime para não acionar scanners no próprio código do gerador
  const syntheticGhToken = [
    "ghp",
    "_",
    "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  ].join("");

  const files = {
    "README.md": `# LegacyPay Gateway

Gateway de liquidação financeira multi-moeda (TypeScript + Python + SQL).
Este repositório serve como cobaia controlada para avaliação de AST poliglota,
memória QMD, governança DDL e pipeline AppSec.
`,
    "package.json": JSON.stringify(
      {
        name: "legacypay-gateway",
        version: "1.4.2",
        private: true,
        type: "module",
        dependencies: {
          lodash: "4.17.15",
          axios: "0.21.1",
        },
        scripts: {
          test: "node -e \"console.log('legacypay ok')\"",
        },
      },
      null,
      2
    ),
    "package-lock.json": JSON.stringify(
      {
        name: "legacypay-gateway",
        version: "1.4.2",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: "legacypay-gateway",
            version: "1.4.2",
            dependencies: {
              lodash: "4.17.15",
              axios: "0.21.1",
            },
          },
          "node_modules/lodash": {
            version: "4.17.15",
            resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz",
            integrity:
              "sha512-8xOcRHvCjnocdS5cpwXQXVzmmh5e5+saE2QGoeQmbKmRS6J3VQppPOIt0MnmE+4xlZoumy0GPG0D0MVIQbNA==",
          },
          "node_modules/axios": {
            version: "0.21.1",
            resolved: "https://registry.npmjs.org/axios/-/axios-0.21.1.tgz",
            integrity:
              "sha512-dKQiRHxGD9PPRIWEEv7/m3/8jQ6f6f0rP2yR7zH1x1tH9b5z4R2gJ3m4wP1p6f5jX2K8n4B3jV9g==",
          },
        },
      },
      null,
      2
    ),
    "src/payment-router.ts": `export interface PaymentCaptureInput {
  merchantId: string;
  chargeId: string;
  amountCents: number;
  currency: "BRL" | "USD";
}

export function calculateFeeBasisPoints(amountCents: number): number {
  const feeBps = 245;
  return Math.round((amountCents * feeBps) / 10_000);
}

export async function processPaymentCapture(
  input: PaymentCaptureInput
): Promise<{ status: string; netAmountCents: number }> {
  const fee = calculateFeeBasisPoints(input.amountCents);
  // Armadilha proposital para SAST (SQL concatenado + eval dinâmico)
  const rawQuery =
    "SELECT * FROM charges WHERE id = '" + input.chargeId + "' AND active = 1";
  const dynamicRule = "1 + 1";
  const evaluated = eval(dynamicRule) as number;
  void rawQuery;
  void evaluated;
  return {
    status: "captured",
    netAmountCents: Math.max(0, input.amountCents - fee),
  };
}
`,
    "src/ledger.ts": `import { calculateFeeBasisPoints } from "./payment-router.js";

export class LedgerReconciler {
  private readonly ledgerEntries: Array<{ id: string; feeCents: number }> = [];

  public recordSettlement(chargeId: string, grossCents: number): number {
    const feeCents = calculateFeeBasisPoints(grossCents);
    this.ledgerEntries.push({ id: chargeId, feeCents });
    return grossCents - feeCents;
  }
}
`,
    "workers/settlement_worker.py": `import subprocess

class FraudScorer:
    def score_transaction(self, amount_cents: int, country: str) -> float:
        base = 0.15 if country == "BR" else 0.45
        return min(1.0, base + (amount_cents / 1_000_000.0))

def settle_batch(batch_id: str, merchant_code: str) -> int:
    scorer = FraudScorer()
    risk = scorer.score_transaction(50_000, "BR")
    # Armadilha proposital para SAST (shell=True)
    cmd = f"echo settling {batch_id} for {merchant_code} risk={risk}"
    subprocess.Popen(cmd, shell=True)
    return 1
`,
    "db/001_schema.sql": `CREATE TABLE merchant_accounts (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  legacy_tax_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settlement_batches (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  total_cents BIGINT NOT NULL
);
`,
    "db/002_unsafe_drop.sql": `-- Migração intencionalmente insegura para aferir validateMigrationSafety
ALTER TABLE merchant_accounts DROP COLUMN legacy_tax_id;
CREATE INDEX idx_settlement_batches_merchant ON settlement_batches (merchant_id);
`,
    "config/legacy-webhook.env.sample": `# Arquivo de integração com credencial sintética plantada para aferir Gitleaks/Native Secret Scanner
LEGACYPAY_CI_TOKEN=${syntheticGhToken}
LEGACYPAY_WEBHOOK_URL=https://hooks.legacypay.example.internal/v1/notify
`,
    "docs/adr-010-idempotency-keys.md": `# ADR-010: Chaves de Idempotência na Captura de Pagamentos

## Contexto
Pagamentos submetidos em redes móveis instáveis sofrem reenvios automáticos pelo cliente SDK.

## Decisão
Todas as chamadas de \`processPaymentCapture\` exigem o cabeçalho \`X-Idempotency-Key\` com janela de retenção de 24 horas no Postgres e bloqueio otimista por \`merchant_id + key\`.

## Consequências
Retentativas dentro de 24h devolvem exatamente o payload original sem duplicar lançamentos no \`LedgerReconciler\`.
`,
    "docs/pci-scope.md": `# Escopo de Conformidade PCI-DSS & LGPD

## Segregação de Dados Sensíveis
Nenhum PAN (Primary Account Number) ou CVV pode trafegar em logs ou consultas SQL dinâmicas concatenadas.
A tabela \`merchant_accounts\` armazena apenas metadados fiscais públicos e identificadores tokenizados.
`,
    "tests/payment-router.test.mjs": `import assert from "node:assert/strict";
const fee = Math.round((10_000 * 245) / 10_000);
assert.equal(fee, 245);
console.log("test ok");
`,
  };

  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf8");
  }

  const gabarito = {
    projectName: "LegacyPay Gateway (Brownfield QA)",
    repoPath: outDir,
    expectedAst: {
      typescriptSymbols: [
        "PaymentCaptureInput",
        "calculateFeeBasisPoints",
        "processPaymentCapture",
        "LedgerReconciler",
        "recordSettlement",
      ],
      pythonSymbols: ["FraudScorer", "score_transaction", "settle_batch"],
      sqlSymbols: ["merchant_accounts", "settlement_batches"],
      expectedLanguages: ["typescript", "python", "sql"],
    },
    expectedQmd: {
      query: "idempotencia captura pagamentos X-Idempotency-Key 24 horas",
      expectedTop3SourceIncludes: "adr-010-idempotency-keys",
    },
    expectedMigrationSafety: {
      targetFile: "db/002_unsafe_drop.sql",
      expectedBlocked: true,
      expectedRuleIds: ["no_drop_column", "create_index_without_concurrently"],
    },
    expectedSecurityFindings: {
      secretFile: "config/legacy-webhook.env.sample",
      sastFiles: ["src/payment-router.ts", "workers/settlement_worker.py"],
      scaPackages: ["lodash", "axios"],
    },
  };

  fs.writeFileSync(
    path.join(outDir, "gabarito.json"),
    JSON.stringify(gabarito, null, 2),
    "utf8"
  );

  execFileSync("git", ["init", "-b", "main"], { cwd: outDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Uzina QA Bot"], {
    cwd: outDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.email", "qa-bot@uzina.local"], {
    cwd: outDir,
    stdio: "pipe",
  });
  execFileSync("git", ["add", "."], { cwd: outDir, stdio: "pipe" });
  execFileSync(
    "git",
    ["commit", "-m", "chore: seed legacypay brownfield fixture"],
    { cwd: outDir, stdio: "pipe" }
  );

  return { outDir, gabarito };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const outIdx = process.argv.indexOf("--out");
  const customOut = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
  const result = seedLegacyPayFixture(customOut);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        repoPath: result.outDir,
        gabaritoPath: path.join(result.outDir, "gabarito.json"),
      },
      null,
      2
    )
  );
}
