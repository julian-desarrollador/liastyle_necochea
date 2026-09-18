import type { Db } from "mongodb";

import { canonicalPhoneDigitsAR, customerPhoneDigitsQueryValues } from "@/lib/customer/phone-canonical-ar";

import type { VipManual } from "./eligibility";

const COLLECTION = "customer_profiles";

export type DepositExemptManual = boolean | null;

export type CustomerProfileDoc = {
  phoneDigits: string;
  customerName?: string | null;
  /** `true` fuerza VIP; `false` fuerza no-VIP; ausente/`null` = regla automática. */
  vipManual?: boolean | null;
  /**
   * Seña online: `true` = no cobra; `false` = cobra siempre;
   * ausente/`null` = automático (VIP sin seña).
   */
  depositExemptManual?: boolean | null;
  updatedAt: Date;
  updatedBy?: "panel";
};

let indexesReady = false;

export async function ensureCustomerProfileIndexes(db: Db): Promise<void> {
  if (indexesReady) return;
  await db.collection(COLLECTION).createIndex({ phoneDigits: 1 }, { unique: true });
  indexesReady = true;
}

function normalizePhoneKey(phoneDigits: string): string | null {
  const canonical = canonicalPhoneDigitsAR(phoneDigits) || phoneDigits.trim();
  return canonical.length >= 8 ? canonical : null;
}

async function findProfileDoc(db: Db, phoneDigits: string): Promise<CustomerProfileDoc | null> {
  await ensureCustomerProfileIndexes(db);
  const key = normalizePhoneKey(phoneDigits);
  if (!key) return null;

  const keys = customerPhoneDigitsQueryValues(key);
  return db.collection<CustomerProfileDoc>(COLLECTION).findOne({
    phoneDigits: { $in: keys },
  });
}

export async function getVipManualForPhone(db: Db, phoneDigits: string): Promise<VipManual> {
  const doc = await findProfileDoc(db, phoneDigits);
  if (!doc || doc.vipManual == null) return null;
  return doc.vipManual;
}

export async function getDepositExemptManualForPhone(
  db: Db,
  phoneDigits: string,
): Promise<DepositExemptManual> {
  const doc = await findProfileDoc(db, phoneDigits);
  if (!doc || doc.depositExemptManual == null) return null;
  return doc.depositExemptManual;
}

/** Mapa phoneDigits canónico → vipManual (solo overrides existentes). */
export async function getVipManualMapForPhones(
  db: Db,
  phoneDigitsList: string[],
): Promise<Map<string, VipManual>> {
  await ensureCustomerProfileIndexes(db);
  const out = new Map<string, VipManual>();
  if (phoneDigitsList.length === 0) return out;

  const allKeys = new Set<string>();
  const canonicalByKey = new Map<string, string>();
  for (const raw of phoneDigitsList) {
    const key = normalizePhoneKey(raw);
    if (!key) continue;
    for (const v of customerPhoneDigitsQueryValues(key)) {
      allKeys.add(v);
      canonicalByKey.set(v, key);
    }
  }
  if (allKeys.size === 0) return out;

  const docs = await db
    .collection<CustomerProfileDoc>(COLLECTION)
    .find({ phoneDigits: { $in: [...allKeys] } })
    .toArray();

  for (const doc of docs) {
    const canonical = canonicalByKey.get(doc.phoneDigits) ?? normalizePhoneKey(doc.phoneDigits);
    if (!canonical) continue;
    if (doc.vipManual == null) continue;
    out.set(canonical, doc.vipManual);
  }
  return out;
}

