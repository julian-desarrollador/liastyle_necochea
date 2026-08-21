"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agendaBlockAppliesToDateKey } from "@/lib/booking/agenda-blocks-shared";
import type { ReprogramDayRow } from "@/lib/booking/panel-reprogram-day-rows";
import { PANEL_WEEK_LETTERS, buildPanelMonthGrid, panelMonthTitle } from "@/lib/booking/panel-month-grid";
import { argentinaTodayDateKey, minPublicBookableDateKey } from "@/lib/booking/public-slot-lead";
import { panelBackBtn, panelCard, panelDayDefault, panelDayOutside, panelDaySelected, panelPage, panelPrimaryBtn } from "@/components/panel/panel-ui";
import { PanelSobreturnoConfirm } from "@/components/panel/panel-sobreturno-confirm";
import { perfilBackBtn } from "@/components/perfil/perfil-ui";

export type ReprogramarVariant = "customer" | "panel";

type LoadedReservation = {
  id: string;
  treatmentId: string;
  treatmentName: string;
  subtitle: string;
  dateKey: string;
  timeLocal: string;
  displayDate: string;
  reservationStatus: string;
  source?: string;
};

function canRescheduleStatus(s: string) {
  return s === "confirmed" || s === "pending_payment";
}

function yearMonthFromDateKey(dateKey: string): { year: number; month: number } {
  const [y, m] = dateKey.split("-").map(Number);
  const year = Number.isFinite(y) ? y : new Date().getFullYear();
  const month = Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1;
  return { year, month };
}

function weekdayLongFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const w = new Intl.DateTimeFormat("es-AR", { weekday: "long" }).format(dt);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function dayLongFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" }).format(dt);
}

type PanelAgendaBlockLite = {
  anchorDateKey: string;
  timeLocal: string;
  durationMinutes: number;
  scope: string;
  recurrence: { type: "weekly"; untilDateKey?: string | null } | null;
  notes?: string | null;
};

function scopeLabelPanel(scope: string) {
  if (scope === "salon") return "Todo el salón";
  if (scope === "chair_1") return "Silla 1";
  if (scope === "chair_2") return "Silla 2";
  return scope;
}

