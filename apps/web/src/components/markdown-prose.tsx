"use client";

import type { ReactNode } from "react";

function formatInlineMarkdown(line: string): ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((segment, index) => {
    if (
      segment.startsWith("**") &&
      segment.endsWith("**") &&
      segment.length > 4
    ) {
      return (
        <strong key={index} className="font-semibold text-fg-primary">
          {segment.slice(2, -2)}
        </strong>
      );
    }
    if (segment.startsWith("`") && segment.endsWith("`") && segment.length > 2) {
      return (
        <code
          key={index}
          className="rounded border border-border-subtle bg-inset px-1.5 py-0.5 font-mono text-[0.875em] text-fg-primary"
        >
          {segment.slice(1, -1)}
        </code>
      );
    }
    return <span key={index}>{segment}</span>;
  });
}

export function MarkdownProse({
  content,
  className = "text-[15px] leading-7 text-fg-primary",
}: {
  content: string;
  className?: string;
}) {
  const lines = content.split(/\r?\n/);
  return (
    <div className={`space-y-2 ${className}`}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1.5" />;
        }
        if (trimmed === "---") {
          return <hr key={idx} className="my-2 border-border-subtle" />;
        }
        if (trimmed.startsWith("### ")) {
          return (
            <h4
              key={idx}
              className="pt-2 text-sm font-semibold tracking-tight text-fg-primary"
            >
              {formatInlineMarkdown(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
          const clean = trimmed.replace(/^#+\s*/, "");
          return (
            <h3
              key={idx}
              className="pt-2 text-base font-semibold tracking-tight text-fg-primary"
            >
              {formatInlineMarkdown(clean)}
            </h3>
          );
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-1">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-fg-muted" />
              <span>{formatInlineMarkdown(trimmed.slice(2))}</span>
            </div>
          );
        }
        return <p key={idx}>{formatInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}
