import type { Db, ObjectId } from "mongodb";
import { MongoServerError, ObjectId as ObjectIdCtor } from "mongodb";

import {
  type AgendaBlockRecurrence,
  type AgendaBlockScope,
  agendaBlockAppliesToDateKey,
  parseDateKeyLocal,
} from "@/lib/booking/agenda-blocks-shared";
import { formatSalonDisplayDate } from "@/lib/booking/salon-availability";
import { salonConcurrentCapAtInstant, slotIntervalMs, type IntervalMs } from "@/lib/booking/slot-overlap";

export type { AgendaBlockRecurrence, AgendaBlockScope, AgendaBlockRule } from "@/lib/booking/agenda-blocks-shared";
export { agendaBlockAppliesToDateKey } from "@/lib/booking/agenda-blocks-shared";

export const AGENDA_BLOCKS_COLLECTION = "salon_agenda_blocks";

export type SalonAgendaBlockDoc = {
  _id: ObjectId;
  anchorDateKey: string;
  anchorWeekday: number;
  timeLocal: string;
  durationMinutes: number;
  startsAt: Date;
  displayDate: string;
  scope: AgendaBlockScope;
  recurrence: AgendaBlockRecurrence;
  notes?: string | null;
  createdAt: Date;
  createdBy?: string | null;
};

export type ExpandedAgendaBlocks = {
  salon: IntervalMs[];
  chair1: IntervalMs[];
  chair2: IntervalMs[];
};

const INDEXES_VERSION = 1;
let indexesApplied = 0;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function intervalForAgendaBlockOnDate(doc: SalonAgendaBlockDoc, dateKey: string): IntervalMs | null {
  if (!agendaBlockAppliesToDateKey(doc, dateKey)) return null;
  return slotIntervalMs(dateKey, doc.timeLocal, doc.durationMinutes);
}

export async function ensureAgendaBlockIndexes(db: Db) {
  if (indexesApplied >= INDEXES_VERSION) return;
  const col = db.collection(AGENDA_BLOCKS_COLLECTION);
  await col.createIndex({ anchorDateKey: 1 }, { name: "ab_anchor" });
  await col.createIndex({ "recurrence.type": 1, anchorWeekday: 1, anchorDateKey: 1 }, { name: "ab_weekly_lookup" });
  indexesApplied = INDEXES_VERSION;
}

export async function loadExpandedAgendaBlocksForDate(db: Db, dateKey: string): Promise<ExpandedAgendaBlocks> {
  await ensureAgendaBlockIndexes(db);
  const wd = parseDateKeyLocal(dateKey)?.getDay();
  if (wd === undefined) {
    return { salon: [], chair1: [], chair2: [] };
  }

  const col = db.collection<SalonAgendaBlockDoc>(AGENDA_BLOCKS_COLLECTION);
  const rows = await col
    .find({
      $or: [
        {
          anchorDateKey: dateKey,
          $or: [{ recurrence: null }, { recurrence: { $exists: false } }],
        },
        {
          "recurrence.type": "weekly",
          anchorWeekday: wd,
          anchorDateKey: { $lte: dateKey },
          $or: [
            { "recurrence.untilDateKey": null },
            { "recurrence.untilDateKey": { $exists: false } },
            { "recurrence.untilDateKey": "" },
            { "recurrence.untilDateKey": { $gte: dateKey } },
          ],
        },
      ],
    })
    .project({
      anchorDateKey: 1,
      anchorWeekday: 1,
      timeLocal: 1,
      durationMinutes: 1,
      scope: 1,
      recurrence: 1,
    })
    .toArray();

  const salon: IntervalMs[] = [];
  const chair1: IntervalMs[] = [];
  const chair2: IntervalMs[] = [];

  for (const doc of rows) {
    if (!agendaBlockAppliesToDateKey(doc as SalonAgendaBlockDoc, dateKey)) continue;
    const iv = intervalForAgendaBlockOnDate(doc as SalonAgendaBlockDoc, dateKey);
    if (!iv) continue;
    const scope = (doc as SalonAgendaBlockDoc).scope;
    if (scope === "salon") salon.push(iv);
    else if (scope === "chair_1") chair1.push(iv);
    else if (scope === "chair_2") chair2.push(iv);
  }

  return { salon, chair1, chair2 };
}

