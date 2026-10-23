import type { Db, ObjectId } from "mongodb";
import { after } from "next/server";
import webpush from "web-push";

const COLLECTION = "panel_push_subscriptions";

type PanelPushSubscriptionDoc = {
  _id: ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSuccessAt: Date | null;
};

export type PanelPushPayload = {
  title: string;
  body: string;
  url: string;
};

export type PushReservationNotice = {
  customerName: string;
  treatmentName: string;
  displayDate: string;
  timeLocal: string;
  dateKey: string;
};

let indexesReady: Promise<void> | null = null;
let vapidReady = false;

function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function ensureVapid(): boolean {
  const config = vapidConfig();
  if (!config) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidReady = true;
  }
  return true;
}

function ensureIndexes(db: Db): Promise<void> {
  if (!indexesReady) {
    indexesReady = db
      .collection(COLLECTION)
      .createIndex({ endpoint: 1 }, { unique: true })
      .then(() => undefined)
      .catch((error) => {
        indexesReady = null;
        throw error;
      });
  }
  return indexesReady;
}

function statusCodeOf(error: unknown): number | null {
  if (error instanceof webpush.WebPushError) return error.statusCode;
  return null;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function noticeName(customerName: string): string {
  const name = customerName.trim();
  return name.length >= 2 ? clip(name, 60) : "Clienta";
}

function noticeDetail(input: PushReservationNotice): string {
  const parts = [input.treatmentName, input.displayDate, input.timeLocal]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return clip(parts.join(" · "), 140);
}

function noticeUrl(dateKey: string, cancelled: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "/panel-turnos";
  const fecha = encodeURIComponent(dateKey);
  return cancelled ? `/panel-turnos?fecha=${fecha}&ver=cancelados` : `/panel-turnos?fecha=${fecha}`;
}

export function newReservationPush(input: PushReservationNotice): PanelPushPayload {
  return {
    title: `Nuevo turno: ${noticeName(input.customerName)}`,
    body: noticeDetail(input),
    url: noticeUrl(input.dateKey, false),
  };
}

export function cancelledReservationPush(
  input: PushReservationNotice,
  viaWhatsApp: boolean,
): PanelPushPayload {
  const detail = noticeDetail(input);
  return {
    title: `Turno cancelado: ${noticeName(input.customerName)}`,
    body: viaWhatsApp && detail ? `${detail} · desde WhatsApp` : detail,
    url: noticeUrl(input.dateKey, true),
  };
}

export async function savePanelSubscription(
  db: Db,
  input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent: string | null;
  },
): Promise<void> {
  await ensureIndexes(db);
  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { endpoint: input.endpoint },
    {
      $set: {
        keys: input.keys,
        userAgent: input.userAgent,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
        lastSuccessAt: null,
      },
    },
    { upsert: true },
  );
}

export async function removePanelSubscription(db: Db, endpoint: string): Promise<void> {
  await db.collection(COLLECTION).deleteOne({ endpoint });
}

export async function sendPanelPush(
  db: Db,
  payload: PanelPushPayload,
  onlyEndpoint?: string,
): Promise<{ sent: number; removed: number; failed: number }> {
  if (!ensureVapid()) return { sent: 0, removed: 0, failed: 0 };
  await ensureIndexes(db);
  const query = onlyEndpoint ? { endpoint: onlyEndpoint } : {};
  const subs = await db.collection<PanelPushSubscriptionDoc>(COLLECTION).find(query).toArray();
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 60 * 60 * 12, urgency: "high" },
      );
      sent += 1;
      await db.collection(COLLECTION).updateOne({ _id: sub._id }, { $set: { lastSuccessAt: new Date() } });
    } catch (error) {
      const status = statusCodeOf(error);
      if (status === 404 || status === 410) {
        removed += 1;
        await db.collection(COLLECTION).deleteOne({ _id: sub._id });
      } else {
        failed += 1;
        console.error("[panel-push] no se pudo entregar", { status });
      }
    }
  }

  return { sent, removed, failed };
}

/** No demora la reserva. Si faltan las claves, no hace nada. */
export function schedulePanelPush(db: Db, payload: PanelPushPayload): void {
  if (!vapidConfig()) return;
  const run = () =>
    sendPanelPush(db, payload).catch((error) => {
      console.error("[panel-push]", error instanceof Error ? error.message : "error");
    });
  try {
    after(run);
  } catch (error) {
    console.error("[panel-push] after", error instanceof Error ? error.message : "error");
    void run();
  }
}

export function scheduleNewReservationPush(db: Db, input: PushReservationNotice): void {
  schedulePanelPush(db, newReservationPush(input));
}

export function scheduleCancelledReservationPush(
  db: Db,
  input: PushReservationNotice,
  viaWhatsApp: boolean,
): void {
  schedulePanelPush(db, cancelledReservationPush(input, viaWhatsApp));
}
