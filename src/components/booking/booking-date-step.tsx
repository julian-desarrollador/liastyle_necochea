"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  formatSalonDateKey,
  formatSalonDisplayDate,
  salonWeekdayLabels,
  type SalonCalendarItem,
} from "@/lib/booking/salon-availability";

type BookingDateStepProps = {
  selectedDate: string;
  onDateChange: (dateKey: string) => void;
  onTimeChange: (time: string) => void;
  visibleMonthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  calendarItems: SalonCalendarItem[];
  monthAvailability: Record<string, boolean> | null | undefined;
  hasSelectedTreatment: boolean;
  monthAvailabilityLoading: boolean;
  selectedCountLabel?: string;
  treatmentFirstHintVisible: boolean;
  onTreatmentFirstHintVisible: (visible: boolean) => void;
  onConfirm: () => void;
};

export function BookingDateStep({
  selectedDate,
  onDateChange,
  onTimeChange,
  visibleMonthLabel,
  onPrevMonth,
  onNextMonth,
  calendarItems,
  monthAvailability,
  hasSelectedTreatment,
  monthAvailabilityLoading,
  selectedCountLabel,
  treatmentFirstHintVisible,
  onTreatmentFirstHintVisible,
  onConfirm,
}: BookingDateStepProps) {
  const todayKey = formatSalonDateKey(new Date());

  const summaryText = selectedCountLabel
    ? selectedDate
      ? `${selectedCountLabel} · ${formatSalonDisplayDate(selectedDate)}`
      : selectedCountLabel
    : selectedDate
      ? formatSalonDisplayDate(selectedDate)
      : "Elegí un día";

  return (
    <div className="pb-28">
      <div className="mx-auto w-full max-w-md">
      <div className="mb-4 flex items-center justify-between rounded-xl bg-[#eceae6]/80 px-4 py-3">
        <p className="text-sm text-[#7f7c7a]">{summaryText}</p>
        <span className="h-0.5 w-6 rounded-full bg-[var(--premium-gold-light)]" aria-hidden />
      </div>

      <section className="overflow-hidden rounded-[28px] border border-[var(--outline)]/8 bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onPrevMonth}
            className="cursor-pointer rounded-lg p-1.5 text-[#7f7c7a] transition-colors hover:bg-[#f3f0eb]"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <h3 className="flex items-center gap-2 font-heading text-xl leading-none font-semibold text-[#1c1b1b]">
            {visibleMonthLabel}
            {hasSelectedTreatment && monthAvailabilityLoading ? (
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--premium-gold-light)]" aria-hidden />
            ) : null}
          </h3>
          <button
            type="button"
            onClick={onNextMonth}
            className="cursor-pointer rounded-lg p-1.5 text-[#7f7c7a] transition-colors hover:bg-[#f3f0eb]"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>

        {treatmentFirstHintVisible ? (
          <p
            role="status"
            aria-live="polite"
            className="mb-3 rounded-xl border border-[var(--premium-gold-light)]/30 bg-[var(--premium-gold)]/10 px-3 py-2.5 text-center text-xs leading-snug text-[#1c1b1b]"
          >
            <span className="font-semibold">Primero elegí un servicio</span> para poder elegir el día.
          </p>
        ) : null}

        <div className="grid grid-cols-7 gap-y-3 text-center" aria-busy={monthAvailabilityLoading}>
          {salonWeekdayLabels.map((label) => (
            <div key={label} className="text-[11px] font-medium tracking-wide text-[#9797a0]">
              {label}
            </div>
          ))}
          {calendarItems.map((day) => {
            const isSelected = day.value === selectedDate;
            const isToday = day.value === todayKey;
            const monthAvailReady = monthAvailability !== undefined && monthAvailability !== null;
            const fullyBooked =
              hasSelectedTreatment &&
              monthAvailReady &&
              day.isCurrentMonth &&
              day.isAvailable &&
              monthAvailability[day.value] === false;
            const isDisabled = !day.isCurrentMonth || !day.isAvailable || fullyBooked;
            const isSelectable = day.isCurrentMonth && day.isAvailable && !fullyBooked;

            return (
              <button
                key={day.value}
                type="button"
                disabled={isDisabled}
                title={
                  fullyBooked
                    ? "Sin cupos para este servicio."
                    : !day.isAvailable && day.isCurrentMonth
                      ? "Día no disponible."
                      : undefined
                }
                onClick={() => {
                  if (!hasSelectedTreatment) {
                    onTreatmentFirstHintVisible(true);
                    return;
                  }
                  onDateChange(day.value);
                  onTimeChange("");
                }}
                className={`mx-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed ${
                  isSelected
                    ? "bg-[var(--premium-gold-light)] text-white shadow-[0_4px_16px_rgba(125,163,196,0.45)]"
                    : fullyBooked
                      ? "text-[#c4c0b8] line-through decoration-[#c4c0b8]"
                      : !day.isCurrentMonth
                        ? "text-[#d8d4cc]"
                        : isToday && isSelectable
                          ? "bg-[#eceae6] text-[#1c1b1b]"
                          : isSelectable
                            ? "border border-[#ddd9d2] bg-white text-[#1c1b1b] hover:border-[var(--premium-gold-light)]/50"
                            : "text-[#c4c0b8]"
                }`}
              >
                {day.dayNumber}
              </button>
            );
          })}
        </div>
      </section>
      </div>

      <div className="pointer-events-none fixed right-0 bottom-24 left-0 z-40 px-6">
        <div className="pointer-events-auto mx-auto max-w-md">
          <button
            type="button"
            disabled={!selectedDate}
            onClick={onConfirm}
            className="w-full rounded-full bg-[var(--premium-gold-light)] py-[15px] text-[15px] font-semibold tracking-widest text-white uppercase shadow-lg shadow-[var(--premium-gold-light)]/25 transition-all active:scale-95 disabled:bg-[#d8d4cc] disabled:text-[#9797a0] disabled:shadow-none"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
