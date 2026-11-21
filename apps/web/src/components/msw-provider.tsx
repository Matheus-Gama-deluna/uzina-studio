"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const MswClient = dynamic(
  () => import("./msw-client").then((mod) => mod.MswClient),
  { ssr: false }
);

export function MswProvider({ children }: { children: ReactNode }) {
  const isMswDevPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

  if (!isMswDevPreview) {
    return <>{children}</>;
  }

  return <MswClient>{children}</MswClient>;
}
