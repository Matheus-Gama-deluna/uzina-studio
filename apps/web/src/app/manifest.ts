import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Uzina Studio — Fábrica de Software com IA",
    short_name: "Uzina",
    description:
      "Cockpit mobile e desktop para engenharia de software orientada a especificações, voz e aprovações HITL.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#161513",
    theme_color: "#161513",
    lang: "pt-BR",
    categories: ["developer tools", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Gravar Nova Ideia",
        short_name: "Nova Ideia",
        description: "Capturar nova ideia por voz ou texto",
        url: "/app/ideas?quickVoice=1",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Caixa de Decisões",
        short_name: "Decisões",
        description: "Revisar aprovações HITL pendentes",
        url: "/app/decisions",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Central da Agência",
        short_name: "Agência",
        description: "Conversar com os agentes e fases",
        url: "/app",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
    share_target: {
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "media",
            accept: ["image/*", "text/plain"],
          },
        ],
      },
    },
  };
}
