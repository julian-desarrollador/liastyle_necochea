"use client";

import { ChevronLeft, FileText, MessageCircle, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { PanelClientVisit } from "@/lib/panel/client-serialize";
import { isPublicOnlineDepositEnabled } from "@/lib/reservations/public-deposit";
import {
  BIRTH_MONTH_OPTIONS,
  ageAsOfToday,
  formatBirthdayDate,
} from "@/lib/vip/client-birthday";
import {
  panelBackBtn,
  panelCard,
  panelContainer,
  panelInput,
  panelLabel,
  panelPage,
  panelPrimaryBtn,
} from "@/components/panel/panel-ui";

type ClientInfo = {
  phoneDigits: string;
  customerName: string;
  customerPhone: string;
  visitCount: number;
  isVip?: boolean;
  vipSource?: "auto" | "manual" | "none";
  vipManual?: boolean | null;
  threshold?: number;
  depositExempt?: boolean;
  depositExemptSource?: "vip" | "manual_exempt" | "manual_charge" | "none";
  depositExemptManual?: boolean | null;
  birthDay?: number | null;
  birthMonth?: number | null;
  birthYear?: number | null;
};

type Props = {
  phoneDigits: string;
};

function visitStatusLabel(status: string): string {
  if (status === "cancelled") return "Cancelada";
  if (status === "pending_payment") return "Pendiente de pago";
  if (status === "completed") return "Realizada";
  if (status === "no_show") return "No asistió";
  return "Confirmada";
}

function birthdaySummary(client: ClientInfo): string {
  if (client.birthDay == null || client.birthMonth == null) return "Sin fecha de nacimiento";
  const date = formatBirthdayDate(client.birthDay, client.birthMonth);
  const age = ageAsOfToday({
    birthDay: client.birthDay,
    birthMonth: client.birthMonth,
    birthYear: client.birthYear ?? null,
  });
  if (age == null) return `Cumpleaños: ${date}`;
  return `Cumpleaños: ${date} · ${age} ${age === 1 ? "año" : "años"}`;
}

function whatsAppChatUrl(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}`;
}

export function PanelClienteFichaClient({ phoneDigits }: Props) {
  const router = useRouter();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [visits, setVisits] = useState<PanelClientVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [vipBusy, setVipBusy] = useState(false);
  const [vipError, setVipError] = useState<string | null>(null);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftBirthDay, setDraftBirthDay] = useState("");
  const [draftBirthMonth, setDraftBirthMonth] = useState("");
  const [draftBirthYear, setDraftBirthYear] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/panel-turnos/clientes/${encodeURIComponent(phoneDigits)}`, {
        credentials: "same-origin",
      });
      const data = (await res.json()) as {
        client?: ClientInfo;
        visits?: PanelClientVisit[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar la ficha.");
        setClient(null);
        setVisits([]);
        return;
      }
      setClient(data.client ?? null);
      setVisits(data.visits ?? []);
    } catch {
      setError("Sin conexión. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [phoneDigits]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setEditingIdentity(false);
    setIdentityError(null);
  }, [phoneDigits]);

  function startIdentityEdit() {
    if (!client) return;
    setDraftName(client.customerName);
    setDraftPhone(client.customerPhone);
    setDraftBirthDay(client.birthDay != null ? String(client.birthDay) : "");
    setDraftBirthMonth(client.birthMonth != null ? String(client.birthMonth) : "");
    setDraftBirthYear(client.birthYear != null ? String(client.birthYear) : "");
    setIdentityError(null);
    setEditingIdentity(true);
  }

  function cancelIdentityEdit() {
    setEditingIdentity(false);
    setIdentityError(null);
  }

  async function clearBirthday() {
    if (!client?.birthDay || !client.birthMonth) return;
    if (!window.confirm("¿Quitar la fecha de nacimiento?")) return;
    setIdentitySaving(true);
    setIdentityError(null);
    try {
      const res = await fetch(`/api/panel-turnos/clientes/${encodeURIComponent(phoneDigits)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          customerName: client.customerName,
          customerPhone: client.customerPhone,
          birthDay: null,
          birthMonth: null,
          birthYear: null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setIdentityError(data.error ?? "No se pudo quitar la fecha.");
        return;
      }
      setClient((prev) =>
        prev ? { ...prev, birthDay: null, birthMonth: null, birthYear: null } : prev,
      );
      setEditingIdentity(false);
    } catch {
      setIdentityError("Sin conexión. Probá de nuevo.");
    } finally {
      setIdentitySaving(false);
    }
  }

  async function saveIdentity() {
    setIdentitySaving(true);
    setIdentityError(null);
    try {
      const res = await fetch(`/api/panel-turnos/clientes/${encodeURIComponent(phoneDigits)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          customerName: draftName,
          customerPhone: draftPhone,
          birthDay: draftBirthDay === "" ? null : Number(draftBirthDay),
          birthMonth: draftBirthMonth === "" ? null : Number(draftBirthMonth),
          birthYear: draftBirthYear.trim() === "" ? null : Number(draftBirthYear.trim()),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        phoneDigits?: string;
        customerName?: string;
        customerPhone?: string;
        birthDay?: number | null;
        birthMonth?: number | null;
        birthYear?: number | null;
      };
      if (!res.ok) {
        setIdentityError(data.error ?? "No se pudieron guardar los datos.");
        return;
      }
      const nextPhone = data.phoneDigits?.trim() || phoneDigits;
      if (nextPhone !== phoneDigits) {
        router.replace(`/panel-turnos/clientes/${encodeURIComponent(nextPhone)}`);
        return;
      }
      setClient((prev) =>
        prev
          ? {
              ...prev,
              customerName: data.customerName?.trim() || prev.customerName,
              customerPhone: data.customerPhone?.trim() || prev.customerPhone,
              phoneDigits: nextPhone,
              birthDay: data.birthDay ?? null,
              birthMonth: data.birthMonth ?? null,
              birthYear: data.birthYear ?? null,
            }
          : prev,
      );
      setEditingIdentity(false);
    } catch {
      setIdentityError("Sin conexión. Probá de nuevo.");
    } finally {
      setIdentitySaving(false);
    }
  }

  function startEdit(visit: PanelClientVisit) {
    setEditingId(visit.id);
    setDraftNote(visit.technicalNote ?? "");
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftNote("");
    setSaveError(null);
  }

  async function saveNote(visitId: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/panel-turnos/reservations/${encodeURIComponent(visitId)}/nota`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ note: draftNote }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveError(data.error ?? "No se pudo guardar.");
        return;
      }
      setVisits((prev) =>
        prev.map((v) =>
          v.id === visitId ? { ...v, technicalNote: draftNote.trim() ? draftNote.trim() : null } : v,
        ),
      );
      setEditingId(null);
      setDraftNote("");
    } catch {
      setSaveError("Sin conexión. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function updateVip(vipManual: true | null) {
    setVipBusy(true);
    setVipError(null);
    try {
      const res = await fetch(`/api/panel-turnos/clientes/${encodeURIComponent(phoneDigits)}/vip`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ vipManual }),
      });
      const data = (await res.json()) as {
        error?: string;
        pastVisitCount?: number;
        isVip?: boolean;
        vipSource?: "auto" | "manual" | "none";
        vipManual?: boolean | null;
        threshold?: number;
      };
      if (!res.ok) {
        setVipError(data.error ?? "No se pudo actualizar el VIP.");
        return;
      }
      setClient((prev) =>
        prev
          ? {
              ...prev,
              visitCount: data.pastVisitCount ?? prev.visitCount,
              isVip: data.isVip,
              vipSource: data.vipSource,
              vipManual: data.vipManual ?? null,
              threshold: data.threshold ?? prev.threshold,
              // Recalcular seña en cliente: al marcar VIP, si no hay override, queda exenta.
              depositExempt:
                prev.depositExemptManual === true
                  ? true
                  : prev.depositExemptManual === false
                    ? false
                    : Boolean(data.isVip),
              depositExemptSource:
                prev.depositExemptManual === true
                  ? "manual_exempt"
                  : prev.depositExemptManual === false
                    ? "manual_charge"
                    : data.isVip
                      ? "vip"
                      : "none",
            }
          : prev,
      );
    } catch {
      setVipError("Sin conexión. Probá de nuevo.");
    } finally {
      setVipBusy(false);
    }
  }

  async function updateDepositExempt(depositExemptManual: boolean | null) {
    setDepositBusy(true);
    setDepositError(null);
    try {
      const res = await fetch(
        `/api/panel-turnos/clientes/${encodeURIComponent(phoneDigits)}/deposit-exempt`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ depositExemptManual }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        depositExempt?: boolean;
        depositExemptSource?: ClientInfo["depositExemptSource"];
        depositExemptManual?: boolean | null;
        isVip?: boolean;
      };
      if (!res.ok) {
        setDepositError(data.error ?? "No se pudo actualizar la seña.");
        return;
      }
      setClient((prev) =>
        prev
          ? {
              ...prev,
              isVip: data.isVip ?? prev.isVip,
              depositExempt: data.depositExempt,
              depositExemptSource: data.depositExemptSource,
              depositExemptManual: data.depositExemptManual ?? null,
            }
          : prev,
      );
    } catch {
      setDepositError("Sin conexión. Probá de nuevo.");
    } finally {
      setDepositBusy(false);
    }
  }

  const waUrl = client ? whatsAppChatUrl(client.customerPhone) : null;
  const threshold = client?.threshold ?? 10;
  const vipLabel =
    client?.vipSource === "manual"
      ? "VIP manual"
      : client?.vipSource === "auto"
        ? "VIP automático"
        : "Aún no es VIP";
  const depositLabel = client?.depositExempt
    ? client.depositExemptSource === "manual_exempt"
      ? "No cobra seña (elegido a mano)"
      : client.depositExemptSource === "vip"
        ? "No cobra seña (VIP)"
        : "No cobra seña"
    : client?.depositExemptSource === "manual_charge"
      ? "Cobra seña (elegido a mano)"
      : "Cobra seña online";

  return (
    <div className={`${panelPage} bg-[#F0F1F3]`}>
      <div className={`${panelContainer} pt-6`}>
        <header className="mb-5 flex items-start gap-3">
          <Link href="/panel-turnos/clientes" className={panelBackBtn} aria-label="Volver a clientes">
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-gray-500">Ficha del cliente</p>
            {loading ? (
              <h1 className="font-montserrat text-[22px] font-bold text-gray-900">Cargando…</h1>
            ) : client ? (
              <>
                <h1 className="font-montserrat text-[22px] font-bold leading-tight text-gray-900">{client.customerName}</h1>
                <p className="mt-1 text-[14px] text-gray-500">{client.customerPhone}</p>
                <p className="mt-1 text-[13px] text-gray-400">
                  {client.visitCount} {client.visitCount === 1 ? "visita realizada" : "visitas realizadas"}
                </p>
                <p className="mt-1 text-[13px] text-gray-500">{birthdaySummary(client)}</p>
                {!editingIdentity ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startIdentityEdit}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      Editar datos
                    </button>
                    {client.birthDay != null && client.birthMonth != null ? (
                      <button
                        type="button"
                        disabled={identitySaving}
                        onClick={() => void clearBirthday()}
                        className="inline-flex cursor-pointer items-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        {identitySaving ? "Quitando…" : "Quitar fecha"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {identityError && !editingIdentity ? (
                  <p role="alert" className="mt-2 text-[14px] text-red-700">
                    {identityError}
                  </p>
                ) : null}
              </>
            ) : (
              <h1 className="font-montserrat text-[22px] font-bold text-gray-900">Clienta</h1>
            )}
          </div>
        </header>

        {client && editingIdentity ? (
          <article className={`${panelCard} mb-4 p-4`}>
            <p className="mb-3 text-[12px] font-semibold tracking-wide text-gray-500 uppercase">Editar datos</p>
            <label htmlFor="client-name" className={panelLabel}>
              Nombre
            </label>
            <input
              id="client-name"
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoComplete="name"
              className={panelInput}
            />
            <label htmlFor="client-phone" className={`${panelLabel} mt-3 block`}>
              WhatsApp
            </label>
            <input
              id="client-phone"
              type="tel"
              value={draftPhone}
              onChange={(e) => setDraftPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              className={panelInput}
            />
            <p className={`${panelLabel} mt-3`}>Fecha de nacimiento</p>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="client-birth-day" className="sr-only">
                  Día
                </label>
                <select
                  id="client-birth-day"
                  value={draftBirthDay}
                  onChange={(e) => setDraftBirthDay(e.target.value)}
                  className={`${panelInput} mt-0`}
                >
                  <option value="">Día</option>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="client-birth-month" className="sr-only">
                  Mes
                </label>
                <select
                  id="client-birth-month"
                  value={draftBirthMonth}
                  onChange={(e) => setDraftBirthMonth(e.target.value)}
                  className={`${panelInput} mt-0`}
                >
                  <option value="">Mes</option>
                  {BIRTH_MONTH_OPTIONS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="client-birth-year" className="sr-only">
                  Año
                </label>
                <input
                  id="client-birth-year"
                  type="text"
                  inputMode="numeric"
                  value={draftBirthYear}
                  onChange={(e) => setDraftBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="Año"
                  autoComplete="bday-year"
                  className={`${panelInput} mt-0`}
                />
              </div>
            </div>
            <p className="mt-1 text-[12px] text-gray-400">El año es opcional.</p>
            {identityError ? (
              <p role="alert" className="mt-2 text-[14px] text-red-700">
                {identityError}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={identitySaving}
                onClick={() => void saveIdentity()}
                className={`${panelPrimaryBtn} h-11 text-[15px]`}
              >
                {identitySaving ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                disabled={identitySaving}
                onClick={cancelIdentityEdit}
                className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-[15px] font-medium text-gray-700"
              >
                Cancelar
              </button>
            </div>
          </article>
        ) : null}

        {client && waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-4 inline-flex items-center gap-2 text-[14px] font-medium text-[#1A7A3A] underline-offset-2 hover:underline"
          >
            <MessageCircle className="h-4 w-4" strokeWidth={2} />
            Enviar WhatsApp
          </a>
        ) : null}

        {loading ? (
          <p className="py-8 text-center text-[15px] text-gray-500">Cargando historial…</p>
        ) : error ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-800">
            {error}
          </p>
        ) : client ? (
          <section className="space-y-4 pb-10">
            <article className={`${panelCard} p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold tracking-wide text-gray-500 uppercase">Cliente VIP</p>
                  <p className="mt-1 font-montserrat text-[17px] font-semibold text-gray-900">{vipLabel}</p>
                  <p className="mt-1 text-[14px] text-gray-600">
                    {client.visitCount} / {threshold} visitas realizadas
                  </p>
                </div>
                <Link
                  href="/panel-turnos/vip"
                  className="text-[13px] font-medium text-[#7da3c4] underline-offset-2 hover:underline"
                >
                  Ver página VIP
                </Link>
              </div>
              {vipError ? (
                <p role="alert" className="mt-3 text-[14px] text-red-700">
                  {vipError}
                </p>
              ) : null}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {client.vipManual === true ? (
                  <button
                    type="button"
                    disabled={vipBusy}
                    onClick={() => void updateVip(null)}
                    className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-[14px] font-medium text-gray-700 disabled:opacity-60"
                  >
                    {vipBusy ? "Guardando…" : "Usar regla automática"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={vipBusy || client.isVip}
                    onClick={() => void updateVip(true)}
                    className={`${panelPrimaryBtn} h-11 flex-1 text-[14px] disabled:opacity-60`}
                  >
                    {vipBusy ? "Guardando…" : client.isVip ? "Ya es VIP automática" : "Marcar VIP"}
                  </button>
                )}
              </div>
              {client.vipManual !== true && client.isVip ? (
                <p className="mt-2 text-[12px] text-gray-500">
                  Alcanzó el umbral de {threshold} visitas. No hace falta marcarla a mano.
                </p>
              ) : null}
            </article>

            <article className={`${panelCard} p-4`}>
              <div>
                <p className="text-[12px] font-semibold tracking-wide text-gray-500 uppercase">
                  Seña online
                </p>
                <p className="mt-1 font-montserrat text-[17px] font-semibold text-gray-900">
                  {depositLabel}
                </p>
                <p className="mt-1 text-[14px] text-gray-600">
                  Por defecto las VIP no pagan seña. Acá elegís excepciones.
                </p>
                {!isPublicOnlineDepositEnabled() ? (
                  <p className="mt-2 text-[13px] leading-snug text-amber-800">
                    Seña online pausada: las reservas de la web se confirman sin cobro.
                  </p>
                ) : null}
              </div>
              {depositError ? (
                <p role="alert" className="mt-3 text-[14px] text-red-700">
                  {depositError}
                </p>
              ) : null}
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={depositBusy || client.depositExemptManual == null}
                  onClick={() => void updateDepositExempt(null)}
                  className="flex h-11 w-full cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-[14px] font-medium text-gray-700 disabled:opacity-60"
                >
                  {depositBusy ? "Guardando…" : "Usar regla automática (VIP sin seña)"}
                </button>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={depositBusy || client.depositExemptManual === true}
                    onClick={() => void updateDepositExempt(true)}
                    className={`${panelPrimaryBtn} h-11 flex-1 text-[14px] disabled:opacity-60`}
                  >
                    {depositBusy ? "Guardando…" : "No cobrar seña"}
                  </button>
                  <button
                    type="button"
                    disabled={depositBusy || client.depositExemptManual === false}
                    onClick={() => void updateDepositExempt(false)}
                    className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-[14px] font-medium text-gray-700 disabled:opacity-60"
                  >
                    {depositBusy ? "Guardando…" : "Cobrar seña"}
                  </button>
                </div>
              </div>
            </article>

            <p className="text-[13px] font-semibold tracking-wide text-gray-500 uppercase">Historial de visitas</p>

            {visits.map((visit) => {
              const isEditing = editingId === visit.id;
              return (
                <article key={visit.id} className={`${panelCard} overflow-hidden p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-montserrat text-[16px] font-semibold text-gray-900">{visit.treatmentName}</p>
                      <p className="mt-1 text-[14px] text-gray-600">
                        {visit.displayDate} · {visit.timeLocal} hs
                      </p>
                      <p className="mt-1 text-[12px] text-gray-400">{visitStatusLabel(visit.reservationStatus)}</p>
                    </div>
                    {!isEditing ? (
                      <button
                        type="button"
                        onClick={() => startEdit(visit)}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                        {visit.technicalNote ? "Editar nota" : "Agregar nota"}
                      </button>
                    ) : null}
                  </div>

                  {!isEditing && visit.technicalNote ? (
                    <div className="mt-3 rounded-xl border border-[#7da3c4]/20 bg-[#7da3c4]/5 px-3 py-3">
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#7da3c4] uppercase">
                        <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                        Ficha técnica
                      </p>
                      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{visit.technicalNote}</p>
                    </div>
                  ) : null}

                  {!isEditing && !visit.technicalNote ? (
                    <p className="mt-3 text-[13px] text-gray-400">Sin ficha técnica para esta visita.</p>
                  ) : null}

                  {isEditing ? (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <label htmlFor={`note-${visit.id}`} className={panelLabel}>
                        Ficha técnica
                      </label>
                      <textarea
                        id={`note-${visit.id}`}
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        rows={5}
                        placeholder="Ej: Color 20% rojo suave, 33% azul, 20 g de producto, oxidante 20 vol, 35 min…"
                        className={`${panelInput} resize-y min-h-[120px]`}
                      />
                      {saveError ? (
                        <p role="alert" className="mt-2 text-[14px] text-red-700">
                          {saveError}
                        </p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void saveNote(visit.id)}
                          className={`${panelPrimaryBtn} h-11 text-[15px]`}
                        >
                          {saving ? "Guardando…" : "Guardar"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={cancelEdit}
                          className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-[15px] font-medium text-gray-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : null}
      </div>
    </div>
  );
}
