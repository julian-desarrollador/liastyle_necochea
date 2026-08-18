import twilio from "twilio";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { buildTwilioWhatsAppSendParams, getTwilioClient } from "@/lib/twilio";
import { parseWaReminderInboundAction } from "@/lib/whatsapp/parse-inbound-action";
import { processWaReminderInboundReply } from "@/lib/whatsapp/process-reminder-reply";
import {
  claimWhatsappInboundLog,
  completeWhatsappInboundLog,
} from "@/lib/whatsapp/whatsapp-logs";

export const runtime = "nodejs";

function getWebhookPublicUrl(request: Request): string {
  const configured = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const protocol = request.headers.get("x-forwarded-proto") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return `${protocol}://${host}/api/webhooks/twilio/whatsapp`;
}

function candidateWebhookUrls(request: Request): string[] {
  const urls = new Set<string>([getWebhookPublicUrl(request)]);
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (host) {
    urls.add(`https://${host}/api/webhooks/twilio/whatsapp`);
    urls.add(`http://${host}/api/webhooks/twilio/whatsapp`);
  }
  return [...urls];
}

async function parseTwilioForm(request: Request): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await request.text())) as Record<
    string,
    string
  >;
}

function verifyTwilioSignature(
  request: Request,
  params: Record<string, string>,
  urls: string[],
): boolean {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TWILIO_WEBHOOK_SKIP_VERIFY === "true"
  ) {
    return true;
  }
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!authToken || !signature) return false;
  return urls.some((url) => twilio.validateRequest(authToken, signature, url, params));
}

function emptyTwiml() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    },
  );
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Webhook inbound de Twilio por POST." });
}

export async function POST(request: Request) {
  const urls = candidateWebhookUrls(request);
  const params = await parseTwilioForm(request);
  if (!verifyTwilioSignature(request, params, urls)) {
    console.error("[webhooks/twilio/whatsapp] firma inválida", { urls });
    return NextResponse.json({ error: "Firma inválida." }, { status: 403 });
  }

  const action = parseWaReminderInboundAction(params);
  const from = params.From?.trim() ?? "";
  const inboundSid = params.MessageSid?.trim() || null;
  let db: Db | null = null;
  let claimToken: string | null = null;

  try {
    db = await getDb();
    if (!action || !from) {
      if (from) {
        await claimWhatsappInboundLog(db, {
          from,
          sid: inboundSid,
          action: null,
          error: action ? "missing_from" : "unrecognized_action",
        });
      }
      return emptyTwiml();
    }

    claimToken = await claimWhatsappInboundLog(db, {
      from,
      sid: inboundSid,
      action,
    });
    if (!claimToken) return emptyTwiml();

    const result = await processWaReminderInboundReply(db, {
      action,
      fromWhatsApp: from,
      originalMessageSid:
        params.OriginalRepliedMessageSid ?? params.ReferredMessageSid ?? null,
    });

    await completeWhatsappInboundLog(db, {
      sid: inboundSid,
      from,
      claimToken,
      reservationId: result.reservationId ?? null,
      action,
      status: result.ok || result.replyText ? "processed" : "ignored",
      error: result.ok ? null : result.reason,
    });

    if (result.replyText) {
      try {
        const client = getTwilioClient();
        const sendParams = await buildTwilioWhatsAppSendParams(client);
        await client.messages.create({
          ...sendParams,
          to: from,
          body: result.replyText,
        });
      } catch (replyError) {
        console.error("[webhooks/twilio/whatsapp] respuesta automática", replyError);
      }
    }
  } catch (error) {
    console.error("[webhooks/twilio/whatsapp]", error);
    if (db && claimToken && from) {
      try {
        await completeWhatsappInboundLog(db, {
          sid: inboundSid,
          from,
          claimToken,
          action,
          status: "failed",
          error: error instanceof Error ? error.message : "internal_error",
        });
      } catch (logError) {
        console.error("[webhooks/twilio/whatsapp] no se pudo liberar el claim", logError);
      }
    }
    return NextResponse.json({ error: "Error procesando webhook." }, { status: 500 });
  }

  return emptyTwiml();
}