/** Mapa phoneDigits canónico → depositExemptManual (solo overrides existentes). */
export async function getDepositExemptManualMapForPhones(
  db: Db,
  phoneDigitsList: string[],
): Promise<Map<string, DepositExemptManual>> {
  await ensureCustomerProfileIndexes(db);
  const out = new Map<string, DepositExemptManual>();
  if (phoneDigitsList.length === 0) return out;

  const allKeys = new Set<string>();
  const canonicalByKey = new Map<string, string>();
  for (const raw of phoneDigitsList) {
    const key = normalizePhoneKey(raw);
    if (!key) continue;
    for (const v of customerPhoneDigitsQueryValues(key)) {
      allKeys.add(v);
      canonicalByKey.set(v, key);
    }
  }
  if (allKeys.size === 0) return out;

  const docs = await db
    .collection<CustomerProfileDoc>(COLLECTION)
    .find({ phoneDigits: { $in: [...allKeys] } })
    .toArray();

  for (const doc of docs) {
    const canonical = canonicalByKey.get(doc.phoneDigits) ?? normalizePhoneKey(doc.phoneDigits);
    if (!canonical) continue;
    if (doc.depositExemptManual == null) continue;
    out.set(canonical, doc.depositExemptManual);
  }
  return out;
}

/**
 * Persiste override VIP.
 * `vipManual: true` → marcar VIP; `null` → borrar override (regla automática).
 */
export async function setVipManualForPhone(
  db: Db,
  phoneDigits: string,
  vipManual: true | null,
  opts?: { customerName?: string | null },
): Promise<VipManual> {
  await ensureCustomerProfileIndexes(db);
  const key = normalizePhoneKey(phoneDigits);
  if (!key) throw new Error("Teléfono inválido.");

  const col = db.collection<CustomerProfileDoc>(COLLECTION);
  const now = new Date();

  if (vipManual === null) {
    await col.updateOne(
      { phoneDigits: key },
      {
        $unset: { vipManual: "" },
        $set: {
          phoneDigits: key,
          updatedAt: now,
          updatedBy: "panel" as const,
          ...(opts?.customerName != null ? { customerName: opts.customerName } : {}),
        },
      },
      { upsert: true },
    );
    return null;
  }

  await col.updateOne(
    { phoneDigits: key },
    {
      $set: {
        phoneDigits: key,
        vipManual: true,
        updatedAt: now,
        updatedBy: "panel" as const,
        ...(opts?.customerName != null ? { customerName: opts.customerName } : {}),
      },
    },
    { upsert: true },
  );
  return true;
}

/**
 * Override de seña online.
 * `true` = no cobrar; `false` = cobrar siempre; `null` = regla automática (VIP sin seña).
 */
export async function setDepositExemptManualForPhone(
  db: Db,
  phoneDigits: string,
  depositExemptManual: boolean | null,
  opts?: { customerName?: string | null },
): Promise<DepositExemptManual> {
  await ensureCustomerProfileIndexes(db);
  const key = normalizePhoneKey(phoneDigits);
  if (!key) throw new Error("Teléfono inválido.");

  const col = db.collection<CustomerProfileDoc>(COLLECTION);
  const now = new Date();
  const nameSet = opts?.customerName != null ? { customerName: opts.customerName } : {};

  if (depositExemptManual === null) {
    await col.updateOne(
      { phoneDigits: key },
      {
        $unset: { depositExemptManual: "" },
        $set: {
          phoneDigits: key,
          updatedAt: now,
          updatedBy: "panel" as const,
          ...nameSet,
        },
      },
      { upsert: true },
    );
    return null;
  }

  await col.updateOne(
    { phoneDigits: key },
    {
      $set: {
        phoneDigits: key,
        depositExemptManual,
        updatedAt: now,
        updatedBy: "panel" as const,
        ...nameSet,
      },
    },
    { upsert: true },
  );
  return depositExemptManual;
}

function queryKeysForPhone(phoneDigits: string): string[] {
  const key = normalizePhoneKey(phoneDigits);
  return key ? customerPhoneDigitsQueryValues(key) : [];
}

function keysOverlap(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((k) => set.has(k));
}