/** Bloqueos de agenda que aplican a `dateKey` (incluye notas y alcance para UI). */
export async function listSalonAgendaBlocksApplyingToDateKey(db: Db, dateKey: string): Promise<SalonAgendaBlockDoc[]> {
  await ensureAgendaBlockIndexes(db);
  const wd = parseDateKeyLocal(dateKey)?.getDay();
  if (wd === undefined) return [];

  const col = db.collection<SalonAgendaBlockDoc>(AGENDA_BLOCKS_COLLECTION);
  const rows = await col
    .find({
      $or: [
        {
          anchorDateKey: dateKey,
          $or: [{ recurrence: null }, { recurrence: { $exists: false } }],
        },
        {
          "recurrence.type": "weekly",
          anchorWeekday: wd,
          anchorDateKey: { $lte: dateKey },
          $or: [
            { "recurrence.untilDateKey": null },
            { "recurrence.untilDateKey": { $exists: false } },
            { "recurrence.untilDateKey": "" },
            { "recurrence.untilDateKey": { $gte: dateKey } },
          ],
        },
      ],
    })
    .toArray();

  return rows.filter((doc) => agendaBlockAppliesToDateKey(doc, dateKey));
}

function instantInsideOpenInterval(iv: IntervalMs, instantMs: number): boolean {
  return iv.startMs < instantMs && instantMs < iv.endMs;
}

/** Capacidad efectiva de turnos simultáneos según bloqueos de agenda (silla / salón). */
export function buildEffectiveCapGetter(
  dateKey: string,
  expanded: ExpandedAgendaBlocks,
): (instantMs: number) => number {
  return (instantMs: number) => {
    const base = salonConcurrentCapAtInstant(dateKey, instantMs);
    const salonHit = expanded.salon.some((iv) => instantInsideOpenInterval(iv, instantMs));
    if (salonHit) return 0;
    const c1 = expanded.chair1.some((iv) => instantInsideOpenInterval(iv, instantMs));
    const c2 = expanded.chair2.some((iv) => instantInsideOpenInterval(iv, instantMs));
    const chairsTaken = (c1 ? 1 : 0) + (c2 ? 1 : 0);
    // Cada silla bloqueada resta 1 cupo del tope del día (1 o 2 según jueves/sábado).
    return Math.max(0, base - chairsTaken);
  };
}

/** Cupo efectivo (incluye bloqueos) para un día; reutilizar en varias validaciones el mismo día. */
export async function buildCapGetterForDate(db: Db, dateKey: string): Promise<(instantMs: number) => number> {
  const expanded = await loadExpandedAgendaBlocksForDate(db, dateKey);
  return buildEffectiveCapGetter(dateKey, expanded);
}

function monthRangeKeys(year: number, month: number) {
  const from = `${year}-${pad2(month)}-01`;
  const last = new Date(year, month, 0).getDate();
  const to = `${year}-${pad2(month)}-${pad2(last)}`;
  return { from, to };
}

export async function listAgendaBlocksForDateKeyRange(
  db: Db,
  from: string,
  to: string,
): Promise<SalonAgendaBlockDoc[]> {
  await ensureAgendaBlockIndexes(db);
  const col = db.collection<SalonAgendaBlockDoc>(AGENDA_BLOCKS_COLLECTION);
  return col
    .find({
      $or: [
        {
          $or: [{ recurrence: null }, { recurrence: { $exists: false } }],
          anchorDateKey: { $gte: from, $lte: to },
        },
        {
          "recurrence.type": "weekly",
          anchorDateKey: { $lte: to },
          $or: [
            { "recurrence.untilDateKey": null },
            { "recurrence.untilDateKey": { $exists: false } },
            { "recurrence.untilDateKey": "" },
            { "recurrence.untilDateKey": { $gte: from } },
          ],
        },
      ],
    })
    .sort({ anchorDateKey: 1, timeLocal: 1 })
    .toArray();
}

