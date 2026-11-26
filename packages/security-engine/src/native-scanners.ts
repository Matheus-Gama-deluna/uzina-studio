import fs from "node:fs";
import path from "node:path";
import {
  AgenticPromptInjectionFindingSchema,
  type AgenticPromptInjectionFinding,
  type SecuritySeverity,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import {
  computeFindingFingerprint,
  redactFindingFields,
  type RawNormalizedFinding,
} from "./sarif.js";

export interface ScannableFile {
  filePath: string;
  content: string;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  ".worktrees",
  "coverage",
]);

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_COLLECTED = 1000;

export function collectTargetFiles(
  rootDir: string,
  onlyRelativePaths?: readonly string[]
): ScannableFile[] {
  const collected: ScannableFile[] = [];
  if (!fs.existsSync(/*turbopackIgnore: true*/ rootDir)) {
    return collected;
  }

  const readCandidate = (absPath: string, relPath: string) => {
    if (collected.length >= MAX_FILES_COLLECTED) {
      return;
    }
    try {
      const stat = fs.lstatSync(/*turbopackIgnore: true*/ absPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return;
      }
      if (stat.size > MAX_FILE_BYTES) {
        return;
      }
      const buf = fs.readFileSync(/*turbopackIgnore: true*/ absPath);
      if (buf.includes(0)) {
        return;
      }
      collected.push({
        filePath: relPath.replace(/\\/g, "/"),
        content: buf.toString("utf8"),
      });
    } catch {
      // Ignora arquivos inacessíveis sem interromper o scan
    }
  };

  if (onlyRelativePaths && onlyRelativePaths.length > 0) {
    const resolvedRoot = path.resolve(rootDir);
    for (const rel of onlyRelativePaths) {
      const normalized = rel.replace(/\\/g, "/").trim();
      if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
        continue;
      }
      const candidate = path.resolve(resolvedRoot, normalized);
      if (
        !candidate.startsWith(resolvedRoot + path.sep) &&
        candidate !== resolvedRoot
      ) {
        continue;
      }
      readCandidate(candidate, normalized);
    }
    return collected;
  }

  const walk = (dir: string) => {
    if (collected.length >= MAX_FILES_COLLECTED) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(/*turbopackIgnore: true*/ dir, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (collected.length >= MAX_FILES_COLLECTED) {
        break;
      }
      if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        readCandidate(fullPath, rel);
      }
    }
  };

  walk(rootDir);
  return collected;
}

interface SecretRule {
  ruleId: string;
  title: string;
  severity: "critical" | "high";
  regex: RegExp;
}

const SECRET_RULES: readonly SecretRule[] = [
  {
    ruleId: "uzina/native-secret-aws-key",
    title: "Credencial AWS Access Key exposta no código",
    severity: "critical",
    regex: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16,24}(?![A-Z0-9])/g,
  },
  {
    ruleId: "uzina/native-secret-github-token",
    title: "Token GitHub PAT exposto no código",
    severity: "critical",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g,
  },
  {
    ruleId: "uzina/native-secret-api-key",
    title: "Chave de API LLM/Provedor em texto claro",
    severity: "high",
    regex: /\b(?:sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,200}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,200})\b/g,
  },
  {
    ruleId: "uzina/native-secret-private-key",
    title: "Bloco de Chave Privada PEM no repositório",
    severity: "critical",
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    ruleId: "uzina/native-secret-db-password",
    title: "String de conexão com senha em texto claro",
    severity: "high",
    regex: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s/@]+:[^@\s/]+@[^\s/]+/gi,
  },
];

