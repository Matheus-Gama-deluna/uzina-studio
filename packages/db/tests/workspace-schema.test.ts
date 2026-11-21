import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projectRepositories,
  projects,
  providerProfiles,
  users,
} from "../src/index.js";

describe("@uzina/db — Slice 1 Workspace Schema & Seed", () => {
  afterAll(async () => {
    await closeDb();
  });

  test("ensureDefaultOrgAndInternalClient cria organização padrão e cliente 'Internos' de forma idempotente", async () => {
    await closeDb();
    const { db } = await getDb({ dataDir: ":memory:" });

    const [user] = await db
      .insert(users)
      .values({ name: "Fundador", email: "fundador@uzina.studio" })
      .returning();

    const first = await ensureDefaultOrgAndInternalClient(db, user?.id);
    const second = await ensureDefaultOrgAndInternalClient(db, user?.id);

    expect(second.organizationId).toBe(first.organizationId);
    expect(second.internalClientId).toBe(first.internalClientId);

    const [internalClient] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, first.internalClientId));
    expect(internalClient?.name).toBe("Internos");
    expect(internalClient?.slug).toBe("internos");
    expect(internalClient?.isDefaultInternal).toBe(true);

    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user?.id ?? ""));
    expect(updatedUser?.organizationId).toBe(first.organizationId);
    expect(updatedUser?.role).toBe("owner");

    // Segundo usuário sem convite recebe organização isolada própria (não entra na org do 1º)
    const [secondUser] = await db
      .insert(users)
      .values({ name: "Outro Operador", email: "outro@uzina.studio" })
      .returning();
    expect(secondUser?.role).toBe("auditor");

    const isolated = await ensureDefaultOrgAndInternalClient(db, secondUser?.id);
    expect(isolated.organizationId).not.toBe(first.organizationId);
    expect(isolated.internalClientId).not.toBe(first.internalClientId);
  });

  test("persiste hierarquia Org -> Client -> Project -> Repo -> Deliverable + ProviderProfile e aplica UNIQUE", async () => {
    await closeDb();
    const { db } = await getDb({ dataDir: ":memory:" });

    const [orgA] = await db
      .insert(organizations)
      .values({ name: "Org Alpha", slug: "org-alpha" })
      .returning();
    const [orgB] = await db
      .insert(organizations)
      .values({ name: "Org Beta", slug: "org-beta" })
      .returning();

    const seededA = await ensureDefaultOrgAndInternalClient(db);
    expect(seededA.organizationId).not.toBe(orgA?.id);

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: orgA?.id ?? "",
        name: "Cliente Alpha",
        slug: "cliente-alpha",
      })
      .returning();

    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: orgB?.id ?? "",
        name: "Cliente Beta",
        slug: "cliente-alpha",
      })
      .returning();

    expect(clientA?.id).not.toBe(clientB?.id);

    const [project] = await db
      .insert(projects)
      .values({
        clientId: clientA?.id ?? "",
        name: "Portal Alpha",
        slug: "portal-alpha",
        defaultDevelopmentStrategy: "frontend_first_msw",
      })
      .returning();

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId: project?.id ?? "",
        name: "portal-web",
        localPath: "/repos/portal-web",
      })
      .returning();

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        projectId: project?.id ?? "",
        repositoryId: repo?.id ?? null,
        title: "Autenticação inicial",
        hasUi: true,
      })
      .returning();

    expect(deliverable?.status).toBe("discovery");
    expect(deliverable?.hasUi).toBe(true);

    const [profile] = await db
      .insert(providerProfiles)
      .values({
        organizationId: orgA?.id ?? "",
        name: "OmniRoute Principal",
        providerType: "omniroute",
        baseUrl: "http://localhost:8080/v1",
        encryptedApiKey: "v1:00:11:22",
        keyPreview: "sk-...1234",
        roleBindingsJson: { builder: { modelId: "claude-sonnet" } },
        isDefault: true,
      })
      .returning();

    expect(profile?.keyPreview).toBe("sk-...1234");
    expect(profile?.roleBindingsJson.builder?.modelId).toBe("claude-sonnet");

    // Constraints UNIQUE por tenant/pai
    await expect(
      db.insert(clients).values({
        organizationId: orgA?.id ?? "",
        name: "Duplicado",
        slug: "cliente-alpha",
      })
    ).rejects.toThrow();

    await expect(
      db.insert(projects).values({
        clientId: clientA?.id ?? "",
        name: "Projeto Duplicado",
        slug: "portal-alpha",
      })
    ).rejects.toThrow();
  });
});
