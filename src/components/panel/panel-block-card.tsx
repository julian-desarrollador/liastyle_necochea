"use client";

import { Lock } from "lucide-react";

import {
  blockScopeLabel,
  hhmmToMinutesSafe,
  isFullDayBlock,
  minutesToHhmm,
  shortDateEs,
  weekdayPlural,
} from "@/lib/booking/agenda-block-ui";
import { isReservationTimeFocused } from "@/lib/booking/panel-now-focus";

import type { PanelAgendaBlock } from "@/components/panel/panel-types";

type PanelBlockCardProps = {
  block: PanelAgendaBlock;
  selectedDateKey: string;
  onDelete: () => void;
};

export function PanelBlockCard({ block: b, selectedDateKey, onDelete }: PanelBlockCardProps) {
  const weekly = b.recurrence?.type === "weekly";
  const focused = isReservationTimeFocused(b.timeLocal, selectedDateKey);
  const fullDay = isFullDayBlock(selectedDateKey, b.timeLocal, b.durationMinutes);
  const start = hhmmToMinutesSafe(b.timeLocal);
  const timeText = fullDay
    ? "Todo el día"
    : start !== null
      ? `${b.timeLocal} – ${minutesToHhmm(start + b.durationMinutes)}`
      : b.timeLocal;
  const until = b.recurrence?.untilDateKey;

  return (
    <article
      className={[
        "overflow-hidden rounded-[22px] border bg-amber-50/60 shadow-[0_6px_24px_rgba(0,0,0,0.08)]",
        focused ? "border-amber-300 ring-2 ring-amber-200/70" : "border-amber-200",
      ].join(" ")}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={[
              "rounded-full px-3.5 py-1.5 text-[14px] font-semibold leading-none tabular-nums tracking-tight",
              focused ? "bg-amber-200 text-amber-950" : "bg-amber-100 text-amber-900",
            ].join(" ")}
          >
            {timeText}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-amber-700/80">BLOQUEADO</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Lock className="h-5 w-5 shrink-0 text-amber-700" strokeWidth={2} />
          <h3 className="font-heading text-[18px] font-bold text-gray-900">{blockScopeLabel(b.scope)}</h3>
        </div>

        {weekly ? (
          <p className="mt-1 text-[14px] text-gray-600">
            Todos los {weekdayPlural(b.anchorDateKey)}
            {until ? ` hasta el ${shortDateEs(until)}` : ""}
          </p>
        ) : null}

        {b.notes ? (
          <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[14px] leading-snug text-gray-700">{b.notes}</p>
        ) : null}

        <button
          type="button"
          onClick={onDelete}
          className="mt-3 flex h-10 w-full cursor-pointer items-center justify-center rounded-xl border border-red-200 bg-white text-[14px] font-semibold text-red-600 transition hover:bg-red-50"
        >
          Quitar bloqueo
        </button>
      </div>
    </article>
  );
}