export function scanSecretsNative(
  files: readonly ScannableFile[]
): RawNormalizedFinding[] {
  const findings: RawNormalizedFinding[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx] ?? "";
      for (const rule of SECRET_RULES) {
        rule.regex.lastIndex = 0;
        const match = rule.regex.exec(line);
        if (!match) {
          continue;
        }
        const secretMatch = match[0];
        // Calcula fingerprint SHA-256 ANTES da redação
        const fingerprint = computeFindingFingerprint({
          ruleId: rule.ruleId,
          scanner: "native_secrets",
          filePath: file.filePath,
          lineStart: idx + 1,
          rawSnippet: `${line}::${secretMatch}`,
        });

        findings.push(
          redactFindingFields(
            {
              ruleId: rule.ruleId,
              scanner: "native_secrets",
              severity: rule.severity,
              filePath: file.filePath,
              lineStart: idx + 1,
              title: rule.title,
              description: `Trecho detectado: ${redactSensitiveText(line.trim(), [secretMatch])}`,
              fingerprint,
            },
            [secretMatch]
          )
        );
      }
    }
  }

  return findings;
}

interface DdlRule {
  ruleId: string;
  title: string;
  severity: "critical" | "high";
  regex: RegExp;
}

const DDL_RULES: readonly DdlRule[] = [
  {
    ruleId: "uzina/ddl-drop-destructive",
    title: "Comando DDL destrutivo (DROP TABLE/DATABASE/SCHEMA)",
    severity: "critical",
    regex: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
  },
  {
    ruleId: "uzina/ddl-truncate",
    title: "Comando TRUNCATE TABLE detectado",
    severity: "high",
    regex: /\bTRUNCATE\s+(?:TABLE\s+)?[A-Za-z0-9_."`]+/i,
  },
  {
    ruleId: "uzina/ddl-alter-drop-column",
    title: "Remoção destrutiva de coluna (ALTER TABLE ... DROP COLUMN)",
    severity: "high",
    regex: /\bALTER\s+TABLE\b[\s\S]{0,120}\bDROP\s+COLUMN\b/i,
  },
];

export function scanDdlNative(
  files: readonly ScannableFile[]
): RawNormalizedFinding[] {
  const findings: RawNormalizedFinding[] = [];

  for (const file of files) {
    if (!/\.(?:sql|psql)$/i.test(file.filePath)) {
      continue;
    }
    const lines = file.content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx] ?? "";
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("--")) {
        continue;
      }

      for (const rule of DDL_RULES) {
        if (rule.regex.test(line)) {
          const fingerprint = computeFindingFingerprint({
            ruleId: rule.ruleId,
            scanner: "native_ddl",
            filePath: file.filePath,
            lineStart: idx + 1,
            rawSnippet: trimmed,
          });
          findings.push({
            ruleId: rule.ruleId,
            scanner: "native_ddl",
            severity: rule.severity,
            filePath: file.filePath,
            lineStart: idx + 1,
            title: rule.title,
            description: `Instrução SQL potencialmente destrutiva sem salvaguarda: ${trimmed.slice(0, 240)}`,
            fingerprint,
          });
        }
      }

      // DELETE FROM sem WHERE na mesma instrução
      if (/\bDELETE\s+FROM\b/i.test(line) && !/\bWHERE\b/i.test(line)) {
        const fingerprint = computeFindingFingerprint({
          ruleId: "uzina/ddl-delete-without-where",
          scanner: "native_ddl",
          filePath: file.filePath,
          lineStart: idx + 1,
          rawSnippet: trimmed,
        });
        findings.push({
          ruleId: "uzina/ddl-delete-without-where",
          scanner: "native_ddl",
          severity: "high",
          filePath: file.filePath,
          lineStart: idx + 1,
          title: "DELETE FROM sem cláusula WHERE",
          description: `Comando DELETE sem filtro WHERE detectado: ${trimmed.slice(0, 240)}`,
          fingerprint,
        });
      }
    }
  }

  return findings;
}

const KNOWN_POPULAR_PACKAGES = [
  "express",
  "lodash",
  "axios",
  "react",
  "react-dom",
  "next",
  "typescript",
  "vitest",
  "eslint",
  "zod",
  "drizzle-orm",
  "tailwindcss",
  "better-auth",
] as const;

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }
  return dp[a.length]![b.length]!;
}

const SUSPICIOUS_SCRIPT_REGEX =
  /\b(?:curl|wget|powershell|pwsh|Invoke-WebRequest)\b|\|\s*(?:sh|bash|zsh)\b|base64\s+-d/i;

