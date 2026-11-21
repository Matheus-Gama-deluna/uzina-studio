import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { UzinaDb } from "./client.js";
import { deliverables } from "./schema/workspace.js";

export interface AcquireDeliverableLockInput {
  deliverableId: string;
  workerId: string;
  ttlMinutes?: number;
}

export interface AcquireDeliverableLockResult {
  acquired: boolean;
  lockedBy: string | null;
  lockedAt: Date | null;
}

export interface DeliverableLockOwnerInput {
  deliverableId: string;
  workerId: string;
}

/**
 * Adquire lock exclusivo em SQL para um entregável usando TTL explícito,
 * permitindo takeover apenas quando o lock não existe ou expirou.
 */
export async function acquireDeliverableLock(
  db: UzinaDb,
  input: AcquireDeliverableLockInput
): Promise<AcquireDeliverableLockResult> {
  const ttlMinutes = input.ttlMinutes ?? 5;
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) {
    throw new RangeError("ttlMinutes deve ser um inteiro >= 1");
  }
  if (input.workerId.trim().length === 0) {
    throw new RangeError("workerId não pode ser vazio");
  }

  const now = sql`NOW()`;
  const acquiredRows = await db
    .update(deliverables)
    .set({
      lockedBy: input.workerId,
      lockedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(deliverables.id, input.deliverableId),
        or(
          isNull(deliverables.lockedBy),
          isNull(deliverables.lockedAt),
          sql`${deliverables.lockedAt} < NOW() - make_interval(mins => ${ttlMinutes}::int)`
        )
      )
    )
    .returning();

  const acquiredRow = acquiredRows[0];
  if (acquiredRow) {
    return {
      acquired: true,
      lockedBy: acquiredRow.lockedBy,
      lockedAt: acquiredRow.lockedAt,
    };
  }

  const [current] = await db
    .select({
      lockedBy: deliverables.lockedBy,
      lockedAt: deliverables.lockedAt,
    })
    .from(deliverables)
    .where(eq(deliverables.id, input.deliverableId))
    .limit(1);

  return {
    acquired: false,
    lockedBy: current?.lockedBy ?? null,
    lockedAt: current?.lockedAt ?? null,
  };
}

/**
 * Renova o TTL do lock apenas se o worker informado ainda for o dono atual.
 */
export async function renewDeliverableLock(
  db: UzinaDb,
  input: DeliverableLockOwnerInput
): Promise<boolean> {
  const now = sql`NOW()`;
  const rows = await db
    .update(deliverables)
    .set({
      lockedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(deliverables.id, input.deliverableId),
        eq(deliverables.lockedBy, input.workerId)
      )
    )
    .returning();

  return rows.length === 1;
}

/**
 * Libera o lock apenas se pertencer ao worker informado.
 */
export async function releaseDeliverableLock(
  db: UzinaDb,
  input: DeliverableLockOwnerInput
): Promise<boolean> {
  const rows = await db
    .update(deliverables)
    .set({
      lockedBy: null,
      lockedAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(deliverables.id, input.deliverableId),
        eq(deliverables.lockedBy, input.workerId)
      )
    )
    .returning();

  return rows.length === 1;
}
