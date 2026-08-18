import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";

const COLLECTION = "whatsapp_logs";
let indexesReady = false;

export async function ensureWhatsappLogIndexes(db: Db): Promise<void> {
  if (indexesReady) return;
  const collection = db.collection(COLLECTION);
  await Promise.all([
    collection.createIndex({ direction: 1, sid: 1 }),
    collection.createIndex(
      { direction: 1, sid: 1, inboundUnique: 1 },
      {
        unique: true,
        partialFilterExpression: {
          direction: "inbound",
          sid: { $type: "string" },
          inboundUnique: true,
        },
      },
    ),
    collection.createIndex({ reservationId: 1, createdAt: -1 }),
  ]);
  indexesReady = true;
}

export async function insertWhatsappOutboundLog(
  db: Db,
  doc: {
    reservationId: string;
    to: string;
    sid: string | null;
    status: string;
    template: string | null;
    templateVariables?: Record<string, string>;
    error?: string | null;
  },
): Promise<void> {
  await ensureWhatsappLogIndexes(db);
  await db.collection(COLLECTION).insertOne({
    direction: "outbound" as const,
    reservationId: doc.reservationId,
    to: doc.to,
    sid: doc.sid,
    status: doc.status,
    template: doc.template,
    templateVariables: doc.templateVariables ?? null,
    error: doc.error ?? null,
    createdAt: new Date(),
  });
}

/**
 * Reclama un MessageSid inbound antes de mutar la reserva.
 * `false` indica un reintento ya procesado o en proceso.
 */
export async function claimWhatsappInboundLog(
  db: Db,
  doc: {
    from: string;
    sid: string | null;
    action: string | null;
    error?: string | null;
  },
): Promise<string | null> {
  await ensureWhatsappLogIndexes(db);
  const sid = doc.sid?.trim() || null;
  const now = new Date();
  const claimToken = randomUUID();
  try {
    await db.collection(COLLECTION).insertOne({
      direction: "inbound" as const,
      inboundUnique: Boolean(sid),
      from: doc.from,
      sid,
      action: doc.action,
      status: doc.error ? "ignored" : "processing",
      reservationId: null,
      error: doc.error ?? null,
      claimToken,
      claimedAt: now,
      createdAt: now,
    });
    return claimToken;
  } catch (error) {
    if (
      sid &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const staleBefore = new Date(now.getTime() - 2 * 60_000);
      const reclaimed = await db.collection(COLLECTION).findOneAndUpdate(
        {
          direction: "inbound",
          sid,
          inboundUnique: true,
          $or: [
            { status: "failed" },
            { status: "processing", claimedAt: { $lt: staleBefore } },
          ],
        },
        {
          $set: {
            status: "processing",
            action: doc.action,
            error: null,
            claimToken,
            claimedAt: now,
          },
        },
        { returnDocument: "before" },
      );
      return reclaimed ? claimToken : null;
    }
    throw error;
  }
}

export async function completeWhatsappInboundLog(
  db: Db,
  input: {
    sid: string | null;
    from: string;
    claimToken: string;
    reservationId?: string | null;
    action?: string | null;
    status: "processed" | "ignored" | "failed";
    error?: string | null;
  },
): Promise<void> {
  const sid = input.sid?.trim() || null;
  const filter = sid
    ? {
        direction: "inbound",
        sid,
        inboundUnique: true,
        claimToken: input.claimToken,
      }
    : {
        direction: "inbound",
        from: input.from,
        status: "processing",
        claimToken: input.claimToken,
      };

  await db.collection(COLLECTION).updateOne(
    filter,
    {
      $set: {
        reservationId: input.reservationId ?? null,
        action: input.action ?? null,
        status: input.status,
        error: input.error ?? null,
        processedAt: new Date(),
      },
    },
  );
}

export async function findReservationIdByOutboundMessageSid(
  db: Db,
  messageSid: string,
): Promise<string | null> {
  await ensureWhatsappLogIndexes(db);
  const log = await db.collection(COLLECTION).findOne(
    {
      direction: "outbound",
      sid: messageSid,
      reservationId: { $type: "string" },
    },
    { projection: { reservationId: 1 } },
  );
  const reservationId = log?.reservationId;
  return typeof reservationId === "string" && reservationId.trim()
    ? reservationId.trim()
    : null;
}
