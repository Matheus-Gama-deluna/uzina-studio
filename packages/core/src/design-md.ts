import type { DesignAsset } from "@uzina/contracts";

export interface GenerateDesignMdParams {
  projectName: string;
  themePreference: "industrial_dark" | "crisp_light" | "dual_theme";
  assets: readonly DesignAsset[];
  notes?: string;
}

export function generateDesignMdContract(
  params: GenerateDesignMdParams
): string {
  const copyTags: string[] = [];
  const ignoreTags: string[] = [];
  const generalTags: string[] = [];

  for (const asset of params.assets) {
    for (const rawTag of asset.intentionTags) {
      const tag = rawTag.trim();
      if (!tag) continue;
      if (tag.toLowerCase().startsWith("ignorar:")) {
        ignoreTags.push(tag);
      } else if (tag.toLowerCase().startsWith("copiar:")) {
        copyTags.push(tag);
      } else {
        generalTags.push(tag);
      }
    }
  }

  const referencesBlock =
    params.assets.length > 0
      ? params.assets
          .map((asset) => {
            const ref = asset.sourceUrl ?? asset.assetUrl ?? "(sem URL)";
            const tags =
              asset.intentionTags.length > 0
                ? asset.intentionTags.join(", ")
                : "sem tags";
            return `- **${asset.title}** (\`${asset.assetType}\`) — ${ref} | Intenções: \`${tags}\`${asset.notes ? ` | Notas: ${asset.notes}` : ""}`;
          })
          .join("\n")
      : "- Nenhuma referência visual cadastrada ainda (aplicando baseline oficial Uzina Industrial).";

  return [
    `# Contrato Visual — ${params.projectName} (\`.uzina/DESIGN.md\`)`,
    "",
    `- **Modo de Tema:** \`${params.themePreference}\``,
    `- **Conformidade de Contraste:** \`WCAG >= 4.5:1\` em todos os pares texto/superfície`,
    params.notes?.trim() ? `- **Diretriz do Projeto:** ${params.notes.trim()}` : null,
    "",
    `## 1. Paleta Semântica & Tokens (OKLCH / Tailwind v4)`,
    `| Token CSS | Dark Industrial | Crisp Light | Papel |`,
    `| :--- | :--- | :--- | :--- |`,
    `| \`--bg-canvas\` | \`oklch(0.13 0.006 260)\` | \`oklch(0.985 0.002 260)\` | Fundo principal |`,
    `| \`--bg-surface\` | \`oklch(0.17 0.007 260)\` | \`oklch(1 0 0)\` | Painéis, tabelas e cards planos |`,
    `| \`--border-subtle\` | \`oklch(0.24 0.008 260)\` | \`oklch(0.91 0.005 260)\` | Divisórias hairline \`1px\` |`,
    `| \`--fg-primary\` | \`oklch(0.96 0.004 260)\` | \`oklch(0.16 0.010 260)\` | Texto principal |`,
    `| \`--accent\` | \`oklch(0.72 0.16 55)\` | \`oklch(0.60 0.17 48)\` | Acento funcional Âmbar Uzina |`,
    `| \`--status-ok / --status-warn / --status-danger\` | \`155 / 80 / 25\` | \`155 / 75 / 25\` | Semântica + ícone + texto |`,
    "",
    `## 2. Tipografia, Escala & Densidade`,
    `- **UI Sans:** \`Geist, system-ui, sans-serif\``,
    `- **Mono & Numérica:** \`Geist Mono, ui-monospace, monospace\` com \`tabular-nums\` obrigatório em métricas, contadores, preços, timestamps e bytes.`,
    `- **Navegação & Layout:** Bordas \`1px\` planas, hierarquia limpa sem sombras pesadas (\`shadow-xl\` proibido).`,
    "",
    `## 3. Intenções do Moodboard`,
    `- **O que adotar/copiar:** ${[...new Set([...copyTags, ...generalTags])].join(", ") || "densidade-compacta, bordas-1px, alto-contraste"}`,
    `- **O que ignorar explicitamente:** ${[...new Set(ignoreTags)].join(", ") || "gradientes decorativos, card-itis, ruído visual"}`,
    "",
    `### Referências Consolidadas (${params.assets.length})`,
    referencesBlock,
    "",
    `## 4. 5 Estados Obrigatórios de Componente`,
    `1. **Empty:** Mensagem objetiva + 1 CTA primário claro.`,
    `2. **Sparse (1–2 itens):** Alinhamento natural sem estiramento artificial.`,
    `3. **Dense (20+ itens):** Scroll contido + header \`sticky top-0\` + \`truncate\`.`,
    `4. **Loading:** Skeleton com geometria idêntica (\`CLS = 0\`).`,
    `5. **Error:** Alerta em \`--status-danger\` com botão imediato de **Tentar novamente**.`,
    "",
    `## 5. Anti-Padrões Proibidos (Zero "AI Slop")`,
    `- Proibido gradientes roxo/azul/neon decorativos, \`card-itis\`, emojis decorativos em botões/menus e \`<div onClick>\` (usar sempre \`<button type="button">\` ou \`<Link>\`).`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