export function scanSlopsquattingNative(
  files: readonly ScannableFile[]
): RawNormalizedFinding[] {
  const findings: RawNormalizedFinding[] = [];

  for (const file of files) {
    if (path.posix.basename(file.filePath) !== "package.json") {
      continue;
    }

    let parsed: {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(file.content) as typeof parsed;
    } catch {
      continue;
    }

    for (const scriptKey of ["preinstall", "install", "postinstall", "prepare"]) {
      const val = parsed.scripts?.[scriptKey];
      if (typeof val === "string" && SUSPICIOUS_SCRIPT_REGEX.test(val)) {
        findings.push({
          ruleId: "uzina/suspicious-lifecycle-script",
          scanner: "native_slopsquatting",
          severity: "high",
          filePath: file.filePath,
          lineStart: 1,
          title: `Script de lifecycle '${scriptKey}' potencialmente malicioso`,
          description: `O script '${scriptKey}' executa comando remoto ou codificado: ${val.slice(0, 200)}`,
          fingerprint: computeFindingFingerprint({
            ruleId: "uzina/suspicious-lifecycle-script",
            scanner: "native_slopsquatting",
            filePath: file.filePath,
            lineStart: 1,
            rawSnippet: `${scriptKey}:${val}`,
          }),
        });
      }
    }

    const depEntries = [
      ...Object.entries(parsed.dependencies ?? {}),
      ...Object.entries(parsed.devDependencies ?? {}),
    ];

    for (const [pkgName, rawVersion] of depEntries) {
      if (typeof rawVersion !== "string") {
        continue;
      }
      const version = rawVersion.trim();

      if (/^http:\/\//i.test(version)) {
        findings.push({
          ruleId: "uzina/insecure-dependency-url",
          scanner: "native_slopsquatting",
          severity: "high",
          filePath: file.filePath,
          lineStart: 1,
          title: `Dependência '${pkgName}' usa URL HTTP insegura`,
          description: `Dependência '${pkgName}' aponta para '${version}' sem TLS/integridade.`,
          fingerprint: computeFindingFingerprint({
            ruleId: "uzina/insecure-dependency-url",
            scanner: "native_slopsquatting",
            filePath: file.filePath,
            lineStart: 1,
            rawSnippet: `${pkgName}@${version}`,
          }),
        });
      } else if (version === "*" || version === "latest" || version === "next") {
        findings.push({
          ruleId: "uzina/unpinned-dependency",
          scanner: "native_slopsquatting",
          severity: "medium",
          filePath: file.filePath,
          lineStart: 1,
          title: `Dependência '${pkgName}' não pinada ('${version}')`,
          description: `Versão flutuante '${version}' em '${pkgName}' viola pinagem determinística.`,
          fingerprint: computeFindingFingerprint({
            ruleId: "uzina/unpinned-dependency",
            scanner: "native_slopsquatting",
            filePath: file.filePath,
            lineStart: 1,
            rawSnippet: `${pkgName}@${version}`,
          }),
        });
      }

      if (!pkgName.startsWith("@uzina/")) {
        const unscoped = pkgName.startsWith("@")
          ? pkgName.split("/")[1] ?? pkgName
          : pkgName;
        const nearPopular = KNOWN_POPULAR_PACKAGES.find(
          (popular) =>
            unscoped !== popular &&
            unscoped.length >= 4 &&
            levenshtein(unscoped.toLowerCase(), popular) <= 2
        );
        if (nearPopular) {
          findings.push({
            ruleId: "uzina/slopsquatting-typo",
            scanner: "native_slopsquatting",
            severity: "high",
            filePath: file.filePath,
            lineStart: 1,
            title: `Suspeita de slopsquatting/typosquatting em '${pkgName}'`,
            description: `Pacote '${pkgName}' possui distância lexical suspeita em relação a '${nearPopular}'. Confirme existência legítima no registro npm antes de instalar.`,
            fingerprint: computeFindingFingerprint({
              ruleId: "uzina/slopsquatting-typo",
              scanner: "native_slopsquatting",
              filePath: file.filePath,
              lineStart: 1,
              rawSnippet: `${pkgName}->${nearPopular}`,
            }),
          });
        }
      }
    }
  }

  return findings;
}

