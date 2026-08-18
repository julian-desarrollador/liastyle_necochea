export type WaReminderInboundAction = "confirm" | "cancel";

/** Solo acepta los IDs exactos de los botones aprobados; el texto libre no muta turnos. */
export function parseWaReminderInboundAction(
  fields: Record<string, string>,
): WaReminderInboundAction | null {
  const value = String(fields.ButtonPayload ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();

  if (value === "cancelar") return "cancel";
  if (value === "confirmar") return "confirm";
  return null;
}
