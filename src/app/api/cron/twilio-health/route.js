import { NextResponse } from "next/server";

import { getTwilioClient, resolveTwilioWhatsAppFrom } from "@/lib/twilio";

function mask(value) {
  const text = String(value ?? "").trim();
  if (text.length < 10) return text || "(vacío)";
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export async function GET(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authorization !== expected) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const fromConfigured = process.env.TWILIO_WHATSAPP_FROM ?? "";
  const contentSid = process.env.TWILIO_REMINDER_NEW_CONTENT_SID ?? "";

  try {
    const client = getTwilioClient();
    const senders = await client.messaging.v2.channelsSenders.list({
      channel: "whatsapp",
      limit: 50,
    });
    const senderRows = senders.map((sender) => ({
      senderId: sender.senderId ?? null,
      status: sender.status ?? null,
      sid: mask(sender.sid),
    }));
    const resolvedFrom = await resolveTwilioWhatsAppFrom(client);

    return NextResponse.json({
      ok: true,
      accountSid: mask(accountSid),
      fromConfigured: mask(fromConfigured),
      fromResolved: mask(resolvedFrom),
      contentSid: mask(contentSid),
      onlineSenders: senderRows
        .filter((sender) => String(sender.status).toUpperCase() === "ONLINE")
        .map((sender) => mask(sender.senderId)),
      checks: {
        hasAccountSid: Boolean(accountSid.trim()),
        hasAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN?.trim()),
        hasFrom: Boolean(fromConfigured.trim()),
        hasNewClientContentSid: Boolean(contentSid.trim()),
        hasWebhookPublicUrl: Boolean(process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim()),
        hasAppBaseUrl: Boolean(
          process.env.APP_BASE_URL?.trim() ||
            process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim(),
        ),
        sendersVisibleToCredentials: senderRows.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        accountSid: mask(accountSid),
        fromConfigured: mask(fromConfigured),
        contentSid: mask(contentSid),
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    );
  }
}