const WORKFLOW_FILE_RE = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
const AGENT_INSTRUCTION_FILE_RE = /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/i;
const CI_SCRIPT_INJECTION_RE =
  /\$\{\{\s*(?:github\.event\.[^}]+|github\.head_ref)\s*\}\}/;
const CONTROL_TAG_RE =
  /<\/?(?:system|instructions|prompt|developer|assistant|user)\s*>|<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>|\[\/?INST\]|<<\/?SYS>>|<!--[\s\S]{0,200}(?:ignore\s+(?:all\s+)?previous\s+instructions|system\s+override|disregard\s+(?:all\s+)?rules)/i;
const UNICODE_BIDI_OR_ZW_RE =
  /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const EXFIL_FORWARD_RE =
  /\b(?:curl|wget|Invoke-WebRequest|nc)\b.*(?:\$\{?\w*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)\w*\}?|\$\{\{\s*secrets\.[^}]+\}\}|\.env\b|\.master-key\b)/i;
const EXFIL_PIPE_RE =
  /(?:\.env\b|\.master-key\b|\$\{\{\s*secrets\.[^}]+\}\}|\$\{?\w*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)\w*\}?).*\b(?:curl|wget|Invoke-WebRequest|nc)\b/i;
const UNSAFE_DIRECTIVE_RE =
  /\b(?:(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|safety)\s+(?:instructions|rules|constraints)|(?:bypass|disable|skip)\s+(?:all\s+)?(?:security|approval|sandbox|verification)\s+(?:checks?|gates?|guards?))\b/i;

function formatVisibleUnicodeSnippet(line: string): string {
  return line
    .replace(UNICODE_BIDI_OR_ZW_RE, (ch) => {
      const hex = ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0");
      return `[U+${hex ?? "CTRL"}]`;
    })
    .trim();
}

function buildAgenticFinding(params: {
  ruleId: string;
  category: AgenticPromptInjectionFinding["category"];
  severity: SecuritySeverity;
  filePath: string;
  line: number;
  snippet: string;
  message: string;
}): AgenticPromptInjectionFinding {
  const cleanSnippet =
    redactSensitiveText(params.snippet).trim().slice(0, 400) || "(trecho)";
  const cleanMessage = redactSensitiveText(params.message).trim().slice(0, 500);
  return AgenticPromptInjectionFindingSchema.parse({
    ruleId: params.ruleId,
    category: params.category,
    severity: params.severity,
    filePath: params.filePath.slice(0, 500),
    line: params.line,
    matchedSnippet: cleanSnippet,
    message: cleanMessage,
  });
}