export async function listAgendaBlocksForCalendarMonth(
  db: Db,
  year: number,
  month: number,
): Promise<SalonAgendaBlockDoc[]> {
  const { from, to } = monthRangeKeys(year, month);
  return listAgendaBlocksForDateKeyRange(db, from, to);
}

export function buildCapGetterFromAgendaBlocks(
  dateKey: string,
  blocks: SalonAgendaBlockDoc[],
): (instantMs: number) => number {
  const expanded: ExpandedAgendaBlocks = { salon: [], chair1: [], chair2: [] };
  for (const doc of blocks) {
    const iv = intervalForAgendaBlockOnDate(doc, dateKey);
    if (!iv) continue;
    if (doc.scope === "salon") expanded.salon.push(iv);
    else if (doc.scope === "chair_1") expanded.chair1.push(iv);
    else if (doc.scope === "chair_2") expanded.chair2.push(iv);
  }
  return buildEffectiveCapGetter(dateKey, expanded);
}

export type InsertAgendaBlockInput = {
  anchorDateKey: string;
  timeLocal: string;
  durationMinutes: number;
  scope: AgendaBlockScope;
  recurrence: AgendaBlockRecurrence;
  notes?: string | null;
};

export async function insertAgendaBlock(
  db: Db,
  input: InsertAgendaBlockInput,
): Promise<{ ok: true; id: string } | { error: string; code?: string }> {
  const anchorDateKey = input.anchorDateKey.trim();
  const timeLocal = input.timeLocal.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateKey)) {
    return { error: "Fecha inválida.", code: "INVALID_DATE" };
  }
  if (!/^\d{2}:\d{2}$/.test(timeLocal)) {
    return { error: "Horario inválido.", code: "INVALID_TIME" };
  }
  const dm = input.durationMinutes;
  if (!Number.isFinite(dm) || dm < 15 || dm > 12 * 60) {
    return { error: "Duración inválida (entre 15 min y 12 h).", code: "INVALID_DURATION" };
  }
  const scope = input.scope;
  if (scope !== "salon" && scope !== "chair_1" && scope !== "chair_2") {
    return { error: "Alcance inválido.", code: "INVALID_SCOPE" };
  }

  let recurrence: AgendaBlockRecurrence = null;
  if (input.recurrence && input.recurrence.type === "weekly") {
    const until = input.recurrence.untilDateKey?.trim();
    if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < anchorDateKey)) {
      return { error: "Fecha de fin de recurrencia inválida.", code: "INVALID_UNTIL" };
    }
    recurrence = { type: "weekly", untilDateKey: until || null };
  }

  const anchorDt = parseDateKeyLocal(anchorDateKey);
  if (!anchorDt) return { error: "Fecha inválida.", code: "INVALID_DATE" };

  const startsAt = new Date(`${anchorDateKey}T${timeLocal}:00-03:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }

  await ensureAgendaBlockIndexes(db);
  const now = new Date();
  const createdBy = (process.env.PANEL_TURNOS_CREATED_BY ?? "panel").trim() || "panel";

  const doc = {
    anchorDateKey,
    anchorWeekday: anchorDt.getDay(),
    timeLocal,
    durationMinutes: Math.round(dm),
    startsAt,
    displayDate: formatSalonDisplayDate(anchorDateKey),
    scope,
    recurrence,
    notes: input.notes?.trim() ? String(input.notes).trim().slice(0, 500) : null,
    createdAt: now,
    createdBy,
  } satisfies Omit<SalonAgendaBlockDoc, "_id">;

  try {
    const r = await db.collection(AGENDA_BLOCKS_COLLECTION).insertOne(doc);
    return { ok: true, id: r.insertedId.toHexString() };
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      return { error: "No se pudo guardar el bloqueo.", code: "DUPLICATE" };
    }
    throw e;
  }
}

export async function deleteAgendaBlockByHexId(db: Db, hexId: string): Promise<boolean> {
  try {
    const _id = new ObjectIdCtor(hexId);
    const r = await db.collection(AGENDA_BLOCKS_COLLECTION).deleteOne({ _id });
    return r.deletedCount === 1;
  } catch {
    return false;
  }
}
