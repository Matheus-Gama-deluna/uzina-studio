import type { DesignTokensW3C } from "@uzina/contracts";

export const MAX_PROTOTYPE_HTML_BYTES = 2 * 1024 * 1024;

export class PrototypePayloadTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = "PAYLOAD_TOO_LARGE";

  constructor(message = "HTML do protótipo excede o limite de 2 MiB.") {
    super(message);
    this.name = "PrototypePayloadTooLargeError";
  }
}

const DANGEROUS_PAIRED_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "applet",
  "noscript",
  "template",
];

const DANGEROUS_VOID_TAGS = ["base", "meta"];

export function sanitizePrototypeHtml(
  rawHtml: string,
  options?: { maxBytes?: number }
): string {
  const maxBytes = options?.maxBytes ?? MAX_PROTOTYPE_HTML_BYTES;
  const byteSize = new TextEncoder().encode(rawHtml).byteLength;
  if (byteSize > maxBytes) {
    throw new PrototypePayloadTooLargeError(
      `HTML do protótipo (${byteSize} bytes) excede o limite de ${maxBytes} bytes.`
    );
  }

  let html = rawHtml;

  // Remove comentários condicionais IE ou comentários que escondem scripts
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of DANGEROUS_PAIRED_TAGS) {
    const pairedRe = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`,
      "gi"
    );
    const selfClosingRe = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    html = html.replace(pairedRe, "").replace(selfClosingRe, "");
  }

  for (const tag of DANGEROUS_VOID_TAGS) {
    const voidRe = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    html = html.replace(voidRe, "");
  }

  // Remove atributos inline de eventos (onClick, onerror, onload, etc.)
  html = html.replace(
    /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    ""
  );

  // Neutraliza href/src/action/formaction com javascript:, vbscript: ou data:text/html
  html = html.replace(
    /\b(href|src|xlink:href|formaction)\s*=\s*(["'])\s*(?:javascript:|vbscript:|data:text\/html)[^"']*\2/gi,
    '$1="#"'
  );
  html = html.replace(
    /\b(href|src|xlink:href|formaction)\s*=\s*(?:javascript:|vbscript:|data:text\/html)[^\s>]+/gi,
    '$1="#"'
  );

  // Bloqueia <form action="https://..."> externo para evitar exfiltração
  html = html.replace(
    /\baction\s*=\s*(["'])\s*(?:https?:|\/\/|javascript:|vbscript:)[^"']*\1/gi,
    'action="#"'
  );

  // Remove expressões CSS legadas ou @import externos dentro de <style> / style=""
  html = html.replace(/expression\s*\([^)]*\)/gi, "none");
  html = html.replace(/@import\s+[^;]+;/gi, "");

  return html.trim();
}

export function extractW3CDesignTokens(htmlOrCss: string): DesignTokensW3C {
  const colorEntries: DesignTokensW3C["color"] = {};
  const typographyEntries: DesignTokensW3C["typography"] = {};
  const spacingEntries: DesignTokensW3C["spacing"] = {};
  const radiusEntries: DesignTokensW3C["radius"] = {};

  // Extrai cores oklch(...) e hex (#rrggbb)
  const oklchMatches = htmlOrCss.match(/oklch\([^)]+\)/gi) ?? [];
  const hexMatches = htmlOrCss.match(/#[0-9a-fA-F]{6}\b/g) ?? [];

  const uniqueColors = Array.from(
    new Set([...oklchMatches, ...hexMatches])
  ).slice(0, 8);

  if (uniqueColors.length === 0) {
    colorEntries["surface"] = { $value: "#09090b", $type: "color" };
    colorEntries["accent"] = { $value: "#38bdf8", $type: "color" };
  } else {
    uniqueColors.forEach((val, idx) => {
      const tokenName =
        idx === 0 ? "primary" : idx === 1 ? "surface" : `palette-${idx + 1}`;
      colorEntries[tokenName] = { $value: val, $type: "color" };
    });
  }

  // Tipografia via Tailwind ou font-family
  const fontMatch = htmlOrCss.match(/font-family\s*:\s*([^;}"']+)/i);
  if (fontMatch?.[1]) {
    typographyEntries["body"] = {
      $value: fontMatch[1].trim(),
      $type: "fontFamily",
    };
  } else if (/\bfont-mono\b/.test(htmlOrCss)) {
    typographyEntries["mono"] = {
      $value: "JetBrains Mono, monospace",
      $type: "fontFamily",
    };
  }
  if (!typographyEntries["body"]) {
    typographyEntries["body"] = {
      $value: "Inter, system-ui, sans-serif",
      $type: "fontFamily",
    };
  }

  // Espaçamento via Tailwind (p-4, gap-6, etc.)
  const spacingTokens = new Map<string, string>();
  const spacingMatches = htmlOrCss.matchAll(/\b(?:p|px|py|gap)-(\d+)\b/g);
  for (const m of spacingMatches) {
    const scale = Number(m[1]);
    if (Number.isFinite(scale) && scale > 0 && spacingTokens.size < 4) {
      spacingTokens.set(`space-${m[1]}`, `${(scale * 0.25).toFixed(2)}rem`);
    }
  }
  if (spacingTokens.size === 0) {
    spacingEntries["md"] = { $value: "1.00rem", $type: "dimension" };
  } else {
    for (const [k, v] of spacingTokens.entries()) {
      spacingEntries[k] = { $value: v, $type: "dimension" };
    }
  }

  // Raio via Tailwind (rounded-md, rounded-xl, etc.)
  if (/\brounded-xl\b/.test(htmlOrCss)) {
    radiusEntries["xl"] = { $value: "0.75rem", $type: "dimension" };
  } else if (/\brounded-lg\b/.test(htmlOrCss)) {
    radiusEntries["lg"] = { $value: "0.50rem", $type: "dimension" };
  } else {
    radiusEntries["md"] = { $value: "0.375rem", $type: "dimension" };
  }

  return {
    color: colorEntries,
    typography: typographyEntries,
    spacing: spacingEntries,
    radius: radiusEntries,
  };
}

export function generateMermaidWireframeFromSpec(
  title: string,
  specSummary?: string | null
): string {
  const safeTitle = title.replace(/["`<>]/g, "").slice(0, 60) || "Fluxo UI";
  const steps = (specSummary ?? "")
    .split(/->|\r?\n|;/)
    .map((s) => s.replace(/["`<>]/g, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  if (steps.length < 2) {
    return [
      "flowchart LR",
      `  A["Entrada (${safeTitle})"] --> B["Visão Principal"]`,
      '  B --> C["Ação / Validação"]',
      '  C --> D["Estado Confirmado"]',
    ].join("\n");
  }

  const lines = ["flowchart LR"];
  steps.forEach((step, idx) => {
    const nodeId = `S${idx + 1}`;
    const nextId = `S${idx + 2}`;
    if (idx < steps.length - 1) {
      lines.push(`  ${nodeId}["${step}"] --> ${nextId}["${steps[idx + 1]}"]`);
    }
  });
  return lines.join("\n");
}

export function renderTokensToDesignMdSection(
  tokens: DesignTokensW3C,
  title: string
): string {
  const colorLines = Object.entries(tokens.color)
    .map(([k, v]) => `- \`color.${k}\`: \`${v.$value}\``)
    .join("\n");
  const typoLines = Object.entries(tokens.typography)
    .map(([k, v]) => `- \`typography.${k}\`: \`${v.$value}\``)
    .join("\n");
  const spacingLines = Object.entries(tokens.spacing)
    .map(([k, v]) => `- \`spacing.${k}\`: \`${v.$value}\``)
    .join("\n");
  const radiusLines = Object.entries(tokens.radius)
    .map(([k, v]) => `- \`radius.${k}\`: \`${v.$value}\``)
    .join("\n");

  return [
    `## Direção Visual Aprovada — ${title}`,
    "",
    "### Paleta W3C DTCG",
    colorLines,
    "",
    "### Tipografia",
    typoLines,
    "",
    "### Espaçamento & Raio",
    spacingLines,
    radiusLines,
  ].join("\n");
}
