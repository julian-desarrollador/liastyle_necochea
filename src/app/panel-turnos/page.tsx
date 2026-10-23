import { cookies } from "next/headers";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { PanelLogin } from "./panel-login";
import { PanelTurnosDashboard } from "./panel-turnos-dashboard";

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function panelDateKey(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return raw;
}

export default async function PanelTurnosPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string | string[]; ver?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const ok = verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value);

  if (!ok) {
    return <PanelLogin />;
  }

  const params = await searchParams;
  const initialDateKey = panelDateKey(firstQueryValue(params.fecha));
  const initialShowCancelled = firstQueryValue(params.ver) === "cancelados";

  return (
    <PanelTurnosDashboard initialDateKey={initialDateKey} initialShowCancelled={initialShowCancelled} />
  );
}
