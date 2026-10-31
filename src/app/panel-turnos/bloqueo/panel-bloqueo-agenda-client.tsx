"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { PanelAgendaBlock, PanelReservation } from "@/components/panel/panel-types";
import {
  panelBackBtn,
  panelCard,
  panelContainer,
  panelInput,
  panelPage,
  panelPrimaryBtn,
} from "@/components/panel/panel-ui";
import {
  type MinuteRange,
  addDaysToDateKey,
  dayHasHelper,
  formatRange,
  hhmmToMinutesSafe,
  longDateEs,
  mergeRanges,
  minutesToHhmm,
  openDateKeysBetween,
  rangesOverlap,
  salonDayChips,
  salonFullDayRange,
  shortDateEs,
  weekdayPlural,
} from "@/lib/booking/agenda-block-ui";
import { agendaBlockAppliesToDateKey } from "@/lib/booking/agenda-blocks-shared";
import { PANEL_WEEK_LETTERS, buildPanelMonthGrid, panelMonthTitle } from "@/lib/booking/panel-month-grid";
import { getAvailableTimesForDate } from "@/lib/booking/salon-availability";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";

type DayMode = "single" | "range";
type MonthData = { reservations: PanelReservation[]; agendaBlocks: PanelAgendaBlock[] };
type DayData = { reservations: PanelReservation[]; blocks: PanelAgendaBlock[] };
type TimeMode = "fullDay" | "chips" | "custom";
type Who = "salon" | "helper";

const REPEAT_OPTIONS = [
  { weeks: 0, label: "Siempre" },
  { weeks: 4, label: "4 semanas" },
  { weeks: 8, label: "8 semanas" },
  { weeks: 12, label: "12 semanas" },
] as const;

const REASONS = ["Vacaciones", "Trámite", "Médico", "Capacitación", "Personal"] as const;

function ymOf(dateKey: string) {
  const [y, m] = dateKey.split("-").map(Number);
  return { y, m };
}