/** Actualiza el nombre en el perfil si ya existe (no crea uno nuevo). */
export async function updateCustomerProfileName(
  db: Db,
  phoneDigits: string,
  customerName: string,
): Promise<void> {
  await ensureCustomerProfileIndexes(db);
  const keys = queryKeysForPhone(phoneDigits);
  if (keys.length === 0) return;

  await db.collection<CustomerProfileDoc>(COLLECTION).updateMany(
    { phoneDigits: { $in: keys } },
    {
      $set: {
        customerName,
        updatedAt: new Date(),
        updatedBy: "panel" as const,
      },
    },
  );
}

/**
 * True si el WhatsApp destino ya tiene un perfil de otra clienta.
 * El mismo número en otro formato no cuenta como conflicto.
 */
export async function customerProfileRekeyWouldConflict(
  db: Db,
  fromPhone: string,
  toPhone: string,
): Promise<boolean> {
  await ensureCustomerProfileIndexes(db);
  const fromKey = normalizePhoneKey(fromPhone);
  const toKey = normalizePhoneKey(toPhone);
  if (!fromKey || !toKey || fromKey === toKey) return false;

  const fromKeys = customerPhoneDigitsQueryValues(fromKey);
  const toKeys = customerPhoneDigitsQueryValues(toKey);
  if (keysOverlap(fromKeys, toKeys)) return false;

  const col = db.collection<CustomerProfileDoc>(COLLECTION);
  const toDoc = await col.findOne({ phoneDigits: { $in: toKeys } });
  if (!toDoc) return false;

  const fromDoc = await col.findOne({ phoneDigits: { $in: fromKeys } });
  if (fromDoc && fromDoc._id.equals(toDoc._id)) return false;
  return true;
}

/**
 * Mueve el doc de `customer_profiles` al teléfono canónico nuevo.
 * Si no hay perfil, no hace nada. Conflicto con otra clienta → `"conflict"`.
 */
export async function rekeyCustomerProfile(
  db: Db,
  fromPhone: string,
  toPhone: string,
  opts?: { customerName?: string | null },
): Promise<"ok" | "conflict"> {
  await ensureCustomerProfileIndexes(db);
  const fromKey = normalizePhoneKey(fromPhone);
  const toKey = normalizePhoneKey(toPhone);
  if (!fromKey || !toKey) throw new Error("Teléfono inválido.");

  const col = db.collection<CustomerProfileDoc>(COLLECTION);
  const now = new Date();
  const nameSet = opts?.customerName != null ? { customerName: opts.customerName } : {};

  if (fromKey === toKey) {
    await col.updateMany(
      { phoneDigits: { $in: customerPhoneDigitsQueryValues(fromKey) } },
      { $set: { updatedAt: now, updatedBy: "panel" as const, ...nameSet } },
    );
    return "ok";
  }

  if (await customerProfileRekeyWouldConflict(db, fromKey, toKey)) {
    return "conflict";
  }

  const fromKeys = customerPhoneDigitsQueryValues(fromKey);
  const toKeys = customerPhoneDigitsQueryValues(toKey);
  const fromDoc = await col.findOne({ phoneDigits: { $in: fromKeys } });
  const toDoc = await col.findOne({ phoneDigits: { $in: toKeys } });

  if (!fromDoc && !toDoc) return "ok";

  const keep = fromDoc ?? toDoc;
  if (!keep) return "ok";

  if (toDoc && fromDoc && !fromDoc._id.equals(toDoc._id)) {
    await col.deleteOne({ _id: toDoc._id });
  }

  try {
    await col.updateOne(
      { _id: keep._id },
      {
        $set: {
          phoneDigits: toKey,
          updatedAt: now,
          updatedBy: "panel" as const,
          ...nameSet,
        },
      },
    );
  } catch (e) {
    const code = typeof e === "object" && e && "code" in e ? (e as { code?: unknown }).code : null;
    if (code === 11000) return "conflict";
    throw e;
  }

  return "ok";
}
