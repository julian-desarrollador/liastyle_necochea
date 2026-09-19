"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { CategoryPhotoCard } from "@/components/category-photo-card";
import { BOOKING_CATEGORY_CARDS } from "@/lib/booking/category-cards";
import { SALON_TREATMENT_OPTIONS } from "@/lib/booking/salon-availability";
import { findSalonTreatmentById, type TreatmentCategory } from "@/lib/treatments/catalog";
import { formatArs, summarizeDepositForTreatments } from "@/lib/treatments/deposit";

type BookingCategoryStepProps = {
  onSelectCategory: (category: TreatmentCategory) => void;
  selectedServiceIds?: string[];
  selectedDurationLabel?: string;
  onClearSelection?: () => void;
  onContinue?: () => void;
};

export function BookingCategoryStep({
  onSelectCategory,
  selectedServiceIds = [],
  selectedDurationLabel,
  onClearSelection,
  onContinue,
}: BookingCategoryStepProps) {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const selectedServices = useMemo(
    () =>
      selectedServiceIds.flatMap((id) => {
        const found = SALON_TREATMENT_OPTIONS.find((option) => option.id === id);
        return found ? [found] : [];
      }),
    [selectedServiceIds],
  );

  const selectedCountByCategory = useMemo(() => {
    const counts = new Map<TreatmentCategory, number>();
    for (const service of selectedServices) {
      counts.set(service.category, (counts.get(service.category) ?? 0) + 1);
    }
    return counts;
  }, [selectedServices]);

  const selectedSummary = useMemo(
    () => selectedServices.map((service) => service.name).join(" · "),
    [selectedServices],
  );

  const depositSummary = useMemo(() => {
    const treatments = selectedServiceIds
      .map((id) => findSalonTreatmentById(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (treatments.length === 0) return null;
    return summarizeDepositForTreatments(treatments);
  }, [selectedServiceIds]);

  useEffect(() => {
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      card.style.opacity = "0";
      card.style.transform = "translateY(16px)";
      card.style.transition = "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)";
      window.setTimeout(() => {
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      }, 80 * (index + 1));
    });
  }, []);

  return (
    <div className="@container space-y-5">
      {selectedServices.length > 0 ? (
        <div className="rounded-2xl border border-[var(--premium-gold-light)]/35 bg-white px-4 py-3.5 shadow-[0_4px_20px_rgba(125,163,196,0.12)]">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--premium-gold-light)] uppercase">
            {selectedServices.length}{" "}
            {selectedServices.length === 1 ? "servicio seleccionado" : "servicios seleccionados"}
          </p>
          <p className="mt-1.5 text-[14px] leading-snug font-medium text-[#1c1b1b]">{selectedSummary}</p>
          {selectedDurationLabel ? (
            <p className="mt-1 text-[12px] text-[#7f7c7a]">{selectedDurationLabel}</p>
          ) : null}
          {depositSummary && depositSummary.depositAmountArs > 0 ? (
            <p className="mt-1.5 text-[12px] font-medium text-[#1c1b1b]">
              Seña: {depositSummary.priceIsFrom ? "desde " : ""}
              {formatArs(depositSummary.depositAmountArs)}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-snug text-[#7f7c7a]">
            Tocá una categoría para agregar o cambiar servicios.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {onClearSelection ? (
              <button
                type="button"
                onClick={onClearSelection}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--outline)]/15 px-3 py-2 text-[12px] font-medium text-[#7f7c7a] transition-colors hover:border-red-300/50 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                Quitar todo
              </button>
            ) : null}
            {onContinue ? (
              <button
                type="button"
                onClick={onContinue}
                className="ml-auto flex-1 cursor-pointer rounded-full bg-[var(--premium-gold-light)] py-2.5 text-[13px] font-semibold tracking-wide text-white uppercase transition-all hover:opacity-95 active:scale-[0.98]"
              >
                Continuar
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="px-0.5 text-[12px] leading-snug text-[#7f7c7a]">
          En la mayoría de los servicios, para reservar se abona el valor con Mercado Pago.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5 @min-[32rem]:grid-cols-4">
        {BOOKING_CATEGORY_CARDS.map((card, index) => (
          <div
            key={card.category}
            ref={(el) => {
              cardRefs.current[index] = el;
            }}
          >
            <CategoryPhotoCard
              card={card}
              selectionCount={selectedCountByCategory.get(card.category) ?? 0}
              onClick={() => onSelectCategory(card.category)}
              action="plus"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
