import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { ensureReservationIndexes } from "@/lib/reservations/service";
import { sendDueReminders } from "@/lib/whatsapp/send-due-reminders";

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const db = await getDb();
    await ensureReservationIndexes(db);
    const result = await sendDueReminders(db);
    console.log(
      `[daily-reminders] today=${result.todayKey} tomorrow=${result.tomorrowKey} candidates=${result.candidates} sent=${result.sent}`,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno del cron" },
      { status: 500 },
    );
  }
}
