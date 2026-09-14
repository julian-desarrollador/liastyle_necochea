"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { perfilBackBtn, perfilCard, perfilFabBtn, perfilPrimaryBtn } from "@/components/perfil/perfil-ui";
import { usePerfilSession } from "@/components/perfil/perfil-session-provider";
import { DepositCancelPolicyNotice } from "@/components/deposit-cancel-policy-notice";
import type { CustomerReservationPublic } from "@/lib/reservations/customer-public-serialize";
import { isUpcomingReservation } from "@/lib/reservations/customer-public-serialize";
import { reservationStatusLabel } from "@/lib/reservations/customer-ui-copy";
import {
  canCustomerCancelByStartsAt,
  CUSTOMER_CANCEL_CONFIRM_HINT,
  CUSTOMER_CANCEL_TOO_LATE_MESSAGE,
} from "@/lib/reservations/cancel-policy";

function formatDayMonthFromKey(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return dateKey;
  return `${m[3]}/${m[2]}`;
}

export function MisTurnosClient() {
  const { me, reservations: ctxReservations, reload: ctxReload } = usePerfilSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<CustomerReservationPublic[] | null>(ctxReservations);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (ctxReservations !== null) setRows(ctxReservations);
  }, [ctxReservations]);

  useEffect(() => {
    if (me === "guest") {
      setError("Iniciá sesión desde Perfil con tu WhatsApp.");
      setRows([]);
    }
  }, [me]);

  useEffect(() => {
    if (!successMessage) return;
    const t = window.setTimeout(() => setSuccessMessage(null), 4500);
    return () => window.clearTimeout(t);
  }, [successMessage]);

  useEffect(() => {
    if (searchParams.get("rescheduled") !== "1") return;
    router.replace("/perfil/mis-turnos", { scroll: false });
    void ctxReload().then(() => {
      setSuccessMessage("¡Turno reprogramado con éxito!");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upcoming = useMemo(
    () => (rows ?? []).filter((r) => isUpcomingReservation(r)).sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso)),
    [rows],
  );
  const past = useMemo(
    () => (rows ?? []).filter((r) => !isUpcomingReservation(r)).sort((a, b) => b.startsAtIso.localeCompare(a.startsAtIso)),
    [rows],
  );

  const list = tab === "upcoming" ? upcoming : past;

  const handleCancelReservation = useCallback(
    async (reservationId: string) => {
      setCancellingId(reservationId);
      setError(null);
      setSuccessMessage(null);
      try {
        const res = await fetch(`/api/me/reservations/${encodeURIComponent(reservationId)}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "No se pudo cancelar el turno.");
          return;
        }
        // Actualización inmediata en UI; después sincronizamos con el servidor.
        setRows((prev) =>
          (prev ?? []).map((r) =>
            r.id === reservationId
              ? { ...r, reservationStatus: "cancelled" as const, cancelledBy: "customer" as const }
              : r,
          ),
        );
        setCancelConfirmId(null);
        setSuccessMessage("Turno cancelado con éxito.");
        void ctxReload().then(() => {
          // ctxReservations refresca rows vía effect
        });
      } catch {
        setError("Sin conexión.");
      } finally {
        setCancellingId(null);
      }
    },
    [ctxReload],
  );

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-8 pb-28">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/perfil" className={perfilBackBtn} aria-label="Volver al perfil">
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </Link>
        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight text-gray-900">Mis turnos</h1>
          <p className="mt-0.5 text-[16px] text-gray-500">Próximos y pasados</p>
        </div>
      </header>

      {tab === "upcoming" ? <DepositCancelPolicyNotice variant="subtle" className="mb-4" /> : null}

      <div className="mb-5 flex rounded-2xl border border-gray-200 bg-[#F5F5F5] p-1">
        <button
          type="button"
          onClick={() => setTab("upcoming")}
          className={`flex-1 cursor-pointer rounded-xl py-3 text-[15px] font-semibold transition ${
            tab === "upcoming" ? "bg-[#7da3c4] text-white shadow-sm" : "text-gray-600 hover:bg-white/80"
          }`}
        >
          Próximos ({upcoming.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("past")}
          className={`flex-1 cursor-pointer rounded-xl py-3 text-[15px] font-semibold transition ${
            tab === "past" ? "bg-[#7da3c4] text-white shadow-sm" : "text-gray-600 hover:bg-white/80"
          }`}
        >
          Pasados ({past.length})
        </button>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[16px] text-amber-900">
          {error}{" "}
          <Link href="/perfil#acceso" className="font-semibold text-[#7da3c4] underline-offset-2 hover:underline">
            Ir a acceso
          </Link>
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[16px] text-emerald-900">
          {successMessage}
        </p>
      ) : null}

      {rows === null ? (
        <p className="py-10 text-center text-[16px] text-gray-500">Cargando…</p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10">
          <p className="text-[16px] text-gray-500">
            {tab === "upcoming" ? "No tenés turnos próximos." : "No hay turnos pasados para mostrar."}
          </p>
          {tab === "upcoming" ? (
            <Link href="/turnos" className={`${perfilPrimaryBtn} h-12 w-auto px-6`}>
              Reservar nuevo turno
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-4">
          {list.map((r) => {
            const canCancel =
              tab === "upcoming" &&
              (r.reservationStatus === "confirmed" || r.reservationStatus === "pending_payment") &&
              canCustomerCancelByStartsAt(r.startsAtIso);
            const showActions =
              tab === "upcoming" &&
              (r.reservationStatus === "confirmed" || r.reservationStatus === "pending_payment");
            const tooLateToCancel =
              showActions && !canCustomerCancelByStartsAt(r.startsAtIso);

            return (
              <li key={r.id} className={`${perfilCard} px-5 py-5`}>
                <p className="text-[18px] font-semibold leading-tight text-gray-900">
                  <span className="text-[#7da3c4]">
                    {r.timeLocal}
                    <span className="ml-1 text-[15px] font-medium text-[#7da3c4]/80">hs</span>
                  </span>
                  <span className="text-gray-700"> · {formatDayMonthFromKey(r.dateKey)}</span>
                </p>
                <p className="mt-1 text-[15px] text-gray-500">{r.displayDate}</p>
                <p className="mt-3 text-[17px] font-semibold text-gray-900">{r.treatmentName}</p>
                <p className="mt-0.5 text-[15px] text-gray-500">{r.subtitle}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#F5F5F5] px-3 py-1 text-[13px] font-medium text-gray-700">
                    {reservationStatusLabel(r.reservationStatus)}
                  </span>
                  {r.source === "panel" ? (
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-[13px] font-semibold text-sky-800">
                      Cargado en salón
                    </span>
                  ) : null}
                </div>
                {r.reservationStatus === "cancelled" && r.cancelledBy === "system" ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] leading-snug text-amber-900">
                    {r.paymentStatus === "refunded"
                      ? "Ese horario ya no estaba disponible. Te devolvimos la seña."
                      : "Ese horario ya no estaba disponible. La seña se está devolviendo."}
                  </p>
                ) : null}
                {r.reservationStatus === "cancelled" && r.cancelledBy === "panel" ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] leading-snug text-amber-900">
                    Este turno fue cancelado desde el panel del salón.
                  </p>
                ) : null}
                {r.reservationStatus === "cancelled" && r.cancelledBy === "customer" ? (
                  <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] leading-snug text-emerald-900">
                    Cancelaste este turno.
                  </p>
                ) : null}
                {r.reservationStatus === "cancelled" && !r.cancelledBy ? (
                  <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] leading-snug text-gray-700">
                    Este turno está cancelado.
                  </p>
                ) : null}
                {showActions ? (
                  <div className="mt-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/perfil/mis-turnos/${encodeURIComponent(r.id)}/reprogramar`}
                        className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-[#7da3c4] bg-[#7da3c4]/10 px-4 text-[14px] font-semibold text-[#5f7a8f] transition hover:bg-[#7da3c4]/18"
                      >
                        Cambiar horario
                      </Link>
                      {canCancel ? (
                        <button
                          type="button"
                          disabled={cancellingId === r.id}
                          onClick={() => setCancelConfirmId(r.id)}
                          className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-red-200 bg-red-50 px-4 text-[14px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {cancellingId === r.id ? "Cancelando..." : "Cancelar turno"}
                        </button>
                      ) : null}
                    </div>
                    {tooLateToCancel ? (
                      <p className="text-[13px] leading-snug text-amber-800">
                        {CUSTOMER_CANCEL_TOO_LATE_MESSAGE}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {me === "authed" && list.length > 0 ? (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2">
          <Link href="/turnos" className={perfilFabBtn}>
            + Reservar turno
          </Link>
        </div>
      ) : null}

      {cancelConfirmId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => {
            if (cancellingId !== cancelConfirmId) {
              setCancelConfirmId(null);
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border border-gray-100 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading text-2xl font-bold text-gray-900">Cancelar turno</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-gray-600">
              ¿Estás seguro que deseás cancelar este turno? Esta acción no se puede deshacer.
            </p>
            <p className="mt-3 text-[14px] leading-snug text-[#5c5856]">{CUSTOMER_CANCEL_CONFIRM_HINT}</p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCancelConfirmId(null)}
                disabled={cancellingId === cancelConfirmId}
                className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-[15px] font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = cancelConfirmId;
                  if (!id) return;
                  await handleCancelReservation(id);
                }}
                disabled={cancellingId === cancelConfirmId}
                className="inline-flex h-10 items-center rounded-xl border border-red-200 bg-red-50 px-4 text-[15px] font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
              >
                {cancellingId === cancelConfirmId ? "Cancelando..." : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
