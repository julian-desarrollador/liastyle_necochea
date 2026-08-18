import type { Db } from "mongodb";

import {
  canonicalPhoneDigitsAR,
  customerPhoneDigitsQueryValues,
} from "@/lib/customer/phone-canonical-ar";
import type { ReservationDoc } from "@/lib/reservations/types";
import { getVipManualMapForPhones } from "@/lib/vip/customer-profiles";
import { resolveVipStatus, type VipStatus } from "@/lib/vip/eligibility";

const RESERVATIONS_COLLECTION = "reservations";

type VisitCountRow = {
  _id: string;
  visitCount: number;
};

function pastVisitSumExpression(now: Date) {
  return {
    $sum: {
      $cond: [
        {
          $or: [
            { $eq: ["$reservationStatus", "completed"] },
            {
              $and: [
                {
                  $not: [
                    {
                      $in: [
                        "$reservationStatus",
                        ["pending_payment", "cancelled", "no_show"],
                      ],
                    },
                  ],
                },
                {
                  $lt: [
                    {
                      $add: [
                        "$startsAt",
                        {
                          $multiply: [
                            {
                              $ifNull: [
                                "$durationMinutes",
                                { $ifNull: ["$totalDurationMinutes", 60] },
                              ],
                            },
                            60_000,
                          ],
                        },
                      ],
                    },
                    now,
                  ],
                },
              ],
            },
          ],
        },
        1,
        0,
      ],
    },
  };
}

/**
 * Resuelve VIP en lote para el cron. Devuelve un mapa por teléfono canónico
 * y aplica tanto la regla de 10 visitas como los overrides del panel.
 */
export async function getVipStatusMapForPhones(
  db: Db,
  phoneDigitsList: string[],
  now = new Date(),
): Promise<Map<string, VipStatus>> {
  const canonicalPhones = [
    ...new Set(
      phoneDigitsList
        .map((phone) => canonicalPhoneDigitsAR(phone) || phone.trim())
        .filter((phone) => phone.length >= 8),
    ),
  ];
  const result = new Map<string, VipStatus>();
  if (canonicalPhones.length === 0) return result;

  const queryKeys = new Set<string>();
  for (const phone of canonicalPhones) {
    for (const variant of customerPhoneDigitsQueryValues(phone)) {
      queryKeys.add(variant);
    }
  }

  const [visitRows, vipManualMap] = await Promise.all([
    db
      .collection<ReservationDoc>(RESERVATIONS_COLLECTION)
      .aggregate<VisitCountRow>([
        { $match: { customerPhoneDigits: { $in: [...queryKeys] } } },
        {
          $group: {
            _id: "$customerPhoneDigits",
            visitCount: pastVisitSumExpression(now),
          },
        },
      ])
      .toArray(),
    getVipManualMapForPhones(db, canonicalPhones),
  ]);

  const visitsByCanonical = new Map<string, number>();
  for (const row of visitRows) {
    const canonical = canonicalPhoneDigitsAR(row._id) || row._id;
    visitsByCanonical.set(
      canonical,
      (visitsByCanonical.get(canonical) ?? 0) + Math.max(0, row.visitCount),
    );
  }

  for (const canonical of canonicalPhones) {
    result.set(
      canonical,
      resolveVipStatus({
        pastVisitCount: visitsByCanonical.get(canonical) ?? 0,
        vipManual: vipManualMap.get(canonical) ?? null,
      }),
    );
  }

  return result;
}
