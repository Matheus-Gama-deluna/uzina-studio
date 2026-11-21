import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uzina Studio — Diagnóstico do Sistema",
  description:
    "Fábrica de Software com IA open-source e self-hosted. Walking Skeleton (Slice 0).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