export function scanAgenticPromptInjectionNative(
  files: readonly ScannableFile[]
): AgenticPromptInjectionFinding[] {
  const findings: AgenticPromptInjectionFinding[] = [];

  for (const file of files) {
    const normalizedPath = file.filePath.replace(/\\/g, "/");
    const isWorkflow = WORKFLOW_FILE_RE.test(normalizedPath);
    const isAgentInstruction = AGENT_INSTRUCTION_FILE_RE.test(normalizedPath);

    if (!isWorkflow && !isAgentInstruction) {
      continue;
    }

    const lines = file.content.split(/\r?\n/);
    let inRunBlock = false;
    let runBlockIndent = -1;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx] ?? "";
      const lineNumber = idx + 1;
      const trimmed = line.trim();

      if (isWorkflow) {
        const leadingSpaces = line.search(/\S/);
        if (inRunBlock && trimmed && leadingSpaces <= runBlockIndent) {
          inRunBlock = false;
          runBlockIndent = -1;
        }

        const runMatch = line.match(/^(\s*(?:-\s*)?)run:\s*(.*)$/);
        if (runMatch) {
          const runIndent = line.search(/\S/);
          const inlineBody = (runMatch[2] ?? "").trim();
          if (/^[|>][+-]?$/.test(inlineBody)) {
            inRunBlock = true;
            runBlockIndent = runIndent;
          } else {
            inRunBlock = false;
            runBlockIndent = -1;
            if (CI_SCRIPT_INJECTION_RE.test(inlineBody)) {
              findings.push(
                buildAgenticFinding({
                  ruleId: "uzina/agentic-ci-script-injection",
                  category: "ci_script_injection",
                  severity: "critical",
                  filePath: normalizedPath,
                  line: lineNumber,
                  snippet: trimmed,
                  message:
                    "Injeção de script em GitHub Actions: expressão não confiável ${{ github.event.* }} interpolada diretamente em bloco run:.",
                })
              );
            }
          }
        } else if (inRunBlock && CI_SCRIPT_INJECTION_RE.test(line)) {
          findings.push(
            buildAgenticFinding({
              ruleId: "uzina/agentic-ci-script-injection",
              category: "ci_script_injection",
              severity: "critical",
              filePath: normalizedPath,
              line: lineNumber,
              snippet: trimmed,
              message:
                "Injeção de script em GitHub Actions: expressão não confiável ${{ github.event.* }} interpolada em bloco run: multilinha.",
            })
          );
        }
      }

      if (CONTROL_TAG_RE.test(line)) {
        findings.push(
          buildAgenticFinding({
            ruleId: "uzina/agentic-hidden-control-tag",
            category: "hidden_control_tags",
            severity: "high",
            filePath: normalizedPath,
            line: lineNumber,
            snippet: trimmed,
            message:
              "Tag de controle ou delimitador oculto de prompt (<system>, </instructions>, <|im_start|>) detectado em instrução/workflow.",
          })
        );
      }

      UNICODE_BIDI_OR_ZW_RE.lastIndex = 0;
      if (UNICODE_BIDI_OR_ZW_RE.test(line)) {
        findings.push(
          buildAgenticFinding({
            ruleId: "uzina/agentic-unicode-bidi-zw",
            category: "hidden_control_tags",
            severity: "high",
            filePath: normalizedPath,
            line: lineNumber,
            snippet: formatVisibleUnicodeSnippet(line),
            message:
              "Caractere Unicode invisível (zero-width) ou de controle bidirecional (Trojan Source/prompt oculto) detectado.",
          })
        );
      }

      if (EXFIL_FORWARD_RE.test(line) || EXFIL_PIPE_RE.test(line)) {
        findings.push(
          buildAgenticFinding({
            ruleId: "uzina/agentic-shell-exfiltration",
            category: "shell_exfiltration",
            severity: "critical",
            filePath: normalizedPath,
            line: lineNumber,
            snippet: trimmed,
            message:
              "Possível exfiltração de segredos/credenciais via curl/wget/nc envolvendo secrets, .env ou .master-key.",
          })
        );
      }

      if (isAgentInstruction && UNSAFE_DIRECTIVE_RE.test(line)) {
        findings.push(
          buildAgenticFinding({
            ruleId: "uzina/agentic-unsafe-tool-directive",
            category: "unsafe_tool_directive",
            severity: "high",
            filePath: normalizedPath,
            line: lineNumber,
            snippet: trimmed,
            message:
              "Diretiva suspeita instruindo o agente a ignorar regras prévias ou contornar travas de segurança.",
          })
        );
      }
    }
  }

  return findings;
}

export function promptInjectionFindingsToRaw(
  findings: readonly AgenticPromptInjectionFinding[]
): RawNormalizedFinding[] {
  return findings.map((finding) => {
    const fingerprint = computeFindingFingerprint({
      ruleId: finding.ruleId,
      scanner: "native_prompt_injection",
      filePath: finding.filePath,
      lineStart: finding.line,
      rawSnippet: finding.matchedSnippet,
    });
    return redactFindingFields({
      ruleId: finding.ruleId,
      scanner: "native_prompt_injection",
      severity: finding.severity,
      filePath: finding.filePath,
      lineStart: finding.line,
      title: `Prompt/CI Injection (${finding.category})`,
      description: `${finding.message} Trecho: ${finding.matchedSnippet}`,
      fingerprint,
    });
  });
}
