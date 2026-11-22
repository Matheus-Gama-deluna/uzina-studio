import type {
  TestAntiPatternRule,
  TestAuditFinding,
  TestAuditReport,
} from "@uzina/contracts";

interface ExtractedTestBlock {
  title: string;
  line: number;
  startIndex: number;
  endIndex: number;
  body: string;
  normalizedBody: string;
  isParameterized: boolean;
  suppressionContext: string;
}

const SUPPRESSION_REGEX =
  /\/\/\s*@uzina-test-audit-ignore\s+(missing_assertion|trivial_assertion_only|swallowed_exception|arbitrary_sleep|duplicate_test_blocks)\s*:\s*([^\r\n]+)/g;

function extractSuppressions(
  text: string
): Map<TestAntiPatternRule, string> {
  const map = new Map<TestAntiPatternRule, string>();
  SUPPRESSION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = SUPPRESSION_REGEX.exec(text);
  while (match !== null) {
    const rule = match[1] as TestAntiPatternRule;
    const rationale = match[2]?.trim() ?? "";
    if (rationale.length >= 4) {
      map.set(rule, rationale);
    }
    match = SUPPRESSION_REGEX.exec(text);
  }
  return map;
}

function stripStringsAndComments(source: string): string {
  let out = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < len && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < len) {
        out += "  ";
        i += 2;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += quote;
      i += 1;
      while (i < len) {
        const cur = source[i]!;
        if (cur === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (cur === quote) {
          out += quote;
          i += 1;
          break;
        }
        out += cur === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

function findMatchingDelimiter(
  maskedSource: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  for (let i = openIndex; i < maskedSource.length; i += 1) {
    const ch = maskedSource[i];
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function countLineNumber(source: string, index: number): number {
  let lines = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") {
      lines += 1;
    }
  }
  return lines;
}

function normalizeBodyForDuplicateCheck(rawBody: string): string {
  const withoutComments = rawBody
    .replace(/\/\/[^\r\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const normalizedLiterals = withoutComments
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '"STR"')
    .replace(/\b\d+(?:\.\d+)?\b/g, "0")
    .replace(/\s+/g, " ")
    .trim();
  return normalizedLiterals;
}

function extractTestTitle(rawCallSlice: string): string {
  const match = rawCallSlice.match(/^\s*\(?\s*(["'`])([\s\S]*?)\1/);
  const candidate = match?.[2]?.trim();
  return candidate && candidate.length > 0 ? candidate.slice(0, 120) : "(anonymous test)";
}

function extractTestBlocks(source: string): ExtractedTestBlock[] {
  const masked = stripStringsAndComments(source);
  const blocks: ExtractedTestBlock[] = [];
  const callRegex =
    /(?:^|[^\w$.])(it|test)(?:\.(only|skip|concurrent|todo|each))?(?:\.(only|skip|concurrent))?\s*\(/g;

  let match: RegExpExecArray | null = callRegex.exec(masked);
  while (match !== null) {
    const fullMatch = match[0];
    const fnKeywordOffset = fullMatch.search(/\b(it|test)\b/);
    const startIndex = match.index + Math.max(0, fnKeywordOffset);
    const openParenIndex = match.index + fullMatch.length - 1;
    const closeParenIndex = findMatchingDelimiter(
      masked,
      openParenIndex,
      "(",
      ")"
    );
    if (closeParenIndex === -1) {
      match = callRegex.exec(masked);
      continue;
    }

    const headerSlice = source.slice(startIndex, openParenIndex);
    const isTodo = /\.todo\b/.test(headerSlice);
    const isParameterized = /\.each\b|\.for\b/.test(headerSlice);
    if (isTodo) {
      callRegex.lastIndex = closeParenIndex + 1;
      match = callRegex.exec(masked);
      continue;
    }

    let searchEnd = closeParenIndex;
    let bodySlice = source.slice(openParenIndex + 1, closeParenIndex);
    let maskedBodySlice = masked.slice(openParenIndex + 1, closeParenIndex);

    // Suporte a it.each([...])("title", ({ ... }) => { ... })
    if (isParameterized) {
      let cursor = closeParenIndex + 1;
      while (cursor < masked.length && /\s/.test(masked[cursor] ?? "")) {
        cursor += 1;
      }
      if (masked[cursor] === "(") {
        const secondClose = findMatchingDelimiter(masked, cursor, "(", ")");
        if (secondClose !== -1) {
          searchEnd = secondClose;
          bodySlice = source.slice(cursor + 1, secondClose);
          maskedBodySlice = masked.slice(cursor + 1, secondClose);
        }
      }
    }

    // Extrai o corpo da função callback ({ ... }) se presente, senão usa todo o argumento
    const arrowOrFnIdx = maskedBodySlice.search(/=>\s*\{|\bfunction\b[^{]*\{/);
    let innerBody = bodySlice;
    if (arrowOrFnIdx !== -1) {
      const braceOpenRel = maskedBodySlice.indexOf("{", arrowOrFnIdx);
      if (braceOpenRel !== -1) {
        const braceCloseRel = findMatchingDelimiter(
          maskedBodySlice,
          braceOpenRel,
          "{",
          "}"
        );
        if (braceCloseRel !== -1) {
          innerBody = bodySlice.slice(braceOpenRel + 1, braceCloseRel);
        }
      }
    }

    const line = countLineNumber(source, startIndex);
    const linePrefixStart = Math.max(
      0,
      source.lastIndexOf("\n", Math.max(0, startIndex - 1))
    );
    const prevLineStart = Math.max(
      0,
      source.lastIndexOf("\n", Math.max(0, linePrefixStart - 1))
    );
    const suppressionContext =
      source.slice(prevLineStart, startIndex) + "\n" + innerBody;

    blocks.push({
      title: extractTestTitle(bodySlice),
      line,
      startIndex,
      endIndex: searchEnd,
      body: innerBody,
      normalizedBody: normalizeBodyForDuplicateCheck(innerBody),
      isParameterized,
      suppressionContext,
    });

    callRegex.lastIndex = searchEnd + 1;
    match = callRegex.exec(masked);
  }

  return blocks;
}

const STRONG_ASSERTION_REGEX =
  /\b(?:expect|assert|assertType)\s*(?:<[^>]+>)?\s*\(|\.\s*(?:rejects|resolves)\b|\bexpect\.(?:assertions|hasAssertions|any|anything|objectContaining|arrayContaining|stringContaining|stringMatching)\b/;

const TRIVIAL_CHAIN_REGEX =
  /\bexpect\s*\([^)]*\)\s*(?:\.\s*not)?\s*\.\s*(?:toBeTruthy|toBeDefined|toBeFalsy|toBeUndefined|toBeNull)\s*\(\s*\)/g;

const NON_TRIVIAL_CHAIN_REGEX =
  /\.\s*(?:toBe|toEqual|toStrictEqual|toMatchObject|toContain|toContainEqual|toMatch|toHaveLength|toHaveProperty|toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|toBeCloseTo|toThrow|toThrowError|toHaveBeenCalled|toHaveBeenCalledTimes|toHaveBeenCalledWith|toBeInstanceOf|toSatisfy|rejects|resolves)\b|\bassert\.[A-Za-z_]+\(/;

const SLEEP_REGEX =
  /\b(?:setTimeout|setInterval)\s*\(|\b(?:sleep|delay|waitMs)\s*\(/;

function hasSwallowedException(rawBody: string): boolean {
  const masked = stripStringsAndComments(rawBody);
  const catchRegex = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
  let match: RegExpExecArray | null = catchRegex.exec(masked);
  while (match !== null) {
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = findMatchingDelimiter(masked, braceStart, "{", "}");
    if (braceEnd === -1) {
      match = catchRegex.exec(masked);
      continue;
    }
    const catchInner = masked.slice(braceStart + 1, braceEnd).trim();
    const hasMeaningfulAction =
      /\b(?:throw|expect|assert|reject|fail|return\s+false)\b/.test(
        catchInner
      ) || /\bexpect\b/.test(catchInner);
    if (!hasMeaningfulAction) {
      return true;
    }
    match = catchRegex.exec(masked);
  }
  return false;
}

export function auditTestSource(
  filePath: string,
  source: string
): TestAuditReport {
  const fileSuppressions = extractSuppressions(source);
  const blocks = extractTestBlocks(source);
  const violations: TestAuditFinding[] = [];
  let suppressedCount = 0;

  const pushFinding = (
    block: ExtractedTestBlock,
    rule: TestAntiPatternRule,
    message: string
  ) => {
    const blockSuppressions = extractSuppressions(block.suppressionContext);
    const reason =
      blockSuppressions.get(rule) ?? fileSuppressions.get(rule) ?? null;
    if (reason) {
      suppressedCount += 1;
      return;
    }
    violations.push({
      filePath,
      line: block.line,
      testTitle: block.title,
      rule,
      message,
      suppressed: false,
      suppressionReason: null,
    });
  };

  const duplicateBuckets = new Map<string, ExtractedTestBlock[]>();

  for (const block of blocks) {
    const maskedBody = stripStringsAndComments(block.body);
    const hasAssertion =
      STRONG_ASSERTION_REGEX.test(maskedBody) ||
      NON_TRIVIAL_CHAIN_REGEX.test(maskedBody);

    if (!hasAssertion) {
      pushFinding(
        block,
        "missing_assertion",
        "Teste sem asserção real (expect/assert ausente)."
      );
    } else {
      const trivialMatches = maskedBody.match(TRIVIAL_CHAIN_REGEX) ?? [];
      if (trivialMatches.length > 0 && !NON_TRIVIAL_CHAIN_REGEX.test(maskedBody)) {
        pushFinding(
          block,
          "trivial_assertion_only",
          "Teste contém apenas asserção trivial isolada (toBeTruthy/toBeDefined/etc.)."
        );
      }
    }

    if (hasSwallowedException(block.body)) {
      pushFinding(
        block,
        "swallowed_exception",
        "Bloco catch vazio ou engolindo exceção sem falha nem asserção."
      );
    }

    if (SLEEP_REGEX.test(maskedBody)) {
      pushFinding(
        block,
        "arbitrary_sleep",
        "Uso de setTimeout/sleep arbitrário em teste."
      );
    }

    if (!block.isParameterized && block.normalizedBody.length >= 24) {
      const list = duplicateBuckets.get(block.normalizedBody) ?? [];
      list.push(block);
      duplicateBuckets.set(block.normalizedBody, list);
    }
  }

  for (const [, bucket] of duplicateBuckets) {
    if (bucket.length >= 3) {
      const representative = bucket[2]!;
      pushFinding(
        representative,
        "duplicate_test_blocks",
        `${bucket.length} blocos de teste com corpo idêntico fora de test.each/it.each.`
      );
    }
  }

  return {
    passed: violations.length === 0,
    scannedFiles: 1,
    scannedTests: blocks.length,
    suppressedCount,
    violations,
  };
}

export function mergeTestAuditReports(
  reports: readonly TestAuditReport[]
): TestAuditReport {
  const violations: TestAuditFinding[] = [];
  let scannedFiles = 0;
  let scannedTests = 0;
  let suppressedCount = 0;

  for (const report of reports) {
    scannedFiles += report.scannedFiles;
    scannedTests += report.scannedTests;
    suppressedCount += report.suppressedCount;
    violations.push(...report.violations);
  }

  return {
    passed: violations.length === 0,
    scannedFiles,
    scannedTests,
    suppressedCount,
    violations,
  };
}
