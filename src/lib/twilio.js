import twilio from "twilio";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta variable de entorno: ${name}`);
  }
  return value;
}

let cachedClient = null;

export function getTwilioClient() {
  if (cachedClient) return cachedClient;

  const accountSid = getRequiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = getRequiredEnv("TWILIO_AUTH_TOKEN");

  cachedClient = twilio(accountSid, authToken);
  return cachedClient;
}

function digitsFromWhatsAppAddress(value) {
  return String(value ?? "")
    .replace(/^whatsapp:/i, "")
    .replace(/\D/g, "");
}

/**
 * Devuelve el sender_id exacto registrado en Twilio.
 * Si la Senders API no está disponible, conserva el formato configurado.
 */
export async function resolveTwilioWhatsAppFrom(client) {
  const configured = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!configured) {
    throw new Error("Falta variable de entorno: TWILIO_WHATSAPP_FROM");
  }

  const targetDigits = digitsFromWhatsAppAddress(configured);
  if (!targetDigits) {
    throw new Error("TWILIO_WHATSAPP_FROM inválido.");
  }

  let senders = [];
  try {
    senders = await client.messaging.v2.channelsSenders.list({
      channel: "whatsapp",
      limit: 50,
    });
  } catch {
    return configured.startsWith("whatsapp:") ? configured : `whatsapp:+${targetDigits}`;
  }

  const online = senders.filter((sender) => String(sender.status ?? "").toUpperCase() === "ONLINE");
  const match =
    online.find((sender) => digitsFromWhatsAppAddress(sender.senderId) === targetDigits) ??
    senders.find((sender) => digitsFromWhatsAppAddress(sender.senderId) === targetDigits);

  if (match?.senderId) {
    return String(match.senderId).trim();
  }

  const visible = senders
    .map((sender) => `${sender.senderId ?? "?"} (${sender.status ?? "?"})`)
    .join("; ");
  throw new Error(
    visible
      ? `TWILIO_WHATSAPP_FROM no coincide con los senders de esta cuenta. Configurado: ${configured}. Visibles: ${visible}`
      : "Esta cuenta de Twilio no tiene senders de WhatsApp visibles.",
  );
}

/** Usa Messaging Service cuando está configurado; en caso contrario, el sender de WhatsApp. */
export async function buildTwilioWhatsAppSendParams(client) {
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (messagingServiceSid) {
    return { messagingServiceSid };
  }
  return { from: await resolveTwilioWhatsAppFrom(client) };
}
