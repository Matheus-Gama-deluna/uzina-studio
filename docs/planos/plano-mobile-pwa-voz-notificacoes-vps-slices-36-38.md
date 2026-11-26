# Plano Consolidado — Uzina Studio Mobile-First, Voz (STT/TTS), Notificações Web Push & Prontidão VPS (Slices 36–38)

> **Branch:** `feat/slices-36-38-mobile-pwa-voice-notifications`
> **Escopo:** Slices 36 (PWA + Mobile Shell + VPS HTTPS), 37 (Voz Bidirecional STT/TTS + Resumo Falado + Captura de Ideias) e 38 (Web Push + Central In-App + Quiet Hours + Quick-Decisions).

## Resumo dos 3 Slices

1. **Slice 36 — PWA Instalável, Ergonomia Mobile & VPS HTTPS:**
   - `apps/web/src/app/manifest.ts`, `apps/web/public/sw.js` (manual, Turbopack-safe, bypass `/api/*`, update controlado via `SKIP_WAITING`, Push + NotificationClick + App Badging), `/offline` e ícones PWA reais.
   - `share_target` (`POST /api/share`) direcionando texto/links para `/app/ideas`.
   - `viewport` (`viewportFit: "cover"`, `interactiveWidget: "resizes-content"`), `appleWebApp`, `<PwaProvider />`, `<PwaInstallBanner />`.
   - Bottom Tab Bar fixa `< 768px` (`Agência · Decisões · Entregas · Estúdio · Mais`) com `MobileBottomSheet` (`vaul`), `useVisualViewportKeyboard`, `useVisibilityReconnect`, `useOfflineDraftQueue` (IndexedDB) e `useWakeLock`.
   - `auth.ts` com `BETTER_AUTH_TRUSTED_ORIGINS` e `useSecureCookies` em HTTPS, `next.config.ts` headers `/sw.js` + `Permissions-Policy`, `docker-compose.vps.yml` + `deploy/Caddyfile` (`flush_interval -1` para SSE) e `docs/deploy-vps-mobile.md`.

2. **Slice 37 — Voz Bidirecional (STT + TTS + Resumo Falado) & Captura de Ideias:**
   - Contratos `packages/contracts/src/voice.ts`, `voiceMode` e `spokenSummary` em `agency.ts` / `copilot.ts`.
   - `packages/mastra-runtime/src/voice-client.ts` (Cofre AES-256-GCM: `openai_compatible` OpenAI/Groq/Kokoro + `google` Gemini + fallback `browser_speech` + `buildSpokenSummary`).
   - Rotas `POST /api/voice/transcribe` (em memória `<= 15MB`) e `POST /api/voice/speak` (cache LRU 5 min, `audio/mpeg`).
   - `apps/web/src/lib/voice-browser.ts` (`MediaRecorder.isTypeSupported` WebM/MP4 iOS, `unlockMobileAudio()`, Waveform `AnalyserNode`, `MediaSession` para fones/tela bloqueada, fallback `speechSynthesis`).
   - `VoiceComposerControls` (ditado revisável + Modo Voz contínuo por turnos), `MessageAudioPlayer`, gravação 1-toque em `/app/ideas` e presets/seletor de voz em `/app/providers`.

3. **Slice 38 — Web Push, Central In-App, Quiet Hours & Quick-Decision Cards:**
   - Contratos `packages/contracts/src/notifications.ts`, schema `packages/db/src/schema/notifications.ts` e migração `0014` (`push_subscriptions`, `notifications`, `notification_preferences`).
   - `apps/web/src/lib/vapid.ts` (env ou `.vapid-keys.json` `0600`) e `notifications-service.ts` (RBAC `technical`/`executive`, Quiet Hours cruzando meia-noite, purga automática `404`/`410`, App Badging).
   - Hooks não-bloqueantes em criação de decisão HITL, transição de deliverable, achado crítico AppSec e resposta em background.
   - Rotas `/api/notifications/*`, `<NotificationsCenter />`, página `/app/settings` (Push, PWA status, Quiet Hours, Voz) e Quick-Decision Cards mobile (ouvir Risk Briefing + pedir ajuste por voz + confirmação explícita por toque).
