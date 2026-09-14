import { mpFetchJson } from "./client";

/**
 * Devolución total de un pago de Mercado Pago.
 * Idempotente: si ya estaba reembolsado, lo trata como éxito.
 */
export async function refundMercadoPagoPayment(
  paymentId: string,
  idempotencyKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = paymentId.trim();
  if (!id) return { ok: false, error: "missing_payment_id" };

  const r = await mpFetchJson<Record<string, unknown>>(`/v1/payments/${encodeURIComponent(id)}/refunds`, {
    method: "POST",
    headers: {
      "X-Idempotency-Key": idempotencyKey.slice(0, 64),
    },
    body: "{}",
  });

  if (r.ok) return { ok: true };

  const body = r.body.toLowerCase();
  if (
    r.status === 400 &&
    (body.includes("already") || body.includes("refunded") || body.includes("reembols"))
  ) {
    return { ok: true };
  }

  return { ok: false, error: `MP refund ${r.status}: ${r.body}` };
}