export function ReprogramarTurnoClient({
  reservationId,
  variant,
}: {
  reservationId: string;
  variant: ReprogramarVariant;
}) {
  const router = useRouter();
  const [reservation, setReservation] = useState<LoadedReservation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState("");
  const [slotRows, setSlotRows] = useState<ReprogramDayRow[] | null>(null);
  const [monthCounts, setMonthCounts] = useState<Map<string, number> | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [timeLocal, setTimeLocal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sobreturnoOpen, setSobreturnoOpen] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth() + 1);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const dayPickerRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const backHref = variant === "panel" ? "/panel-turnos" : "/perfil/mis-turnos";
  const minDateKey = useMemo(() => {
    if (!reservation) return argentinaTodayDateKey();
    if (variant === "panel") return argentinaTodayDateKey();
    return reservation.source === "panel" ? argentinaTodayDateKey() : minPublicBookableDateKey();
  }, [reservation, variant]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadError(null);
      const url =
        variant === "panel"
          ? `/api/panel-turnos/reservations/${encodeURIComponent(reservationId)}`
          : `/api/me/reservations/${encodeURIComponent(reservationId)}`;
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        const data = (await res.json()) as LoadedReservation & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          if (res.status === 401) {
            setLoadError(variant === "panel" ? "Sesión del panel vencida." : "Iniciá sesión desde Perfil con tu WhatsApp.");
            setReservation(null);
            return;
          }
          setLoadError(data.error ?? "No se pudo cargar el turno.");
          setReservation(null);
          return;
        }
        setReservation({
          id: data.id,
          treatmentId: data.treatmentId,
          treatmentName: data.treatmentName,
          subtitle: data.subtitle,
          dateKey: data.dateKey,
          timeLocal: data.timeLocal,
          displayDate: data.displayDate,
          reservationStatus: data.reservationStatus,
          source: data.source,
        });
        setDateKey(data.dateKey);
        const ym = yearMonthFromDateKey(data.dateKey);
        setCalendarYear(ym.year);
        setCalendarMonth(ym.month);
      } catch {
        if (alive) {
          setLoadError("Sin conexión.");
          setReservation(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [reservationId, variant]);

  const fetchSlots = useCallback(async () => {
    if (!reservation || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      setSlotRows(null);
      return;
    }
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const url =
        variant === "panel"
          ? `/api/panel-turnos/reprogramar/day-slots?dateKey=${encodeURIComponent(dateKey)}&treatmentId=${encodeURIComponent(reservation.treatmentId)}&excludeReservationHexId=${encodeURIComponent(reservationId)}`
          : `/api/me/reservations/${encodeURIComponent(reservationId)}/day-slots?dateKey=${encodeURIComponent(dateKey)}`;
      const res = await fetch(url, { credentials: "same-origin" });
      const data = (await res.json()) as { rows?: ReprogramDayRow[]; error?: string };
      if (!res.ok) {
        setSlotRows([]);
        setSlotsError(data.error ?? "No se pudieron cargar los horarios.");
        return;
      }
      setSlotRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setSlotRows([]);
      setSlotsError("Sin conexión.");
    } finally {
      setSlotsLoading(false);
    }
  }, [dateKey, reservation, reservationId, variant]);

  useEffect(() => {
    void fetchSlots();
  }, [fetchSlots]);

  useEffect(() => {
    setTimeLocal("");
    setSaveError(null);
    setSobreturnoOpen(false);
  }, [dateKey]);

  useEffect(() => {
    if (!timeLocal) return;
    const id = window.setTimeout(() => {
      confirmButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const fullPageBottom = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
      window.scrollTo({ top: fullPageBottom, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [timeLocal]);

  useEffect(() => {
    if (!reservation) return;
    let alive = true;
    (async () => {
      try {
        if (variant === "panel") {
          const res = await fetch(
            `/api/panel-turnos/reservations?year=${calendarYear}&month=${calendarMonth}`,
            { credentials: "same-origin" },
          );
          if (!alive || !res.ok) return;
          const data = (await res.json()) as {
            reservations?: { dateKey: string }[];
            agendaBlocks?: PanelAgendaBlockLite[];
          };
          const grid = buildPanelMonthGrid(calendarYear, calendarMonth);
          const m = new Map<string, number>();
          for (const r of data.reservations ?? []) {
            m.set(r.dateKey, (m.get(r.dateKey) ?? 0) + 1);
          }
          for (const cell of grid) {
            const key = cell.dateKey;
            for (const b of data.agendaBlocks ?? []) {
              if (agendaBlockAppliesToDateKey(b, key)) {
                m.set(key, (m.get(key) ?? 0) + 1);
              }
            }
          }
          if (alive) setMonthCounts(m);
          return;
        }

        const res = await fetch(
          `/api/me/reservations/month-counts?year=${calendarYear}&month=${calendarMonth}`,
          { credentials: "same-origin" },
        );
        if (!alive || !res.ok) return;
        const data = (await res.json()) as { counts?: Record<string, number> };
        const raw = data.counts ?? {};
        if (alive) setMonthCounts(new Map(Object.entries(raw).map(([k, v]) => [k, Number(v) || 0])));
      } catch {
        if (alive) setMonthCounts(new Map());
      }
    })();
    return () => {
      alive = false;
    };
  }, [variant, reservation, calendarYear, calendarMonth]);

  useEffect(() => {
    if (!dayPickerOpen) return;
    function handlePointerDown(e: PointerEvent) {
      const el = dayPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setDayPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [dayPickerOpen]);

  const selectedSlotRow = slotRows?.find((row) => row.timeLocal === timeLocal) ?? null;
  const selectedIsSobreturno =
    variant === "panel" &&
    (selectedSlotRow?.kind === "reserved" || selectedSlotRow?.kind === "capacity_full");
  const sobreturnoDetail =
    selectedSlotRow?.kind === "reserved"
      ? `Este horario ya tiene a ${selectedSlotRow.customerName} (${selectedSlotRow.treatmentName}). Podés mover el turno igual.`
      : "Este horario ya no tiene cupo. Podés mover el turno igual (sobreturno).";

  async function submitSave() {
    if (!reservation || !timeLocal) return;
    setSaving(true);
    setSaveError(null);
    const url =
      variant === "panel"
        ? `/api/panel-turnos/reservations/${encodeURIComponent(reservationId)}`
        : `/api/me/reservations/${encodeURIComponent(reservationId)}`;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateKey, timeLocal }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveError(data.error ?? "No se pudo guardar.");
        return;
      }
      const dest = variant === "customer" ? `${backHref}?rescheduled=1` : backHref;
      router.push(dest);
      router.refresh();
    } catch {
      setSaveError("Sin conexión.");
    } finally {
      setSaving(false);
      setSobreturnoOpen(false);
    }
  }

  function handleSave() {
    if (!reservation || !timeLocal) return;
    if (selectedIsSobreturno) {
      setSobreturnoOpen(true);
      return;
    }
    void submitSave();
  }

  const movable = reservation ? canRescheduleStatus(reservation.reservationStatus) : false;

  const panelMonthGrid = useMemo(
    () => buildPanelMonthGrid(calendarYear, calendarMonth),
    [calendarYear, calendarMonth],
  );

  function calPrevMonth() {
    if (calendarMonth === 1) {
      setCalendarMonth(12);
      setCalendarYear((y) => y - 1);
      return;
    }
    setCalendarMonth((m) => m - 1);
  }

  function calNextMonth() {
    if (calendarMonth === 12) {
      setCalendarMonth(1);
      setCalendarYear((y) => y + 1);
      return;
    }
    setCalendarMonth((m) => m + 1);
  }

  const light = true;
  const backBtnClass = variant === "panel" ? panelBackBtn : perfilBackBtn;

  return (
    <div className={variant === "panel" ? `${panelPage} bg-[#F0F1F3]` : "min-h-screen bg-white text-gray-900"}>
    <main className="mx-auto w-full max-w-md px-5 pt-8 pb-28">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href={backHref}
          className={backBtnClass}
          aria-label="Volver"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </Link>
        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight text-gray-900">
            Cambiar horario
          </h1>
          <p className="mt-0.5 text-[16px] text-gray-500">
            Elegí otro día u hora para el mismo servicio
          </p>
        </div>
      </header>

      {loadError ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[16px] text-amber-900"
        >
          {loadError}{" "}
          {variant === "customer" ? (
            <Link href="/perfil#acceso" className="font-semibold text-[#7da3c4] underline-offset-2 hover:underline">
              Ir a acceso
            </Link>
          ) : null}
        </p>
      ) : null}

      {!loadError && reservation === null ? (
        <p className="py-10 text-center text-[16px] text-gray-500">Cargando…</p>
      ) : null}

      {reservation && !movable ? (
        <p
          className={
            light
              ? "rounded-xl border border-gray-200 bg-white px-4 py-4 text-[14px] text-gray-600"
              : "rounded-xl border border-white/10 bg-[#171717] px-4 py-4 text-[14px] text-[var(--soft-gray)]/80"
          }
        >
          Este turno no se puede reprogramar (está cancelado o ya no admite cambios).
        </p>
      ) : null}

      {reservation && movable ? (
        <div className="space-y-5">
          <section className={light ? `${panelCard} px-4 py-4` : "rounded-2xl border border-white/8 bg-[#171717] px-4 py-4 shadow-[0_10px_28px_rgba(0,0,0,0.35)]"}>
            <p className={`text-[16px] font-semibold ${light ? "text-gray-900" : "text-[var(--soft-gray)]"}`}>
              {reservation.treatmentName}
            </p>
            <p className={`mt-0.5 text-[12px] ${light ? "text-gray-500" : "text-[var(--soft-gray)]/58"}`}>
              {reservation.subtitle}
            </p>
            <p className={`mt-3 text-[13px] ${light ? "text-gray-600" : "text-[var(--soft-gray)]/55"}`}>
              Turno actual:{" "}
              <span className={`font-semibold ${light ? "text-[#7da3c4]" : "text-[var(--premium-gold)]"}`}>
                {reservation.timeLocal} · {reservation.displayDate}
              </span>
            </p>
          </section>

          <div>
            <p className={`mb-2 text-[12px] font-semibold tracking-wide ${light ? "text-gray-600" : "text-[var(--soft-gray)]/70"}`}>
              Día
            </p>
            <div ref={dayPickerRef} className="relative">
              <button
                type="button"
                id="reprog-day-field"
                aria-expanded={dayPickerOpen}
                aria-haspopup="dialog"
                aria-controls="reprog-calendar-popover"
                onClick={() => setDayPickerOpen((o) => !o)}
                className={
                  light
                    ? "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left outline-none transition hover:border-gray-300 focus-visible:border-[#7da3c4]/50"
                    : "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/12 bg-[#141414] px-3 py-3 text-left outline-none transition hover:border-white/18 focus-visible:border-[var(--premium-gold)]/45"
                }
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <CalendarDays className={`h-4 w-4 shrink-0 ${light ? "text-[#7da3c4]" : "text-[var(--premium-gold)]"}`} strokeWidth={1.75} />
                  <span className={`min-w-0 flex-1 text-[14px] leading-snug ${light ? "text-gray-800" : "text-[var(--soft-gray)]"}`}>
                    {/^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? (
                      <>
                        <span className="font-semibold">{weekdayLongFromKey(dateKey)}</span>
                        <span className="text-gray-400"> · </span>
                        <span className="capitalize text-gray-600">{dayLongFromKey(dateKey)}</span>
                      </>
                    ) : (
                      <span className="text-gray-400">Elegí un día</span>
                    )}
                  </span>
                </span>
                <ChevronDown
                  className={["h-5 w-5 shrink-0 text-gray-400 transition", dayPickerOpen ? "rotate-180" : ""].join(" ")}
                  strokeWidth={2}
                  aria-hidden
                />
              </button>

              {dayPickerOpen ? (
                <div
                  id="reprog-calendar-popover"
                  role="dialog"
                  aria-label="Elegir día"
                  className={
                    light
                      ? `absolute left-0 right-0 z-30 mt-2 ${panelCard} p-4`
                      : "absolute left-0 right-0 z-30 mt-2 rounded-[28px] border border-white/10 bg-[#171717] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.55)]"
                  }
                >
                  <div className="relative mb-3 flex items-center justify-center px-10">
                    <button
                      type="button"
                      onClick={calPrevMonth}
                      className={
                        light
                          ? "absolute left-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                          : "absolute left-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-[var(--soft-gray)]/70 hover:bg-white/5 hover:text-[var(--soft-gray)]"
                      }
                      aria-label="Mes anterior"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <span
                      className={`text-center text-[15px] font-semibold capitalize tracking-tight ${light ? "text-gray-900" : "text-[var(--soft-gray)]"}`}
                    >
                      {panelMonthTitle(calendarYear, calendarMonth)}
                    </span>
                    <button
                      type="button"
                      onClick={calNextMonth}
                      className={
                        light
                          ? "absolute right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                          : "absolute right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-[var(--soft-gray)]/70 hover:bg-white/5 hover:text-[var(--soft-gray)]"
                      }
                      aria-label="Mes siguiente"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>

                  <div
                    className={`grid grid-cols-7 gap-y-1 text-center text-[11px] font-semibold tracking-wide ${light ? "text-gray-400" : "text-[var(--soft-gray)]/45"}`}
                  >
                    {PANEL_WEEK_LETTERS.map((L) => (
                      <div key={L} className="py-2">
                        {L}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-y-2 text-center">
                    {panelMonthGrid.map((cell) => {
                      const sel = cell.dateKey === dateKey;
                      const inMonth = cell.inMonth;
                      const disabledDay = cell.dateKey < minDateKey;
                      const busyCount = monthCounts?.get(cell.dateKey) ?? 0;
                      return (
                        <button
                          key={`${cell.dateKey}-${cell.inMonth}-${cell.day}`}
                          type="button"
                          disabled={disabledDay}
                          onClick={() => {
                            if (disabledDay) return;
                            setDateKey(cell.dateKey);
                            setDayPickerOpen(false);
                          }}
                          className={[
                            "flex w-full flex-col items-center py-1",
                            disabledDay ? "cursor-not-allowed" : "cursor-pointer",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold leading-none transition",
                              light
                                ? inMonth && !disabledDay
                                  ? panelDayDefault
                                  : panelDayOutside
                                : inMonth && !disabledDay
                                  ? "text-[var(--soft-gray)]"
                                  : "text-[var(--soft-gray)]/30",
                              disabledDay ? "opacity-35" : "",
                              sel && !disabledDay
                                ? light
                                  ? panelDaySelected
                                  : "bg-gradient-to-br from-[var(--accent-coral)] to-[var(--accent-orange)] text-white shadow-[0_8px_24px_rgba(182,75,84,0.35)]"
                                : !disabledDay && !light
                                  ? "hover:bg-white/5"
                                  : !disabledDay && light
                                    ? ""
                                    : "",
                            ].join(" ")}
                          >
                            {cell.day}
                          </span>
                          <span className="mt-0.5 flex h-2 items-center justify-center">
                            {busyCount > 0 ? (
                              <span className="block h-1 w-1 rounded-full bg-[#7da3c4]" />
                            ) : (
                              <span className="block h-1 w-1 rounded-full bg-transparent" />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <p className={`mb-2 text-[12px] font-semibold tracking-wide ${light ? "text-gray-600" : "text-[var(--soft-gray)]/70"}`}>
              Horario
            </p>
            {slotsLoading ? (
              <div className="flex items-center gap-2 py-6 text-[14px] text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando horarios…
              </div>
            ) : slotsError ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800">
                {slotsError}
              </p>
            ) : !slotRows || slotRows.length === 0 ? (
              <p className="py-4 text-center text-[14px] text-gray-500">
                No hay franjas ese día (salón cerrado, sin grilla o fuera del plazo de reserva web).
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {slotRows.map((row) => {
                  if (row.kind === "available") {
                    return (
                      <li key={row.timeLocal}>
                        <button
                          type="button"
                          onClick={() => setTimeLocal(row.timeLocal)}
                          className={[
                            "w-full cursor-pointer rounded-xl border px-3.5 py-2.5 text-left text-[13px] font-semibold transition",
                            timeLocal === row.timeLocal
                              ? light
                                ? "border-[#7da3c4] bg-[#7da3c4]/10 text-[#5f7a8f]"
                                : "border-[var(--premium-gold)] bg-[var(--premium-gold)]/18 text-[var(--premium-gold)]"
                              : light
                                ? "border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                                : "border-white/12 bg-[#171717] text-[var(--soft-gray)]/88 hover:border-white/20",
                          ].join(" ")}
                        >
                          <span className="font-mono tabular-nums">{row.timeLocal}</span>
                          <span className="ml-2 text-[12px] font-medium text-emerald-600">Disponible</span>
                        </button>
                      </li>
                    );
                  }
                  if (row.kind === "reserved") {
                    if (variant === "panel") {
                      return (
                        <li key={row.timeLocal}>
                          <button
                            type="button"
                            onClick={() => setTimeLocal(row.timeLocal)}
                            className={[
                              "w-full cursor-pointer rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition",
                              timeLocal === row.timeLocal
                                ? "border-amber-500 bg-amber-50 text-amber-950"
                                : "border-amber-200 bg-amber-50/70 text-gray-800 hover:bg-amber-50",
                            ].join(" ")}
                          >
                            <span className="font-mono tabular-nums font-semibold">{row.timeLocal}</span>
                            <span className="ml-2 text-[12px] font-medium text-amber-800">Sobreturno</span>
                            <span className="mt-1 block text-[12px] leading-snug text-gray-600">
                              Ya está {row.customerName} · {row.treatmentName}. Podés cargar igual.
                            </span>
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={row.timeLocal}
                        className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600"
                      >
                        <span className="font-mono tabular-nums font-semibold text-gray-800">{row.timeLocal}</span>
                        <span className="ml-2 text-[12px] text-rose-600">Ocupado</span>
                        <span className="mt-1 block text-[12px] leading-snug text-gray-500">
                          {row.customerName} · {row.treatmentName}
                        </span>
                      </li>
                    );
                  }
                  if (row.kind === "agenda_block") {
                    return (
                      <li
                        key={row.timeLocal}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900"
                      >
                        <span className="font-mono tabular-nums font-semibold">{row.timeLocal}</span>
                        <span className="ml-2 text-[12px]">Bloqueo · {scopeLabelPanel(row.scope)}</span>
                        {row.notes ? (
                          <span className="mt-1 block text-[12px] leading-snug text-amber-800/80">{row.notes}</span>
                        ) : null}
                      </li>
                    );
                  }
                  return variant === "panel" ? (
                    <li key={row.timeLocal}>
                      <button
                        type="button"
                        onClick={() => setTimeLocal(row.timeLocal)}
                        className={[
                          "w-full cursor-pointer rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition",
                          timeLocal === row.timeLocal
                            ? "border-amber-500 bg-amber-50 text-amber-950"
                            : "border-amber-200 bg-amber-50/70 text-gray-800 hover:bg-amber-50",
                        ].join(" ")}
                      >
                        <span className="font-mono tabular-nums font-semibold">{row.timeLocal}</span>
                        <span className="ml-2 text-[12px] font-medium text-amber-800">Sobreturno</span>
                        <span className="mt-1 block text-[12px] leading-snug text-gray-600">
                          Sin cupo en esta franja. Podés cargar igual.
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li
                      key={row.timeLocal}
                      className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-500"
                    >
                      <span className="font-mono tabular-nums font-semibold text-gray-600">{row.timeLocal}</span>
                      <span className="ml-2 text-[12px]">Sin cupo en esta franja</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {saveError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800">
              {saveError}
            </p>
          ) : null}

          {selectedIsSobreturno ? (
            <p
              role="status"
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] leading-snug text-amber-900"
            >
              {sobreturnoDetail}
            </p>
          ) : null}

          <button
            ref={confirmButtonRef}
            type="button"
            disabled={saving || !timeLocal}
            onClick={() => void handleSave()}
            className={
              light
                ? panelPrimaryBtn
                : "w-full cursor-pointer rounded-2xl bg-gradient-to-r from-[var(--accent-coral)] to-[var(--accent-orange)] py-3.5 text-[15px] font-bold text-white shadow-[0_10px_28px_rgba(182,75,84,0.35)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
            }
          >
            {saving ? "Guardando…" : "Confirmar nuevo horario"}
          </button>
        </div>
      ) : null}
    </main>
    <PanelSobreturnoConfirm
      open={sobreturnoOpen}
      title="Este horario ya tiene otra clienta"
      detail={sobreturnoDetail}
      confirmLabel="Mover igual"
      busy={saving}
      onCancel={() => setSobreturnoOpen(false)}
      onConfirm={() => void submitSave()}
    />
    </div>
  );
}
