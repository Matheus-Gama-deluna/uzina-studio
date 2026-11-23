import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MswProvider } from "@/components/msw-provider";
import { QueryProvider } from "@/components/query-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Uzina Studio — Fábrica de Software com IA",
  description:
    "Plataforma open-source e self-hosted para engenharia de software orientada a especificações.",
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("uzina-theme");if(t==="light"){document.documentElement.dataset.theme="light";}var f=localStorage.getItem("uzina-font-scale");if(f==="compact"||f==="comfortable"||f==="large"){document.documentElement.dataset.fontScale=f;}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-fg-primary antialiased">
        <MswProvider>
          <QueryProvider>{children}</QueryProvider>
        </MswProvider>
      </body>
    </html>
  );
}
