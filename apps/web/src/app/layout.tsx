import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MswProvider } from "@/components/msw-provider";
import { PwaProvider } from "@/components/pwa-provider";
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
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Uzina Studio",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#161513" },
    { media: "(prefers-color-scheme: light)", color: "#F7F5F2" },
  ],
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
          <QueryProvider>
            {children}
            <PwaProvider />
          </QueryProvider>
        </MswProvider>
      </body>
    </html>
  );
}
