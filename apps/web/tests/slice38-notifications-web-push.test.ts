import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NotificationListResponseSchema,
  NotificationPreferencesSchema,
  PushSubscriptionInputSchema,
} from "@uzina/contracts";
import { closeDb, getDb, pushSubscriptions, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import {
  GET as getPrefs,
  PUT as updatePrefs,
} from "../src/app/api/notifications/preferences/route";
import { POST as markReadPost } from "../src/app/api/notifications/read/route";
import { GET as listNotificationsGet } from "../src/app/api/notifications/route";
import {
  DELETE as deletePushSubPost,
  POST as subscribePushPost,
} from "../src/app/api/notifications/subscriptions/route";
import { POST as testNotificationPost } from "../src/app/api/notifications/test/route";
import { resetAuthForTests } from "../src/lib/auth";
import {
  dispatchNotificationEvent,
  isWithinQuietHours,
} from "../src/lib/notifications-service";
import {
  resetVapidKeysCacheForTests,
  resolveVapidKeys,
} from "../src/lib/vapid";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Slice 38 — Web Push, VAPID, Quiet Hours, RBAC & Central de Notificações (PGlite)", () => {
  let ownerCookie = "";
  let outsiderCookie = "";
  let organizationId = "";
  let ownerUserId = "";

  beforeAll(async () => {
    resetAuthForTests();
    resetVapidKeysCacheForTests();
    await closeDb();

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Push Owner",
          email: "push-s38@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    ownerCookie = cookieOf(signUpRes);

    const outsiderSignUp = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Push Outsider",
          email: "outsider-s38@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(outsiderSignUp.status).toBe(200);
    outsiderCookie = cookieOf(outsiderSignUp);

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );
    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: outsiderCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "push-s38@uzina.studio"));
    organizationId = ownerRow?.organizationId ?? "";
    ownerUserId = ownerRow?.id ?? "";
    expect(organizationId.length).toBeGreaterThan(10);
    expect(ownerUserId.length).toBeGreaterThan(10);
  });

  afterAll(async () => {
    resetVapidKeysCacheForTests();
    resetAuthForTests();
    await closeDb();
  });

  test.each([
    {
      label: "desabilitado retorna false",
      iso: "2026-11-26T02:00:00.000Z",
      prefs: {
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        timezone: "UTC",
      },
      expected: false,
    },
    {
      label: "janela noturna cruzando meia-noite (23:30 UTC dentro)",
      iso: "2026-11-26T23:30:00.000Z",
      prefs: {
        quietHoursEnabled: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        timezone: "UTC",
      },
      expected: true,
    },
    {
      label: "janela noturna cruzando meia-noite (06:15 UTC dentro)",
      iso: "2026-11-26T06:15:00.000Z",
      prefs: {
        quietHoursEnabled: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        timezone: "UTC",
      },
      expected: true,
    },
    {
      label: "janela noturna (14:00 UTC fora)",
      iso: "2026-11-26T14:00:00.000Z",
      prefs: {
        quietHoursEnabled: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        timezone: "UTC",
      },
      expected: false,
    },
    {
      label: "janela diurna (12:30 UTC dentro)",
      iso: "2026-11-26T12:30:00.000Z",
      prefs: {
        quietHoursEnabled: true,
        quietHoursStart: "12:00",
        quietHoursEnd: "13:30",
        timezone: "UTC",
      },
      expected: true,
    },
  ])("isWithinQuietHours: $label", ({ iso, prefs, expected }) => {
    expect(isWithinQuietHours(new Date(iso), prefs)).toBe(expected);
  });

  test("PushSubscriptionInputSchema bloqueia SSRF em HTTP, localhost e IMDS 169.254", () => {
    const valid = PushSubscriptionInputSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc-123",
      keys: { p256dh: "BEl62iUYgUivxIkv69yViEuiBIa", auth: "1234567890" },
    });
    expect(valid.success).toBe(true);

    for (const badUrl of [
      "http://fcm.googleapis.com/fcm/send/123",
      "https://127.0.0.1:8080/push",
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1.nip.io/push",
    ]) {
      const res = PushSubscriptionInputSchema.safeParse({
        endpoint: badUrl,
        keys: { p256dh: "BEl62iUYgUivxIkv69yViEuiBIa", auth: "1234567890" },
      });
      expect(res.success).toBe(false);
    }
  });

  test("resolveVapidKeys persiste chaves em arquivo de forma idempotente", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-vapid-"));
    try {
      const first = resolveVapidKeys({}, tmpDir);
      const second = resolveVapidKeys({}, tmpDir);
      expect(first.source).toBe("file");
      expect(second.publicKey).toBe(first.publicKey);
      expect(second.privateKey).toBe(first.privateKey);
      expect(fs.existsSync(path.join(tmpDir, ".vapid-keys.json"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("fluxo API completo: subscription, preferências, test push, leitura e purga automática de endpoint 410 Gone", async () => {
    const endpointAlive = "https://updates.push.services.mozilla.com/wpush/v2/alive-1";
    const subRes = await subscribePushPost(
      new Request("http://localhost:3000/api/notifications/subscriptions", {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          endpoint: endpointAlive,
          keys: {
            p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg",
            auth: "1234567890123456",
          },
          surface: "technical",
        }),
      })
    );
    expect(subRes.status).toBe(201);

    // Tentativa de sequestro cross-tenant do mesmo endpoint retorna 409 Conflict
    const hijackRes = await subscribePushPost(
      new Request("http://localhost:3000/api/notifications/subscriptions", {
        method: "POST",
        headers: {
          cookie: outsiderCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          endpoint: endpointAlive,
          keys: {
            p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg",
            auth: "1234567890123456",
          },
          surface: "technical",
        }),
      })
    );
    expect(hijackRes.status).toBe(409);

    const prefsGetRes = await getPrefs(
      new Request("http://localhost:3000/api/notifications/preferences", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(prefsGetRes.status).toBe(200);
    const initialPrefs = NotificationPreferencesSchema.parse(
      await prefsGetRes.json()
    );

    const prefsPutRes = await updatePrefs(
      new Request("http://localhost:3000/api/notifications/preferences", {
        method: "PUT",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...initialPrefs,
          quietHoursEnabled: true,
          quietHoursStart: "22:00",
          quietHoursEnd: "08:00",
          timezone: "UTC",
          allowCriticalDuringQuietHours: true,
        }),
      })
    );
    expect(prefsPutRes.status).toBe(200);

    const { db } = await getDb();

    // Durante Quiet Hours (23:00 UTC), evento normal grava in-app mas suprime push
    let pushCalls = 0;
    const quietDispatch = await dispatchNotificationEvent(
      db,
      {
        organizationId,
        targetUserId: ownerUserId,
        eventType: "decision_pending",
        surface: "technical",
        title: "Decisão em horário silencioso",
        body: "Deve aparecer apenas na Central In-App.",
        actionUrl: "/app/decisions",
      },
      {
        now: new Date("2026-11-26T23:00:00.000Z"),
        sendPushImpl: async () => {
          pushCalls += 1;
        },
      }
    );
    expect(quietDispatch.createdCount).toBe(1);
    expect(quietDispatch.pushedCount).toBe(0);
    expect(quietDispatch.suppressedByQuietHours).toBe(1);
    expect(pushCalls).toBe(0);

    // Durante Quiet Hours, security_critical faz bypass e ao receber 410 Gone remove a subscription
    const goneDispatch = await dispatchNotificationEvent(
      db,
      {
        organizationId,
        targetUserId: ownerUserId,
        eventType: "security_critical",
        surface: "technical",
        title: "Achado crítico",
        body: "CVE crítico detectado.",
        actionUrl: "/app/security",
      },
      {
        now: new Date("2026-11-26T23:00:00.000Z"),
        sendPushImpl: async () => {
          const err = new Error("Gone") as Error & { statusCode?: number };
          err.statusCode = 410;
          throw err;
        },
      }
    );
    expect(goneDispatch.purgedSubscriptions).toBe(1);

    const remainingSubs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpointAlive));
    expect(remainingSubs).toHaveLength(0);

    // Rota /api/notifications/test cria registro e lista unreadCount corretamente
    const testRes = await testNotificationPost(
      new Request("http://localhost:3000/api/notifications/test", {
        method: "POST",
        headers: { cookie: ownerCookie },
      })
    );
    expect(testRes.status).toBe(200);

    const listRes = await listNotificationsGet(
      new Request("http://localhost:3000/api/notifications", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(listRes.status).toBe(200);
    const listData = NotificationListResponseSchema.parse(await listRes.json());
    expect(listData.unreadCount).toBe(3);

    // Isolamento cross-tenant: outro usuário/organização não vê nem altera notificações do owner
    const outsiderListRes = await listNotificationsGet(
      new Request("http://localhost:3000/api/notifications", {
        headers: { cookie: outsiderCookie },
      })
    );
    expect(outsiderListRes.status).toBe(200);
    const outsiderList = NotificationListResponseSchema.parse(
      await outsiderListRes.json()
    );
    expect(outsiderList.items).toHaveLength(0);

    // Marca apenas 1 por ID e valida decremento exato
    const firstId = listData.items[0]!.id;
    const singleReadRes = await markReadPost(
      new Request("http://localhost:3000/api/notifications/read", {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ids: [firstId] }),
      })
    );
    expect(singleReadRes.status).toBe(200);
    expect(((await singleReadRes.json()) as { unreadCount: number }).unreadCount).toBe(2);

    const markRes = await markReadPost(
      new Request("http://localhost:3000/api/notifications/read", {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ all: true }),
      })
    );
    expect(markRes.status).toBe(200);
    const markJson = (await markRes.json()) as { unreadCount: number };
    expect(markJson.unreadCount).toBe(0);

    // DELETE subscription própria e rejeição de unauth
    const unauthList = await listNotificationsGet(
      new Request("http://localhost:3000/api/notifications")
    );
    expect(unauthList.status).toBe(401);

    const endpointTwo = "https://updates.push.services.mozilla.com/wpush/v2/delete-me";
    await subscribePushPost(
      new Request("http://localhost:3000/api/notifications/subscriptions", {
        method: "POST",
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: endpointTwo,
          keys: {
            p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg",
            auth: "1234567890123456",
          },
        }),
      })
    );
    const delRes = await deletePushSubPost(
      new Request("http://localhost:3000/api/notifications/subscriptions", {
        method: "DELETE",
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        body: JSON.stringify({ endpoint: endpointTwo }),
      })
    );
    expect(delRes.status).toBe(200);
    const afterDel = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpointTwo));
    expect(afterDel).toHaveLength(0);
  });
});
