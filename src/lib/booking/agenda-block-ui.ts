/**
 * Helpers de UI para bloqueos de agenda (sin Node/Mongo: seguro en Client Components).
 */

import {
  SALON_SLOT_STEP_MINUTES,
  getAvailableTimesForDate,
  getSalonLastServiceEndMinutes,
} from "@/lib/booking/salon-availability";

export type MinuteRange = { start: number; end: number };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function minutesToHhmm(total: number): string {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function hhmmToMinutesSafe(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Apertura del salón ese día (no depende de si la fecha ya pasó). */
export function salonOpenMinutesForDateKey(dateKey: string): number {
  return weekdayOf(dateKey) === 6 ? 11 * 60 : 10 * 60;
}

/** Turnos del día como franjas "10:00 – 11:30" (el último recortado al cierre). */
export function salonDayChips(dateKey: string): MinuteRange[] {
  const close = getSalonLastServiceEndMinutes(dateKey);
  return getAvailableTimesForDate(dateKey)
    .map((t) => hhmmToMinutesSafe(t))
    .filter((v): v is number => v !== null && v < close)
    .map((start) => ({ start, end: Math.min(start + SALON_SLOT_STEP_MINUTES, close) }));
}

/** Día completo: de la apertura al cierre. */
export function salonFullDayRange(dateKey: string): MinuteRange {
  return { start: salonOpenMinutesForDateKey(dateKey), end: getSalonLastServiceEndMinutes(dateKey) };
}

/** Une franjas que se tocan o se pisan (ej. 10:00–11:30 + 11:30–13:00 → 10:00–13:00). */
export function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: MinuteRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.start < b.end && a.end > b.start;
}

export function formatRange(r: MinuteRange): string {
  return `${minutesToHhmm(r.start)} a ${minutesToHhmm(r.end)}`;
}

/** Jueves y sábados trabaja con ayudante (2 lugares a la vez; ver `salonBaseConcurrentCapForDateKey`). */
export function dayHasHelper(dateKey: string): boolean {
  const wd = weekdayOf(dateKey);
  return wd === 4 || wd === 6;
}

export function isFullDayBlock(dateKey: string, timeLocal: string, durationMinutes: number): boolean {
  const start = hhmmToMinutesSafe(timeLocal);
  if (start === null) return false;
  const full = salonFullDayRange(dateKey);
  return start <= full.start && start + durationMinutes >= full.end;
}

/** Texto simple del alcance de un bloqueo. */
export function blockScopeLabel(scope: string): string {
  if (scope === "salon") return "Salón cerrado";
  return "Falta la ayudante (queda 1 lugar)";
}

const WEEKDAY_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

export function weekdayPlural(dateKey: string): string {
  return WEEKDAY_PLURAL[weekdayOf(dateKey)] ?? "";
}

/** "martes 4 de noviembre" */
export function longDateEs(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(dt).replace(",", "");
}

/** "4 de noviembre" */
export function shortDateEs(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Días abiertos (con turnos) entre `from` y `to`, inclusive. */
export function openDateKeysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let k = from;
  for (let i = 0; i < 400 && k <= to; i++) {
    if (getAvailableTimesForDate(k).length > 0) out.push(k);
    k = addDaysToDateKey(k, 1);
  }
  return out;
}

/** Primer día abierto a partir de `from` (inclusive). */
export function nextOpenDateKey(from: string): string {
  let k = from;
  for (let i = 0; i < 60; i++) {
    if (getAvailableTimesForDate(k).length > 0) return k;
    k = addDaysToDateKey(k, 1);
  }
  return from;
}
