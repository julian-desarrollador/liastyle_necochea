"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BookingCategoryStep } from "@/components/booking/booking-category-step";
import { BookingPicker } from "@/components/booking/booking-picker";
import { PanelSobreturnoConfirm } from "@/components/panel/panel-sobreturno-confirm";
import { panelInput, panelLabel, panelPrimaryBtn } from "@/components/panel/panel-ui";
import { BOOKING_STEP_HINTS } from "@/lib/booking/category-cards";
import {
  bookingFlowBackAriaLabel,
  resolveBookingFlowBackAction,
} from "@/lib/booking/booking-flow-back";
import {
  SALON_TREATMENT_OPTIONS,
  formatSalonDisplayDate,
  isLikelyWhatsappNumber,
} from "@/lib/booking/salon-availability";
import { isSoloComboTreatmentId } from "@/lib/treatments/booking-rules";
import { findSalonTreatmentById, type TreatmentCategory } from "@/lib/treatments/catalog";

export function PanelNuevoTurnoClient() {
  const router = useRouter();

  const [selectedTreatmentId, setSelectedTreatmentId] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [serviceLimitHint, setServiceLimitHint] = useState<string | null>(null);
  const [treatmentFirstHintVisible, setTreatmentFirstHintVisible] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [panelNotes, setPanelNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [remoteSlots, setRemoteSlots] = useState<string[] | null | undefined>(undefined);
  const [overCapacitySlots, setOverCapacitySlots] = useState<string[]>([]);
  const [sobreturnoOpen, setSobreturnoOpen] = useState(false);
  const [openModalCategory, setOpenModalCategory] = useState<TreatmentCategory | null>(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceModalDismissNonce, setServiceModalDismissNonce] = useState(0);
  const [serviceSelectionConfirmed, setServiceSelectionConfirmed] = useState(false);
  const [dateStepConfirmed, setDateStepConfirmed] = useState(false);

  const bookingFocusRef = useRef<HTMLDivElement | null>(null);
  const dataSectionRef = useRef<HTMLDivElement | null>(null);
  const confirmSectionRef = useRef<HTMLElement | null>(null);
  const scrollConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDatosCompleteRef = useRef(false);

  const handleSelectCategory = useCallback((category: TreatmentCategory) => {
    setOpenModalCategory(category);
  }, []);

  const selectedServices = useMemo(
    () =>
      selectedServiceIds.flatMap((id) => {
        const found = SALON_TREATMENT_OPTIONS.find((o) => o.id === id);
        return found ? [found] : [];
      }),
    [selectedServiceIds],
  );
  const selectedServicesSummary = useMemo(
    () => selectedServices.map((s) => s.name).join(" + "),
    [selectedServices],
  );
  const totalSelectedDurationMinutes = useMemo(
    () =>
      selectedServiceIds.reduce((acc, id) => {
        const t = findSalonTreatmentById(id);
        return acc + (t?.durationMinutes ?? 0);
      }, 0),
    [selectedServiceIds],
  );
  const totalSelectedDurationLabel = useMemo(() => {
    const total = totalSelectedDurationMinutes;
    if (total <= 0) return "";
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0 && m > 0) return `Duración ${h} h ${m} min`;
    if (h > 0) return `Duración ${h} h`;
    return `Duración ${m} min`;
  }, [totalSelectedDurationMinutes]);
  const primaryService = selectedServices[0];

  const hasSlot = Boolean(selectedServices.length > 0 && selectedDate && selectedTime);
  const datosComplete = Boolean(
    customerName.trim().length >= 2 &&
      isLikelyWhatsappNumber(customerPhone) &&
      whatsappOptIn,
  );
  const showWhatsappInvalidHint =
    customerPhone.trim().length >= 8 && !isLikelyWhatsappNumber(customerPhone);
  const showCategoryStep = !serviceSelectionConfirmed;

  const bookingHeaderStep = showCategoryStep
    ? 1
    : !dateStepConfirmed
      ? 2
      : !selectedTime
        ? 3
        : 3;

  const bookingStepHint = showCategoryStep
    ? BOOKING_STEP_HINTS[1]
    : !dateStepConfirmed
      ? BOOKING_STEP_HINTS[2]
      : BOOKING_STEP_HINTS[3];

  const bookingBackAction = useMemo(
    () =>
      resolveBookingFlowBackAction({
        serviceSelectionConfirmed,
        dateStepConfirmed,
        selectedTime,
        serviceModalOpen,
      }),
    [serviceSelectionConfirmed, dateStepConfirmed, selectedTime, serviceModalOpen],
  );

  const scrollBookingTop = useCallback(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const handleBookingBack = useCallback(() => {
    switch (bookingBackAction.type) {
      case "exit":
        router.push("/panel-turnos");
        return;
      case "close_service_modal":
        setOpenModalCategory(null);
        setServiceModalDismissNonce((n) => n + 1);
        return;
      case "to_service_selection":
        setServiceSelectionConfirmed(false);
        setDateStepConfirmed(false);
        scrollBookingTop();
        return;
      case "to_date_selection":
        setDateStepConfirmed(false);
        setSelectedTime("");
        scrollBookingTop();
        return;
      case "to_time_selection":
        setSelectedTime("");
        scrollBookingTop();
        return;
    }
  }, [bookingBackAction, router, scrollBookingTop]);

  const activeStep = selectedServices.length === 0
    ? 1
    : !selectedDate
      ? 2
      : !selectedTime
        ? 3
        : !datosComplete
          ? 4
          : 5;

  const lightCard = "rounded-2xl border border-[var(--outline)]/10 bg-white shadow-sm";
  const lightCardActive =
    "border-[var(--premium-gold-light)] shadow-[0_0_0_1px_rgba(125,163,196,0.18)]";

  useEffect(() => {
    if (!selectedDate) setDateStepConfirmed(false);
  }, [selectedDate]);

  useEffect(() => {
    if (!dateStepConfirmed) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }, [dateStepConfirmed]);

  useEffect(() => {
    if (selectedServices.length > 0) setTreatmentFirstHintVisible(false);
  }, [selectedServices.length]);

  useEffect(() => {
    if (!treatmentFirstHintVisible) return;
    const t = window.setTimeout(() => setTreatmentFirstHintVisible(false), 4500);
    return () => window.clearTimeout(t);
  }, [treatmentFirstHintVisible]);

  useEffect(() => {
    prevDatosCompleteRef.current = false;
  }, [selectedTreatmentId, selectedDate, selectedTime]);

  useEffect(() => {
    if (!selectedDate || selectedServiceIds.length === 0) {
      setRemoteSlots(undefined);
      setOverCapacitySlots([]);
      return;
    }
    let cancelled = false;
    setRemoteSlots(null);
    const q = new URLSearchParams({
      dateKey: selectedDate,
      treatmentId: selectedServiceIds[0] ?? "",
      serviceIds: selectedServiceIds.join(","),
      scope: "panel",
    });
    fetch(`/api/booking/slots?${q.toString()}`, { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data: { slots?: string[]; overCapacitySlots?: string[] }) => {
        if (!cancelled) {
          setRemoteSlots(Array.isArray(data.slots) ? data.slots : []);
          setOverCapacitySlots(Array.isArray(data.overCapacitySlots) ? data.overCapacitySlots : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteSlots([]);
          setOverCapacitySlots([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedServiceIds]);

  useEffect(() => {
    if (!selectedDate || !selectedTime || selectedServiceIds.length === 0) return;
    if (remoteSlots === undefined || remoteSlots === null) return;
    if (!remoteSlots.includes(selectedTime)) {
      setSelectedTime("");
      setSobreturnoOpen(false);
    }
  }, [selectedDate, selectedTime, selectedServiceIds, remoteSlots]);

  useEffect(() => {
    if (!serviceLimitHint) return;
    const t = window.setTimeout(() => setServiceLimitHint(null), 3200);
    return () => window.clearTimeout(t);
  }, [serviceLimitHint]);

  const scheduleScrollToConfirmSection = useCallback(() => {
    if (!hasSlot) return;
    if (scrollConfirmTimeoutRef.current) clearTimeout(scrollConfirmTimeoutRef.current);
    scrollConfirmTimeoutRef.current = setTimeout(() => {
      scrollConfirmTimeoutRef.current = null;
      confirmSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  }, [hasSlot]);

  useEffect(() => {
    return () => {
      if (scrollConfirmTimeoutRef.current) clearTimeout(scrollConfirmTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasSlot) {
      prevDatosCompleteRef.current = datosComplete;
      return;
    }
    const becameComplete = datosComplete && !prevDatosCompleteRef.current;
    prevDatosCompleteRef.current = datosComplete;
    if (becameComplete) scheduleScrollToConfirmSection();
  }, [datosComplete, hasSlot, scheduleScrollToConfirmSection]);

  useEffect(() => {
    if (!hasSlot) return;
    const id = requestAnimationFrame(() => {
      dataSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [hasSlot, selectedTime]);

  async function submitTurno() {
    if (!primaryService || selectedServices.length === 0 || !selectedDate || !selectedTime || !datosComplete) {
      return;
    }
    setConfirmError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/panel/reservations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          treatmentId: primaryService.id,
          serviceIds: selectedServices.map((s) => s.id),
          dateKey: selectedDate,
          timeLocal: selectedTime,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          whatsappOptIn,
          panelNotes: panelNotes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok) {
        setConfirmError(data.error ?? "No se pudo guardar el turno.");
        return;
      }
      if (data.ok && data.id) {
        router.push("/panel-turnos");
        router.refresh();
      }
    } catch {
      setConfirmError("Sin conexión o error de red. Probá de nuevo.");
    } finally {
      setSubmitting(false);
      setSobreturnoOpen(false);
    }
  }

  function handleConfirmTurno() {
    if (!primaryService || selectedServices.length === 0 || !selectedDate || !selectedTime || !datosComplete) {
      return;
    }
    if (overCapacitySlots.includes(selectedTime)) {
      setSobreturnoOpen(true);
      return;
    }
    void submitTurno();
  }

  const bookingPickerProps = {
    bookingContext: "panel" as const,
    selectedTreatmentId,
    onTreatmentIdChange: (id: string) => {
      setSelectedTreatmentId(id);
      setSelectedTime("");
    },
    selectedDate,
    onDateChange: setSelectedDate,
    selectedTime,
    onTimeChange: setSelectedTime,
    remoteTimeSlots: selectedDate && selectedServiceIds.length > 0 ? (remoteSlots ?? null) : undefined,
    overCapacityTimes: selectedDate && selectedServiceIds.length > 0 ? overCapacitySlots : [],
    selectedCountLabel:
      selectedServices.length > 0
        ? `${selectedServices.length} servicio${selectedServices.length === 1 ? "" : "s"}`
        : undefined,
    selectedDurationLabel: selectedServices.length > 0 ? totalSelectedDurationLabel : undefined,
    summaryTitle: selectedServices.length > 0 ? selectedServicesSummary : undefined,
    bookingFocusRef,
    treatmentFirstHintVisible,
    onTreatmentFirstHintVisible: setTreatmentFirstHintVisible,
    monthAvailabilityServiceIds: selectedServiceIds,
    multiSelect: true as const,
    selectedTreatmentIds: selectedServiceIds,
    onToggleTreatmentId: (id: string) => {
      setSelectedServiceIds((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (isSoloComboTreatmentId(id) && prev.length > 0) {
          setServiceLimitHint("Este servicio no se puede combinar con otros en el mismo turno.");
          return prev;
        }
        if (prev.some((x) => isSoloComboTreatmentId(x))) {
          setServiceLimitHint("No podés agregar otro servicio porque ya elegiste uno que va solo en el turno.");
          return prev;
        }
        if (id !== "keratina" && prev.includes("keratina")) {
          setServiceLimitHint(
            "No podés agregar servicios después de Keratina. Si querés combinar, Keratina debe quedar al final.",
          );
          return prev;
        }
        if (prev.length >= 4) {
          setServiceLimitHint("Máximo 4 servicios por turno.");
          return prev;
        }
        return [...prev, id];
      });
      setSelectedTreatmentId(id);
      setSelectedTime("");
    },
    onClearTreatmentIds: () => {
      setSelectedServiceIds([]);
      setSelectedTreatmentId("");
      setSelectedTime("");
      setServiceSelectionConfirmed(false);
      setDateStepConfirmed(false);
    },
    comboHintText:
      "Podés elegir hasta 4 servicios. Alisado vegano, diseño mechas con papel, Balayage y Air Touch van solos en el turno.",
    comboDurationLabel: totalSelectedDurationLabel,
    comboAlertText: serviceLimitHint,
    variant: "light" as const,
    hideServiceSelector: true,
    openModalCategory,
    onOpenModalCategoryHandled: () => setOpenModalCategory(null),
    onServiceModalOpenChange: setServiceModalOpen,
    serviceModalDismissNonce,
    onConfirmServiceSelection: () => {
      setServiceSelectionConfirmed(true);
      setDateStepConfirmed(false);
    },
    dateStepConfirmed,
    onConfirmDateStep: () => {
      setDateStepConfirmed(true);
    },
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f8f6f2] pb-24 text-[#1c1b1b]">
      <header className="sticky top-0 z-40 flex w-full flex-col items-center justify-center bg-[#f8f6f2]/90 px-6 pt-8 backdrop-blur-md">
        <div className="flex w-full max-w-md items-center justify-between">
          <button
            type="button"
            onClick={handleBookingBack}
            aria-label={bookingFlowBackAriaLabel(bookingBackAction, { exitLabel: "Volver al panel" })}
            className="-ml-2 cursor-pointer p-2 text-[#1c1b1b] transition-transform active:scale-95"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <h1 className="font-heading text-[28px] leading-9 font-semibold tracking-widest uppercase">
            Nuevo turno
          </h1>
          <span className="w-10" aria-hidden />
        </div>

        <div className="mt-6 flex max-w-md flex-col items-center gap-2">
          <span className="text-xs font-bold tracking-[0.1em] text-[var(--premium-gold-light)] uppercase">
            Paso {bookingHeaderStep} de 3
          </span>
          <div className="flex gap-2">
            {[1, 2, 3].map((step) => (
              <div
                key={step}
                className={`h-1 w-8 rounded-full ${
                  step <= bookingHeaderStep ? "bg-[var(--premium-gold-light)]" : "bg-[var(--outline)]/30"
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-sm text-[#7f7c7a]">{bookingStepHint}</p>
          <p className="text-center text-[11px] text-[#7f7c7a]">Alta manual · sin pago</p>
        </div>
      </header>

      <main className="mx-auto mt-8 w-full max-w-md px-6">
        {showCategoryStep ? (
          <BookingCategoryStep
            onSelectCategory={handleSelectCategory}
            selectedServiceIds={selectedServiceIds}
            selectedDurationLabel={totalSelectedDurationLabel}
            onClearSelection={() => {
              setSelectedServiceIds([]);
              setSelectedTreatmentId("");
              setSelectedTime("");
              setServiceSelectionConfirmed(false);
              setDateStepConfirmed(false);
            }}
            onContinue={() => {
              if (selectedServiceIds.length === 0) return;
              setServiceSelectionConfirmed(true);
              setDateStepConfirmed(false);
            }}
          />
        ) : null}

        <BookingPicker
          {...bookingPickerProps}
          displayMode={serviceSelectionConfirmed ? "full" : "modal-only"}
        />

        {serviceSelectionConfirmed && hasSlot ? (
          <div ref={dataSectionRef} className="mt-6 space-y-5">
            <section
              className={`${lightCard} px-4 py-4 transition-all ${activeStep === 4 ? lightCardActive : ""}`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] tracking-[0.14em] text-[#7f7c7a]">Paso 4</p>
                  <p className="mt-1 font-heading text-[18px] text-[#1c1b1b]">Datos del cliente</p>
                  <p className="mt-1 text-[12px] text-[#7f7c7a]">
                    Completá nombre y WhatsApp para recordatorios.
                  </p>
                  {activeStep === 4 && (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--premium-gold-light)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--premium-gold-light)]" />
                      <span>Necesitamos estos datos antes de confirmar</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label htmlFor="pn-customerName" className="text-[11px] tracking-[0.12em] text-[#7f7c7a]">
                    Nombre y apellido
                  </label>
                  <input
                    id="pn-customerName"
                    name="customerName"
                    autoComplete="name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Como figura en el DNI o preferís que la llamemos"
                    className="mt-1.5 w-full rounded-xl border border-[var(--outline)]/15 bg-[#faf8f4] px-3 py-3 text-[15px] text-[#1c1b1b] outline-none placeholder:text-[#7f7c7a]/60 focus:border-[var(--premium-gold-light)]/55"
                  />
                </div>
                <div>
                  <label htmlFor="pn-customerPhone" className="text-[11px] tracking-[0.12em] text-[#7f7c7a]">
                    WhatsApp
                  </label>
                  <input
                    id="pn-customerPhone"
                    name="customerPhone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    onBlur={() => {
                      const nameOk = customerName.trim().length >= 2;
                      const phoneOk = isLikelyWhatsappNumber(customerPhone);
                      if (hasSlot && nameOk && phoneOk && whatsappOptIn) {
                        scheduleScrollToConfirmSection();
                      }
                    }}
                    placeholder="Ej: +54 9 11 2345-6789"
                    aria-invalid={showWhatsappInvalidHint}
                    className={`mt-1.5 w-full rounded-xl border bg-[#faf8f4] px-3 py-3 text-[15px] text-[#1c1b1b] outline-none placeholder:text-[#7f7c7a]/60 focus:border-[var(--premium-gold-light)]/55 ${
                      showWhatsappInvalidHint ? "border-amber-500/45" : "border-[var(--outline)]/15"
                    }`}
                  />
                  <p className="mt-1 text-[11px] text-[#7f7c7a]">Mismo número que usa en WhatsApp.</p>
                  {showWhatsappInvalidHint ? (
                    <p className="mt-1 text-[11px] leading-snug text-amber-700">
                      Revisá el número: tiene que tener entre 10 y 15 dígitos en total (podés usar +54, espacios o
                      guiones).
                    </p>
                  ) : null}
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--outline)]/10 bg-[#faf8f4] px-3 py-3">
                  <input
                    type="checkbox"
                    checked={whatsappOptIn}
                    onChange={(e) => setWhatsappOptIn(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--outline)]/20 accent-[var(--premium-gold-light)]"
                  />
                  <span className="text-[12px] leading-snug text-[#7f7c7a]">
                    Acepto recibir recordatorios y avisos del turno por WhatsApp.
                  </span>
                </label>
                <div>
                  <label htmlFor="pn-notes" className={panelLabel}>
                    Notas internas (opcional)
                  </label>
                  <textarea
                    id="pn-notes"
                    name="panelNotes"
                    rows={3}
                    value={panelNotes}
                    onChange={(e) => setPanelNotes(e.target.value)}
                    placeholder="Solo visible en el sistema…"
                    className={`${panelInput} resize-none text-[14px]`}
                  />
                </div>
              </div>
            </section>

            <section
              ref={confirmSectionRef}
              className={`${lightCard} px-4 py-4 transition-all ${activeStep === 5 ? lightCardActive : ""}`}
            >
              <p className="text-[11px] tracking-[0.14em] text-[#7f7c7a]">Paso 5</p>
              <p className="mt-1 font-heading text-[18px] text-[#1c1b1b]">Confirmar turno</p>
              <p className="mt-1 text-[12px] text-[#7f7c7a]">
                Turno el {formatSalonDisplayDate(selectedDate)} a las {selectedTime}
                {selectedServices.length > 1
                  ? ` · ${selectedServices.length} servicios combinados`
                  : primaryService
                    ? ` · ${primaryService.name}`
                    : ""}
              </p>
              {activeStep === 5 && datosComplete && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--premium-gold-light)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--premium-gold-light)]" />
                  <span>Confirmá para agendar el turno</span>
                </div>
              )}
              {selectedTime && overCapacitySlots.includes(selectedTime) ? (
                <p
                  role="status"
                  className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] leading-snug text-amber-900"
                >
                  Este horario ya tiene otra clienta. Podés cargar el sobreturno igual.
                </p>
              ) : null}
              <p className="mt-3 text-[11px] leading-snug text-[#7f7c7a]">
                Alta manual desde el panel. Podés cambiar fecha u horario arriba si necesitás otro servicio.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  disabled={!datosComplete || submitting}
                  onClick={() => void handleConfirmTurno()}
                  className={`${panelPrimaryBtn} rounded-xl ${
                    datosComplete && !submitting
                      ? "bg-[var(--premium-gold-light)] text-[var(--on-accent)] shadow-[0_8px_24px_rgba(125,163,196,0.28)]"
                      : ""
                  } ${submitting ? "cursor-wait" : ""}`}
                >
                  {submitting ? "Guardando…" : "Confirmar turno"}
                </button>
              </div>
              {confirmError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-xl border border-red-500/35 bg-red-50 px-3 py-2.5 text-center text-[12px] leading-snug text-red-700"
                >
                  {confirmError}
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </main>
      <PanelSobreturnoConfirm
        open={sobreturnoOpen}
        detail={`Este horario (${selectedTime}) ya tiene otra clienta. Podés cargar el sobreturno igual.`}
        busy={submitting}
        onCancel={() => setSobreturnoOpen(false)}
        onConfirm={() => void submitTurno()}
      />
    </div>
  );
}
