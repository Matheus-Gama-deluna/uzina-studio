# Deploy na VPS & Uso Mobile (PWA, Voz e Web Push)

O Uzina Studio funciona em produção atrás de **HTTPS** (obrigatório para instalação PWA, gravação de microfone, Service Worker e Web Push no iOS e Android).

## Opção A — Stack Completa Standalone com Caddy (HTTPS automático)

1. Aponte o registro DNS `A` / `AAAA` do seu domínio (ex.: `studio.seudominio.com`) para o IP da VPS e libere as portas `80` e `443`.
2. Crie o `.env` na raiz do repositório:

```env
UZINA_DOMAIN=studio.seudominio.com
BETTER_AUTH_URL=https://studio.seudominio.com
BETTER_AUTH_TRUSTED_ORIGINS=https://studio.seudominio.com
POSTGRES_PASSWORD=troque-por-uma-senha-forte
BETTER_AUTH_SECRET=gere-com-openssl-rand-hex-32
MASTER_ENCRYPTION_KEY=gere-com-openssl-rand-hex-32
VAPID_SUBJECT=mailto:voce@seudominio.com
```

> **Chaves VAPID:** se `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` não forem definidas no `.env`, o Uzina gera e persiste automaticamente em `/data/.vapid-keys.json` (permissão `0600`) na primeira inicialização.

3. Suba os containers:

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
```

4. *(Opcional)* Para TTS self-hosted gratuito com **Kokoro-82M** rodando na própria VPS:

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile voice-local up -d
```

Depois adicione em **Provedores & LLM** o preset **Kokoro TTS Local** apontando para `http://kokoro-tts:8880/v1`.

---

## Opção B — Coolify, Dokploy, Traefik, Nginx ou Cloudflare Tunnel

Use apenas o `docker-compose.yml` padrão apontando o proxy externo para a porta `3000` do serviço `uzina`:

- Defina `BETTER_AUTH_URL=https://seu-dominio` e `BETTER_AUTH_TRUSTED_ORIGINS=https://seu-dominio`.
- **Importante para SSE em tempo real (Nginx / Traefik):** desative proxy buffering nas rotas `/api/agency/chat/stream` e `/api/deliverables/*/events` (`proxy_buffering off;` no Nginx).

---

## Checklist de Instalação Mobile

- **Android (Chrome / Edge):** abra `https://seu-dominio`, toque em **Instalar app** no banner superior (ou menu `⋮ → Instalar aplicativo`) e ative as notificações em **Configurações & Celular** (`/app/settings`).
- **iPhone / iPad (iOS Safari 16.4+):**
  1. Abra `https://seu-dominio` no **Safari**.
  2. Toque em **Compartilhar → Adicionar à Tela de Início**.
  3. **Abra o app pelo ícone da Tela de Início** (o iOS só libera `PushManager` e tela cheia dentro do PWA instalado).
  4. Acesse **Mais → Notificações & Celular** (`/app/settings`) e toque em **Ativar Notificações Push**.
