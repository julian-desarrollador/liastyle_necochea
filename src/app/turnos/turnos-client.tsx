"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppBottomNav } from "@/components/app-bottom-nav";
import { BookingCategoryStep } from "@/components/booking/booking-category-step";
import { BookingPicker } from "@/components/booking/booking-picker";
import { event as gaEvent } from "@/lib/gtag";
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
import { treatmentRequiresPublicDeposit } from "@/lib/reservations/public-deposit";
import { DepositCancelPolicyNotice } from "@/components/deposit-cancel-policy-notice";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";
import type { TreatmentCategory } from "@/lib/treatments/catalog";
import { formatArs, summarizeDepositForTreatments } from "@/lib/treatments/deposit";

type TurnosClientProps = {
  initialTreatment?: string;
};

type MeReservationsResponse = {
  reservations?: Array<{
    customerName?: string;
    customerPhone?: string;
    startsAtIso?: string;
  }>;
};
const CUSTOMER_PROFILE_CACHE_KEY = "mp_customer_profile_cache";

export default function TurnosClient({ initialTreatment = "" }: TurnosClientProps) {
  const router = useRouter();
  const treatmentParam = (() => {
    try {
      return decodeURIComponent(initialTreatment.trim());
    } catch {
      return initialTreatment.trim();
    }
  })();
  const initialMatch = SALON_TREATMENT_OPTIONS.find(
    (option) => option.id === treatmentParam || option.name === treatmentParam,
  );

  const [selectedTreatmentId, setSelectedTreatmentId] = useState<string>(initialMatch?.id ?? "");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(initialMatch ? [initialMatch.id] : []);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [serviceLimitHint, setServiceLimitHint] = useState<string | null>(null);
  const [treatmentFirstHintVisible, setTreatmentFirstHintVisible] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [depositExempt, setDepositExempt] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"unknown" | "guest" | "authed">("unknown");
  const [sessionDisplayName, setSessionDisplayName] = useState<string | null>(null);
  /** Horarios con solapes resueltos en servidor; `undefined` = no aplica, `null` = cargando. */
  const [remoteSlots, setRemoteSlots] = useState<string[] | null | undefined>(undefined);
  const bookingFocusRef = useRef<HTMLDivElement | null>(null);
  const dataSectionRef = useRef<HTMLDivElement | null>(null);
  const paymentSectionRef = useRef<HTMLElement | null>(null);
  const scrollPaymentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDatosCompleteRef = useRef(false);
  const [openModalCategory, setOpenModalCategory] = useState<TreatmentCategory | null>(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceModalDismissNonce, setServiceModalDismissNonce] = useState(0);
  const [serviceSelectionConfirmed, setServiceSelectionConfirmed] = useState(Boolean(initialMatch));
  const [dateStepConfirmed, setDateStepConfirmed] = useState(false);

  const handleSelectCategory = useCallback((category: TreatmentCategory) => {
    setOpenModalCategory(category);
  }, []);

  const selectedTreatment = useMemo(
    () => SALON_TREATMENT_OPTIONS.find((option) => option.id === selectedTreatmentId),
    [selectedTreatmentId],
  );
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
  const depositSummary = useMemo(() => {
    const treatments = selectedServiceIds
      .map((id) => findSalonTreatmentById(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (treatments.length === 0) return null;
    return summarizeDepositForTreatments(treatments);
  }, [selectedServiceIds]);
  const primaryService = selectedServices[0];
  const treatmentNeedsDeposit = selectedServices.some((s) => treatmentRequiresPublicDeposit(s.id));
  const requiresDeposit = treatmentNeedsDeposit && !depositExempt;

  const hasSlot = Boolean(selectedServices.length > 0 && selectedDate && selectedTime);
  const datosComplete = Boolean(
    customerName.trim().length >= 2 &&
      isLikelyWhatsappNumber(customerPhone) &&
      whatsappOptIn,
  );
  const showWhatsappInvalidHint =
    customerPhone.trim().length >= 8 && !isLikelyWhatsappNumber(customerPhone);
  const hasSessionProfile = sessionStatus === "authed" && customerName.trim().length >= 2 && isLikelyWhatsappNumber(customerPhone);
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
        router.push("/");
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
  const sessionBootstrappedRef = useRef(false);

  useEffect(() => {
    if (!selectedDate) setDateStepConfirmed(false);
  }, [selectedDate]);

  useEffect(() => {
    if (!isLikelyWhatsappNumber(customerPhone)) {
      setDepositExempt(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/reservations/deposit-status?phone=${encodeURIComponent(customerPhone.trim())}`,
            { cache: "no-store" },
          );
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as { depositExempt?: boolean };
          if (!cancelled) setDepositExempt(Boolean(data.depositExempt));
        } catch {
          if (!cancelled) setDepositExempt(false);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [customerPhone]);

  useEffect(() => {
    if (!dateStepConfirmed) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }, [dateStepConfirmed]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOMER_PROFILE_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as { name?: string; phone?: string };
      const cachedName = String(cached.name ?? "").trim();
      const cachedPhone = String(cached.phone ?? "").trim();
      if (cachedName) {
        setSessionDisplayName(cachedName);
        if (customerName.trim().length < 2) setCustomerName(cachedName);
        setSessionStatus("authed");
      }
      if (cachedPhone && !isLikelyWhatsappNumber(customerPhone)) {
        setCustomerPhone(cachedPhone);
      }
    } catch {
      // ignore invalid local cache
    }
  }, []);

  useEffect(() => {
    if (sessionBootstrappedRef.current) return;
    sessionBootstrappedRef.current = true;
    let cancelled = false;
    let retryTimer: number | null = null;
    const applyProfileFromReservations = (rows: MeReservationsResponse["reservations"]) => {
      const list = Array.isArray(rows) ? rows : [];
      const latest = [...list]
        .sort((a, b) => String(b.startsAtIso ?? "").localeCompare(String(a.startsAtIso ?? "")))[0];
      if (latest?.customerName && customerName.trim().length < 2) {
        setCustomerName(latest.customerName.trim());
      }
      if (latest?.customerPhone && !isLikelyWhatsappNumber(customerPhone)) {
        setCustomerPhone(latest.customerPhone.trim());
      }
      const n = latest?.customerName?.trim();
      setSessionDisplayName(n && n.length >= 2 ? n : null);
      setSessionStatus("authed");
      try {
        localStorage.setItem(
          CUSTOMER_PROFILE_CACHE_KEY,
          JSON.stringify({
            name: latest?.customerName?.trim() ?? "",
            phone: latest?.customerPhone?.trim() ?? "",
          }),
        );
      } catch {
        // ignore localStorage failures
      }
    };

    const run = async (attempt: number) => {
      try {
        const res = await fetch("/api/me/reservations?source=turnos", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 401) {
          if (attempt < 5) {
            retryTimer = window.setTimeout(() => {
              if (!cancelled) void run(attempt + 1);
            }, 450);
            return;
          }
          setSessionStatus("guest");
          setSessionDisplayName(null);
          return;
        }
        if (!res.ok) {
          setSessionStatus("guest");
          setSessionDisplayName(null);
          return;
        }
        const data = (await res.json()) as MeReservationsResponse;
        applyProfileFromReservations(data.reservations);
      } catch {
        if (!cancelled) setSessionStatus("guest");
      }
    };

    (async () => {
      await run(1);
    })();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, []);

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
      return;
    }
    let cancelled = false;
    setRemoteSlots(null);
    const q = new URLSearchParams({
      dateKey: selectedDate,
      treatmentId: selectedServiceIds[0] ?? "",
      serviceIds: selectedServiceIds.join(","),
      scope: "public",
    });
    fetch(`/api/booking/slots?${q.toString()}`)
      .then((res) => res.json())
      .then((data: { slots?: string[] }) => {
        if (!cancelled) {
          setRemoteSlots(Array.isArray(data.slots) ? data.slots : []);
        }
      })
      .catch(() => {
        if (!cancelled) setRemoteSlots([]);
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
    }
  }, [selectedDate, selectedTime, selectedServiceIds, remoteSlots]);

  useEffect(() => {
    if (!serviceLimitHint) return;
    const t = window.setTimeout(() => setServiceLimitHint(null), 3200);
    return () => window.clearTimeout(t);
  }, [serviceLimitHint]);

  const scheduleScrollToPaymentSection = useCallback(() => {
    if (!hasSlot) return;
    if (scrollPaymentTimeoutRef.current) clearTimeout(scrollPaymentTimeoutRef.current);
    scrollPaymentTimeoutRef.current = setTimeout(() => {
      scrollPaymentTimeoutRef.current = null;
      paymentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  }, [hasSlot]);

  useEffect(() => {
    return () => {
      if (scrollPaymentTimeoutRef.current) clearTimeout(scrollPaymentTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasSlot) {
      prevDatosCompleteRef.current = datosComplete;
      return;
    }
    const becameComplete = datosComplete && !prevDatosCompleteRef.current;
    prevDatosCompleteRef.current = datosComplete;
    if (becameComplete) scheduleScrollToPaymentSection();
  }, [datosComplete, hasSlot, scheduleScrollToPaymentSection]);

  useEffect(() => {
    if (!hasSlot) return;
    const id = requestAnimationFrame(() => {
      dataSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [hasSlot, selectedTime]);

  const handleConfirmReservation = async () => {
    if (!primaryService || selectedServices.length === 0 || !selectedDate || !selectedTime || !datosComplete) {
      return;
    }
    setConfirmError(null);
    setCheckoutLoading(true);
    try {
      const pendingBody = {
        treatmentId: primaryService.id,
        treatmentName: selectedServicesSummary,
        subtitle: `${selectedServices.length} servicio${selectedServices.length === 1 ? "" : "s"} combinados`,
        category: primaryService.category,
        serviceIds: selectedServices.map((s) => s.id),
        dateKey: selectedDate,
        timeLocal: selectedTime,
        displayDate: formatSalonDisplayDate(selectedDate),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        whatsappOptIn,
      };
      const resPending = await fetch("/api/reservations/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingBody),
      });
      const dataPending = (await resPending.json()) as {
        error?: string;
        id?: string;
        checkoutToken?: string;
        bookingMode?: "pending_payment" | "confirmed";
      };
      if (!resPending.ok) {
        setConfirmError(dataPending.error ?? "No se pudo reservar el turno.");
        return;
      }
      if (!dataPending.id) {
        setConfirmError("Respuesta inválida del servidor.");
        return;
      }

      // Sin seña online: confirmación directa.
      if (dataPending.bookingMode === "confirmed") {
        gaEvent("reservation_confirmed_no_deposit", {
          treatment_id: primaryService.id,
          treatment_name: selectedServicesSummary,
          date_key: selectedDate,
          time_local: selectedTime,
        });
        const qs = new URLSearchParams({
          treatment: selectedServicesSummary,
          subtitle: `${selectedServices.length} servicio${selectedServices.length === 1 ? "" : "s"} combinados`,
          date: formatSalonDisplayDate(selectedDate),
          time: selectedTime,
          name: customerName.trim(),
          phone: customerPhone.trim(),
          id: dataPending.id,
        });
        window.location.href = `/turnos/confirmado?${qs.toString()}`;
        return;
      }

      if (!dataPending.checkoutToken) {
        setConfirmError("Respuesta inválida del servidor.");
        return;
      }

      const resPref = await fetch("/api/mercadopago/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: dataPending.id,
          checkoutToken: dataPending.checkoutToken,
        }),
      });
      const dataPref = (await resPref.json()) as { error?: string; initPoint?: string };
      if (!resPref.ok) {
        setConfirmError(dataPref.error ?? "No se pudo iniciar Mercado Pago.");
        return;
      }
      if (!dataPref.initPoint) {
        setConfirmError("Mercado Pago no devolvió el enlace de pago.");
        return;
      }

      const snapshot = {
        treatment: selectedServicesSummary,
        subtitle: `${selectedServices.length} servicio${selectedServices.length === 1 ? "" : "s"} combinados`,
        date: formatSalonDisplayDate(selectedDate),
        time: selectedTime,
        name: customerName.trim(),
        phone: customerPhone.trim(),
        id: dataPending.id,
      };
      sessionStorage.setItem("mp_turno_snapshot", JSON.stringify(snapshot));
      gaEvent("reservation_checkout_start", {
        treatment_id: primaryService.id,
        treatment_name: selectedServicesSummary,
        date_key: selectedDate,
        time_local: selectedTime,
      });
      window.location.href = dataPref.initPoint;
    } catch {
      setConfirmError("Sin conexión o error de red. Probá de nuevo.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const bookingPickerProps = {
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
        if (id === "servicio-completo" && prev.length > 0) {
          setServiceLimitHint("No podés seleccionar Servicio completo porque ya elegiste otros servicios.");
          return prev;
        }
        if (prev.includes("servicio-completo")) {
          setServiceLimitHint("No podés agregar otro servicio porque ya seleccionaste Servicio completo.");
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
      setSelectedTime("");
    },
    onClearTreatmentIds: () => {
      setSelectedServiceIds([]);
      setSelectedTreatmentId("");
      setSelectedTime("");
      setServiceSelectionConfirmed(false);
      setDateStepConfirmed(false);
    },
    comboHintText: "Podés elegir hasta 4 servicios. Servicio completo va solo y Keratina debe quedar al final.",
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
    <div className="min-h-screen overflow-x-hidden bg-[#f8f6f2] pb-32 text-[#1c1b1b]">
      <header className="sticky top-0 z-40 flex w-full flex-col items-center justify-center bg-[#f8f6f2]/90 px-6 pt-8 backdrop-blur-md">
        <div className="flex w-full max-w-md items-center justify-between">
          <button
            type="button"
            onClick={handleBookingBack}
            aria-label={bookingFlowBackAriaLabel(bookingBackAction)}
            className="-ml-2 cursor-pointer p-2 text-[#1c1b1b] transition-transform active:scale-95"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <h1 className="font-heading text-[28px] leading-9 font-semibold tracking-widest uppercase">
            Reservar turno
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
          <p className="mt-3 text-center text-xl leading-snug font-medium text-[#3f3c3a]">{bookingStepHint}</p>
        </div>

        {sessionStatus === "authed" && sessionDisplayName ? (
          <p className="mt-3 text-center text-2xl text-[#3f3c3a]">
            Hola, <span className="font-semibold text-[var(--premium-gold-light)]">{sessionDisplayName}</span>
          </p>
        ) : null}
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
                {!hasSessionProfile ? (
                  <section
                    className={`${lightCard} px-4 py-4 transition-all ${
                      activeStep === 4 ? lightCardActive : ""
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] tracking-[0.14em] text-[#7f7c7a]">Paso 4</p>
                        <p className="mt-1 font-heading text-[18px] text-[#1c1b1b]">Tus datos</p>
                        <p className="mt-1 text-[12px] text-[#7f7c7a]">
                          Completá tu nombre y WhatsApp para recordatorios.
                        </p>
                        {activeStep === 4 && (
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--premium-gold-light)]">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--premium-gold-light)]" />
                            <span>Necesitamos estos datos antes del pago</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="customerName" className="text-[11px] tracking-[0.12em] text-[#7f7c7a]">
                          Nombre y apellido
                        </label>
                        <input
                          id="customerName"
                          name="customerName"
                          autoComplete="name"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Como figura en tu DNI o preferís que te llamemos"
                          className="mt-1.5 w-full rounded-xl border border-[var(--outline)]/15 bg-[#faf8f4] px-3 py-3 text-[15px] text-[#1c1b1b] outline-none placeholder:text-[#7f7c7a]/60 focus:border-[var(--premium-gold-light)]/55"
                        />
                      </div>
                      <div>
                        <label htmlFor="customerPhone" className="text-[11px] tracking-[0.12em] text-[#7f7c7a]">
                          WhatsApp
                        </label>
                        <input
                          id="customerPhone"
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
                              scheduleScrollToPaymentSection();
                            }
                          }}
                          placeholder="Ej: +54 9 11 2345-6789"
                          aria-invalid={showWhatsappInvalidHint}
                          className={`mt-1.5 w-full rounded-xl border bg-[#faf8f4] px-3 py-3 text-[15px] text-[#1c1b1b] outline-none placeholder:text-[#7f7c7a]/60 focus:border-[var(--premium-gold-light)]/55 ${
                            showWhatsappInvalidHint ? "border-amber-500/45" : "border-[var(--outline)]/15"
                          }`}
                        />
                        <p className="mt-1 text-[11px] text-[#7f7c7a]">Mismo número que usás en WhatsApp.</p>
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
                          Acepto recibir recordatorios y avisos de mi turno por WhatsApp.
                        </span>
                      </label>
                    </div>
                  </section>
                ) : (
                  <section className="rounded-2xl border border-emerald-500/25 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                    Usaremos tus datos guardados para confirmar el turno.
                  </section>
                )}

                <section
                  ref={paymentSectionRef}
                  className={`${lightCard} px-4 py-4 transition-all ${activeStep === 5 ? lightCardActive : ""}`}
                >
                  <p className="text-[11px] tracking-[0.14em] text-[#7f7c7a]">Paso 5</p>
                  <p className="mt-1 font-heading text-[18px] text-[#1c1b1b]">
                    {requiresDeposit ? "Pagar con Mercado Pago" : "Confirmar turno"}
                  </p>
                  <p className="mt-1 text-[12px] text-[#7f7c7a]">
                    {requiresDeposit
                      ? "Para reservar el horario abonás una seña del 20% con débito en Mercado Pago. El turno se confirma al acreditar el pago."
                      : depositExempt && treatmentNeedsDeposit
                        ? "Como clienta preferencial no abonás seña online. Al confirmar, el turno queda agendado."
                        : "Este servicio se reserva sin pago online. Te enviamos recordatorio por WhatsApp antes del turno."}
                  </p>
                  {requiresDeposit && depositSummary && depositSummary.depositAmountArs > 0 ? (
                    <div className="mt-3 rounded-xl border border-[var(--premium-gold-light)]/25 bg-[var(--premium-gold-light)]/8 px-3 py-3">
                      <p className="text-[10px] font-bold tracking-[0.12em] text-[var(--premium-gold-light)] uppercase">
                        Seña a pagar (20%)
                      </p>
                      <p className="mt-1 font-heading text-[22px] font-semibold text-[#1c1b1b]">
                        {depositSummary.priceIsFrom ? "Desde " : ""}
                        {formatArs(depositSummary.depositAmountArs)}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-[#7f7c7a]">
                        Te redirigimos a Mercado Pago para abonar la seña con débito
                        {depositSummary.priceIsFrom ? " (sobre el valor desde indicado)" : ""}
                        . El resto se abona en el salón.
                      </p>
                    </div>
                  ) : null}
                  {requiresDeposit ? <DepositCancelPolicyNotice className="mt-3" /> : null}
                  {activeStep === 5 && datosComplete ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--premium-gold-light)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--premium-gold-light)]" />
                      <span>
                        {requiresDeposit
                          ? "Pagá la seña: te llevamos a Mercado Pago"
                          : "Confirmá para agendar tu turno"}
                      </span>
                    </div>
                  ) : null}
                  {requiresDeposit ? (
                    <p className="mt-3 text-[11px] leading-snug text-[#7f7c7a]">
                      El turno se confirma cuando Mercado Pago acredita el pago (no al volver del navegador).
                    </p>
                  ) : (
                    <p className="mt-3 text-[11px] leading-snug text-[#7f7c7a]">
                      Al confirmar, el turno queda agendado. Podés cambiar fecha u horario arriba si necesitás otro
                      servicio.
                    </p>
                  )}
                  <div className="mt-4">
                    <button
                      type="button"
                      disabled={!datosComplete || checkoutLoading}
                      onClick={() => void handleConfirmReservation()}
                      className={`flex h-[52px] w-full items-center justify-center rounded-xl text-[16px] font-semibold transition-all ${
                        datosComplete && !checkoutLoading
                          ? requiresDeposit
                            ? "cursor-pointer bg-[#009EE3] text-white shadow-[0_8px_24px_rgba(0,158,227,0.35)]"
                            : "cursor-pointer bg-[var(--premium-gold-light)] text-[var(--on-accent)] shadow-[0_8px_24px_rgba(125,163,196,0.28)]"
                          : "cursor-not-allowed bg-[#e5e2e1] text-[#7f7c7a]"
                      } ${checkoutLoading ? "cursor-wait" : ""}`}
                    >
                      <span className="text-[13px] font-medium opacity-95">
                        {checkoutLoading
                          ? requiresDeposit
                            ? "Preparando pago…"
                            : "Confirmando…"
                          : requiresDeposit
                            ? "Pagar con Mercado Pago"
                            : "Confirmar reserva"}
                      </span>
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

      <AppBottomNav active="turnos" />
    </div>
  );
}