function monthKey(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function rangeOfBlockOnDay(b: PanelAgendaBlock): MinuteRange | null {
  const s = hhmmToMinutesSafe(b.timeLocal);
  if (s === null) return null;
  return { start: s, end: s + b.durationMinutes };
}

function rangeOfReservation(r: PanelReservation): MinuteRange | null {
  const s = hhmmToMinutesSafe(r.timeLocal);
  if (s === null) return null;
  const dur = findSalonTreatmentById(r.treatmentId)?.durationMinutes ?? 90;
  return { start: s, end: s + dur };
}

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-[17px] font-bold text-gray-900">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[14px] font-bold text-amber-800">
        {n}
      </span>
      {children}
    </h2>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
  hint,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        "flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
        selected ? "border-[#7da3c4] bg-[#7da3c4]/10" : "border-gray-200 bg-white hover:border-gray-300",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-[#7da3c4] bg-[#7da3c4] text-white" : "border-gray-300 bg-white",
        ].join(" ")}
      >
        {selected ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[16px] font-semibold text-gray-900">{children}</span>
        {hint ? <span className="mt-0.5 block text-[13px] leading-snug text-gray-500">{hint}</span> : null}
      </span>
    </button>
  );
}

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={[
            "h-11 cursor-pointer rounded-xl text-[15px] font-semibold transition",
            value === o.v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PanelBloqueoAgendaClient({ initialDateKey }: { initialDateKey: string }) {
  const router = useRouter();
  const init = ymOf(initialDateKey);

  const [dayMode, setDayMode] = useState<DayMode>("single");
  const [dateKey, setDateKey] = useState(initialDateKey);
  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(init.y);
  const [calMonth, setCalMonth] = useState(init.m);

  const [timeMode, setTimeMode] = useState<TimeMode>("fullDay");
  const [chips, setChips] = useState<number[]>([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [who, setWho] = useState<Who>("salon");
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<number>(0);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Reservas y bloqueos ya cargados, por mes "yyyy-mm". */
  const [monthData, setMonthData] = useState<Record<string, MonthData>>({});

  const grid = useMemo(() => buildPanelMonthGrid(calYear, calMonth), [calYear, calMonth]);

  const dayChips = useMemo(() => salonDayChips(dateKey), [dateKey]);
  const fullDay = useMemo(() => salonFullDayRange(dateKey), [dateKey]);
  const helperDay = dayMode === "single" && dayHasHelper(dateKey);

  const rangeDays = useMemo(() => {
    if (!rangeFrom) return [];
    return openDateKeysBetween(rangeFrom, rangeTo ?? rangeFrom);
  }, [rangeFrom, rangeTo]);

  // Cargar turnos/bloqueos de los meses involucrados (para avisos).
  const neededMonths = useMemo(() => {
    const set = new Set<string>();
    const keys = dayMode === "single" ? [dateKey] : rangeDays;
    for (const k of keys) {
      const { y, m } = ymOf(k);
      set.add(monthKey(y, m));
    }
    return [...set];
  }, [dayMode, dateKey, rangeDays]);

  useEffect(() => {
    const missing = neededMonths.filter((mk) => !(mk in monthData));
    if (missing.length === 0) return;
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (mk): Promise<[string, MonthData]> => {
          const [y, m] = mk.split("-").map(Number);
          try {
            const res = await fetch(`/api/panel-turnos/reservations?year=${y}&month=${m}`, {
              credentials: "same-origin",
            });
            if (!res.ok) return [mk, { reservations: [], agendaBlocks: [] }];
            const data = (await res.json()) as {
              reservations?: PanelReservation[];
              agendaBlocks?: PanelAgendaBlock[];
            };
            return [mk, { reservations: data.reservations ?? [], agendaBlocks: data.agendaBlocks ?? [] }];
          } catch {
            return [mk, { reservations: [], agendaBlocks: [] }];
          }
        }),
      );
      if (!alive) return;
      setMonthData((prev) => {
        const next = { ...prev };
        for (const [mk, v] of entries) next[mk] = v;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [neededMonths, monthData]);

  function dataForDay(k: string): DayData {
    const { y, m } = ymOf(k);
    const d = monthData[monthKey(y, m)];
    if (!d) return { reservations: [], blocks: [] };
    return {
      reservations: d.reservations.filter((r) => r.dateKey === k && r.reservationStatus !== "cancelled"),
      blocks: d.agendaBlocks.filter((b) => agendaBlockAppliesToDateKey(b, k)),
    };
  }

  /** Franjas a bloquear en modo "un día". */
  const singleRanges: MinuteRange[] = useMemo(() => {
    if (timeMode === "fullDay") return [fullDay];
    if (timeMode === "chips") {
      return mergeRanges(dayChips.filter((c) => chips.includes(c.start)));
    }
    const s = hhmmToMinutesSafe(customStart);
    const e = hhmmToMinutesSafe(customEnd);
    if (s === null || e === null || e <= s) return [];
    return [{ start: s, end: e }];
  }, [timeMode, fullDay, dayChips, chips, customStart, customEnd]);

  const customError = useMemo(() => {
    if (timeMode !== "custom") return null;
    const s = hhmmToMinutesSafe(customStart);
    const e = hhmmToMinutesSafe(customEnd);
    if (s === null || e === null) return null;
    if (e <= s) return "La hora de fin tiene que ser después de la de inicio.";
    if (e - s < 15) return "Tiene que durar al menos 15 minutos.";
    return null;
  }, [timeMode, customStart, customEnd]);

  const existingSingle: DayData = dayMode === "single" ? dataForDay(dateKey) : { reservations: [], blocks: [] };

  const conflictingReservations = useMemo(() => {
    if (dayMode === "single") {
      return existingSingle.reservations.filter((r) => {
        const rr = rangeOfReservation(r);
        return rr ? singleRanges.some((s) => rangesOverlap(s, rr)) : false;
      });
    }
    return rangeDays.flatMap((k) => dataForDay(k).reservations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayMode, singleRanges, rangeDays, monthData, dateKey]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (dayMode === "range") return rangeDays.length > 0;
    if (getAvailableTimesForDate(dateKey).length === 0) return false;
    if (customError) return false;
    return singleRanges.length > 0;
  }, [submitting, dayMode, rangeDays, dateKey, customError, singleRanges]);

  const untilDateKey =
    repeatWeekly && repeatWeeks > 0 ? addDaysToDateKey(dateKey, (repeatWeeks - 1) * 7) : null;

  // ---- Calendario ----

  function prevCalMonth() {
    if (calMonth === 1) {
      setCalMonth(12);
      setCalYear((y) => y - 1);
    } else setCalMonth((m) => m - 1);
  }

  function nextCalMonth() {
    if (calMonth === 12) {
      setCalMonth(1);
      setCalYear((y) => y + 1);
    } else setCalMonth((m) => m + 1);
  }

  function handleDayClick(k: string) {
    setError(null);
    if (dayMode === "single") {
      if (k !== dateKey) {
        setDateKey(k);
        setChips([]);
        setCustomStart("");
        setCustomEnd("");
        if (!dayHasHelper(k)) setWho("salon");
      }
      return;
    }
    if (!rangeFrom || rangeTo) {
      setRangeFrom(k);
      setRangeTo(null);
      return;
    }
    if (k < rangeFrom) {
      setRangeFrom(k);
      return;
    }
    setRangeTo(k);
  }

  function changeDayMode(m: DayMode) {
    setDayMode(m);
    setError(null);
    if (m === "range") {
      setRangeFrom(dateKey);
      setRangeTo(null);
    }
  }

  function toggleChip(start: number) {
    setChips((prev) => (prev.includes(start) ? prev.filter((x) => x !== start) : [...prev, start]));
  }

  function chooseTimeMode(m: TimeMode) {
    setTimeMode(m);
    if (m === "custom" && !customStart) {
      setCustomStart(minutesToHhmm(fullDay.start));
      setCustomEnd(minutesToHhmm(Math.min(fullDay.start + 90, fullDay.end)));
    }
  }

  function toggleReason(r: string) {
    setNotes((prev) => (prev.trim() === r ? "" : r));
  }

  // ---- Resumen ----

  const summary = useMemo(() => {
    if (dayMode === "range") {
      if (!rangeFrom) return null;
      const to = rangeTo ?? rangeFrom;
      if (rangeDays.length === 0) return "En esas fechas el salón ya está cerrado. Elegí otros días.";
      const span = to === rangeFrom ? `el ${longDateEs(rangeFrom)}` : `del ${shortDateEs(rangeFrom)} al ${shortDateEs(to)}`;
      const n = rangeDays.length;
      return `Vas a cerrar la agenda ${span}: ${n} ${n === 1 ? "día" : "días"} de atención, todo el día. Nadie va a poder reservar.`;
    }
    if (singleRanges.length === 0) return null;
    const times =
      timeMode === "fullDay"
        ? `todo el día (${formatRange(fullDay)})`
        : singleRanges.map((r) => `de ${formatRange(r)}`).join(" y ");
    const whoText =
      helperDay && who === "helper" ? "Falta la ayudante: queda 1 lugar para reservar." : "Nadie va a poder reservar.";
    let repeat = "";
    if (repeatWeekly) {
      repeat =
        untilDateKey !== null
          ? ` Se repite todos los ${weekdayPlural(dateKey)} hasta el ${shortDateEs(untilDateKey)}.`
          : ` Se repite todos los ${weekdayPlural(dateKey)}, sin fecha de fin.`;
    }
    return `Vas a bloquear el ${longDateEs(dateKey)} ${times}. ${whoText}${repeat}`;
  }, [dayMode, rangeFrom, rangeTo, rangeDays, singleRanges, timeMode, fullDay, helperDay, who, repeatWeekly, untilDateKey, dateKey]);

  // ---- Guardar ----

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    const note = notes.trim() || null;
    let blocks: Record<string, unknown>[];
    let goTo: string;

    if (dayMode === "range") {
      blocks = rangeDays.map((k) => {
        const r = salonFullDayRange(k);
        return {
          anchorDateKey: k,
          timeLocal: minutesToHhmm(r.start),
          durationMinutes: r.end - r.start,
          scope: "salon",
          recurrenceType: "once",
          notes: note,
        };
      });
      goTo = rangeDays[0];
    } else {
      const scope = helperDay && who === "helper" ? "chair_2" : "salon";
      blocks = singleRanges.map((r) => ({
        anchorDateKey: dateKey,
        timeLocal: minutesToHhmm(r.start),
        durationMinutes: r.end - r.start,
        scope,
        recurrenceType: repeatWeekly ? "weekly" : "once",
        untilDateKey: repeatWeekly ? untilDateKey : null,
        notes: note,
      }));
      goTo = dateKey;
    }

    const groupId =
      blocks.length > 1
        ? typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`
        : null;

    try {
      const res = await fetch("/api/panel-turnos/agenda-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ blocks, groupId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        if (res.status === 401) {
          setError("Se cerró la sesión del panel. Volvé a entrar y probá de nuevo.");
          return;
        }
        setError(data.error ?? "No se pudo guardar. Probá de nuevo.");
        return;
      }
      router.push(`/panel-turnos?fecha=${goTo}&bloqueado=1`);
    } catch {
      setError("No hay conexión. Revisá internet y probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render ----

  const salonAlreadyBlocked = (r: MinuteRange) =>
    existingSingle.blocks.some((b) => {
      if (b.scope !== "salon") return false;
      const br = rangeOfBlockOnDay(b);
      return br ? br.start <= r.start && br.end >= r.end : false;
    });

  let step = 1;

  return (
    <div className={`${panelPage} bg-[#F0F1F3]`}>
      <div className={`${panelContainer} pt-6`}>
        <header className="mb-5 flex items-center gap-3">
          <Link href={`/panel-turnos?fecha=${dateKey}`} className={panelBackBtn} aria-label="Volver al panel">
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
              <Lock className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading text-[20px] font-bold leading-tight text-gray-900">Bloquear horario</h1>
              <p className="text-[13px] text-gray-500">Para que nadie reserve cuando no atendés</p>
            </div>
          </div>
        </header>

        <div className="space-y-4">
          {/* 1. Día */}
          <section className={`${panelCard} space-y-4 p-4`}>
            <StepTitle n={step++}>¿Qué día?</StepTitle>
            <SegmentedToggle<DayMode>
              value={dayMode}
              onChange={changeDayMode}
              options={[
                { v: "single", label: "Un día" },
                { v: "range", label: "Varios días" },
              ]}
            />
            {dayMode === "range" ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[14px] leading-snug text-amber-900">
                {!rangeFrom || rangeTo
                  ? "Tocá el primer día y después el último día."
                  : `Desde el ${shortDateEs(rangeFrom)}. Ahora tocá el último día.`}
              </p>
            ) : null}

            <div>
              <div className="relative mb-2 flex items-center justify-center px-10">
                <button
                  type="button"
                  onClick={prevCalMonth}
                  className="absolute left-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-[15px] font-semibold capitalize text-gray-900">
                  {panelMonthTitle(calYear, calMonth)}
                </span>
                <button
                  type="button"
                  onClick={nextCalMonth}
                  className="absolute right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-400">
                {PANEL_WEEK_LETTERS.map((L) => (
                  <div key={L} className="py-1.5">
                    {L}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1 text-center">
                {grid.map((cell) => {
                  const open = getAvailableTimesForDate(cell.dateKey).length > 0;
                  const disabled = !cell.inMonth || !open;
                  const rangeEnd = rangeTo ?? rangeFrom;
                  const inRange =
                    dayMode === "range" && rangeFrom && rangeEnd
                      ? cell.dateKey >= rangeFrom && cell.dateKey <= rangeEnd
                      : false;
                  const isEdge =
                    dayMode === "range" ? cell.dateKey === rangeFrom || cell.dateKey === rangeTo : cell.dateKey === dateKey;
                  return (
                    <button
                      key={`${cell.dateKey}-${cell.inMonth}`}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleDayClick(cell.dateKey)}
                      className={[
                        "flex cursor-pointer justify-center py-0.5 disabled:cursor-not-allowed",
                        inRange && cell.inMonth ? "bg-amber-50" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold transition",
                          !cell.inMonth ? "text-transparent" : disabled ? "text-gray-300 line-through" : "text-gray-800",
                          isEdge && cell.inMonth ? "bg-[#7da3c4] text-white no-underline shadow-md" : "",
                          !isEdge && !disabled ? "hover:bg-gray-100" : "",
                        ].join(" ")}
                      >
                        {cell.day}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[12px] text-gray-400">Los días tachados el salón ya está cerrado.</p>
            </div>

            {dayMode === "single" ? (
              <p className="text-center text-[16px] font-semibold capitalize text-gray-900">{longDateEs(dateKey)}</p>
            ) : null}
          </section>

          {/* 2. Horario */}
          {dayMode === "single" ? (
            <section className={`${panelCard} space-y-3 p-4`}>
              <StepTitle n={step++}>¿Qué horario?</StepTitle>
              <ChoiceButton
                selected={timeMode === "fullDay"}
                onClick={() => chooseTimeMode("fullDay")}
                hint={`De ${formatRange(fullDay)}`}
              >
                Todo el día
              </ChoiceButton>
              <ChoiceButton
                selected={timeMode === "chips"}
                onClick={() => chooseTimeMode("chips")}
                hint="Elegís uno o más turnos"
              >
                Algunos turnos
              </ChoiceButton>

              {timeMode === "chips" ? (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {dayChips.map((c) => {
                    const sel = chips.includes(c.start);
                    const blocked = salonAlreadyBlocked(c);
                    const booked = existingSingle.reservations.filter((r) => {
                      const rr = rangeOfReservation(r);
                      return rr ? rangesOverlap(rr, c) : false;
                    });
                    return (
                      <button
                        key={c.start}
                        type="button"
                        disabled={blocked}
                        onClick={() => toggleChip(c.start)}
                        aria-pressed={sel}
                        className={[
                          "flex min-h-[60px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-50",
                          sel ? "border-amber-500 bg-amber-100 text-amber-950" : "border-gray-200 bg-white text-gray-900",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-1 text-[16px] font-bold tabular-nums">
                          {sel ? <Lock className="h-4 w-4" strokeWidth={2.4} /> : null}
                          {minutesToHhmm(c.start)} – {minutesToHhmm(c.end)}
                        </span>
                        {blocked ? (
                          <span className="text-[12px] text-gray-500">Ya bloqueado</span>
                        ) : booked.length > 0 ? (
                          <span className="max-w-full truncate text-[12px] text-amber-700">
                            Turno: {booked.map((r) => r.customerName.split(" ")[0]).join(", ")}
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-400">Libre</span>
                        )}
                      </button>
                    );
                  })}
                  {chips.length === 0 ? (
                    <p className="col-span-2 text-center text-[13px] text-gray-500">Tocá los turnos que querés bloquear.</p>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => chooseTimeMode("custom")}
                className={[
                  "w-full cursor-pointer pt-1 text-center text-[14px] font-medium underline-offset-4",
                  timeMode === "custom" ? "text-[#7da3c4]" : "text-gray-500 underline",
                ].join(" ")}
              >
                {timeMode === "custom" ? "Otro horario:" : "Otro horario (elegir hora exacta)"}
              </button>
              {timeMode === "custom" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[13px] font-medium text-gray-600">
                    Desde
                    <input
                      type="time"
                      step={900}
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className={panelInput}
                    />
                  </label>
                  <label className="text-[13px] font-medium text-gray-600">
                    Hasta
                    <input
                      type="time"
                      step={900}
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className={panelInput}
                    />
                  </label>
                  {customError ? <p className="col-span-2 text-[13px] text-red-600">{customError}</p> : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* 3. Quién falta (solo jueves y sábados) */}
          {helperDay ? (
            <section className={`${panelCard} space-y-3 p-4`}>
              <StepTitle n={step++}>¿Quién no está?</StepTitle>
              <ChoiceButton
                selected={who === "salon"}
                onClick={() => setWho("salon")}
                hint="Nadie puede reservar en ese horario"
              >
                No atiende nadie
              </ChoiceButton>
              <ChoiceButton
                selected={who === "helper"}
                onClick={() => setWho("helper")}
                hint="Atendés vos sola: queda 1 lugar para reservar"
              >
                Falta la ayudante
              </ChoiceButton>
            </section>
          ) : null}

          {/* 4. Repetir */}
          {dayMode === "single" ? (
            <section className={`${panelCard} space-y-3 p-4`}>
              <StepTitle n={step++}>¿Se repite?</StepTitle>
              <ChoiceButton selected={!repeatWeekly} onClick={() => setRepeatWeekly(false)}>
                No, solo este día
              </ChoiceButton>
              <ChoiceButton selected={repeatWeekly} onClick={() => setRepeatWeekly(true)}>
                Sí, todos los {weekdayPlural(dateKey)}
              </ChoiceButton>
              {repeatWeekly ? (
                <div className="space-y-2 pt-1">
                  <p className="text-[13px] font-medium text-gray-600">¿Por cuánto tiempo?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {REPEAT_OPTIONS.map((o) => (
                      <button
                        key={o.weeks}
                        type="button"
                        onClick={() => setRepeatWeeks(o.weeks)}
                        aria-pressed={repeatWeeks === o.weeks}
                        className={[
                          "h-11 cursor-pointer rounded-xl border-2 text-[15px] font-semibold transition",
                          repeatWeeks === o.weeks
                            ? "border-[#7da3c4] bg-[#7da3c4]/10 text-gray-900"
                            : "border-gray-200 bg-white text-gray-600",
                        ].join(" ")}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {untilDateKey ? (
                    <p className="text-[13px] text-gray-500">Último: {longDateEs(untilDateKey)}</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* 5. Motivo */}
          <section className={`${panelCard} space-y-3 p-4`}>
            <StepTitle n={step++}>
              Motivo <span className="text-[14px] font-normal text-gray-400">(opcional, solo lo ves vos)</span>
            </StepTitle>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleReason(r)}
                  aria-pressed={notes.trim() === r}
                  className={[
                    "h-10 cursor-pointer rounded-full border px-4 text-[14px] font-medium transition",
                    notes.trim() === r
                      ? "border-[#7da3c4] bg-[#7da3c4] text-white"
                      : "border-gray-200 bg-white text-gray-700",
                  ].join(" ")}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="O escribí otro motivo"
              maxLength={200}
              className={panelInput}
            />
          </section>

          {/* Avisos y resumen */}
          {conflictingReservations.length > 0 ? (
            <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" strokeWidth={2.2} />
              <div className="text-[14px] leading-snug">
                <p className="font-semibold">Ojo: ya hay turnos en ese horario</p>
                <ul className="mt-1 space-y-0.5">
                  {conflictingReservations.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      {dayMode === "range" ? `${shortDateEs(r.dateKey)}, ` : ""}
                      {r.timeLocal} · {r.customerName}
                    </li>
                  ))}
                  {conflictingReservations.length > 6 ? <li>y {conflictingReservations.length - 6} más</li> : null}
                </ul>
                <p className="mt-1.5 text-[13px] text-amber-800">
                  El bloqueo no cancela esos turnos. Si no vas a atender, avisales o cancelalos desde el panel.
                </p>
              </div>
            </div>
          ) : null}

          {summary ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-[12px] font-semibold tracking-wide text-gray-400 uppercase">Resumen</p>
              <p className="mt-1 text-[16px] leading-snug text-gray-900">{summary}</p>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</p>
          ) : null}

          <button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()} className={panelPrimaryBtn}>
            <Lock className="mr-2 h-5 w-5" strokeWidth={2.2} />
            {submitting ? "Guardando…" : "Bloquear"}
          </button>
        </div>
      </div>
    </div>
  );
}
