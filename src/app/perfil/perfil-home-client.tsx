"use client";

import { CalendarDays, Check, ChevronRight, Clock3, Percent, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MisDatosUpdateAnnouncement } from "@/components/announcements/mis-datos-update-announcement";
import { perfilPrimaryBtn } from "@/components/perfil/perfil-ui";
import { usePerfilSession } from "@/components/perfil/perfil-session-provider";
import { isLikelyWhatsappNumber } from "@/lib/booking/salon-availability";
import { event as gaEvent, GA_EVENT_CUSTOMER_SESSION_START } from "@/lib/gtag";
import { isUpcomingReservation } from "@/lib/reservations/customer-public-serialize";

type MenuItem = {
  href: string;
  title: string;
  subtitle: string;
  Icon: typeof CalendarDays;
  badge?: string;
  disabled?: boolean;
};

export function PerfilHomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me, welcomeName, reservations, logout, onLoginSuccess } = usePerfilSession();

  const [phoneInput, setPhoneInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(() => searchParams.get("saved") === "1");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("saved") !== "1") return;
    setSavedToast(true);
    router.replace("/perfil", { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    if (!savedToast) return;
    const t = window.setTimeout(() => setSavedToast(false), 3500);
    return () => window.clearTimeout(t);
  }, [savedToast]);

  const upcoming = useMemo(
    () =>
      (reservations ?? [])
        .filter((r) => isUpcomingReservation(r))
        .sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso)),
    [reservations],
  );
  const nextAppointment = upcoming[0] ?? null;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLikelyWhatsappNumber(phoneInput)) {
      setError("Ingresá un WhatsApp válido (10 a 15 dígitos).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/me/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone: phoneInput.trim(), source: "perfil" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "No se pudo iniciar sesión.");
        return;
      }
      gaEvent(GA_EVENT_CUSTOMER_SESSION_START, { login_source: "perfil" });
      setPhoneInput("");
      await onLoginSuccess();
    } catch {
      setError("Sin conexión. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      setLogoutConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!logoutConfirmOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setLogoutConfirmOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [logoutConfirmOpen, busy]);

  const menuItems: MenuItem[] = [
    {
      href: "/perfil/mis-datos",
      title: "Mis datos",
      subtitle: "Nombre y WhatsApp",
      Icon: User,
    },
    {
      href: "/perfil/mis-turnos",
      title: "Mis turnos",
      subtitle: "Ver, cambiar o cancelar",
      Icon: CalendarDays,
      badge: me === "authed" ? String(upcoming.length) : undefined,
    },
    {
      href: "/perfil/historial-tratamientos",
      title: "Historial",
      subtitle: "Sesiones realizadas",
      Icon: Clock3,
    },
    {
      href: "/servicios?from=perfil",
      title: "Servicios",
      subtitle: "Catálogo completo",
      Icon: Sparkles,
    },
    {
      href: "/promociones?from=perfil",
      title: "Beneficios cliente VIP",
      subtitle: "Combos y beneficios del mes",
      Icon: Percent,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-10 pb-28">
      <MisDatosUpdateAnnouncement />
      {savedToast ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-5">
          <div
            role="status"
            className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[16px] font-medium text-emerald-900 shadow-lg"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </span>
            Datos actualizados.
          </div>
        </div>
      ) : null}
      <header className="mb-6">
        <h1 className="font-heading text-5xl font-bold tracking-tight text-gray-900">Mi perfil</h1>
        {me === "authed" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xl text-gray-700">
              Hola, <span className="font-semibold text-gray-900">{welcomeName ?? "bienvenido/a"}</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setLogoutConfirmOpen(true)}
              className="cursor-pointer text-[15px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50"
            >
              Cerrar sesión
            </button>
          </div>
        ) : me === "guest" ? (
          <p className="mt-2 text-lg text-gray-600">Accedé con tu WhatsApp para ver tus turnos.</p>
        ) : (
          <p className="mt-2 text-lg text-gray-400">Comprobando sesión…</p>
        )}
      </header>

      {me === "guest" ? (
        <section
          id="acceso"
          className="mb-6 rounded-[24px] border border-gray-100 bg-[#F5F5F5] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
        >
          <p className="text-sm font-semibold tracking-wide text-[#7da3c4] uppercase">Acceso rápido</p>
          <p className="mt-2 text-[16px] text-gray-700">Usá el mismo WhatsApp que al reservar en la web o en el salón.</p>
          <form onSubmit={(e) => void handleLogin(e)} className="mt-4 space-y-4">
            <div>
              <label htmlFor="perfil-phone" className="text-[16px] font-semibold text-gray-900">
                WhatsApp
              </label>
              <input
                id="perfil-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Ej: +54 9 11 2345-6789"
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#7da3c4] focus:ring-2 focus:ring-[#7da3c4]/25"
              />
            </div>
            {error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[16px] text-red-800">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={busy} className={perfilPrimaryBtn}>
              {busy ? "Ingresando…" : "Ver mis turnos"}
            </button>
          </form>
        </section>
      ) : null}

      {me === "authed" ? (
        <>
          <Link
            href="/turnos"
            className="mb-4 flex h-14 w-full items-center justify-center rounded-full bg-[#7da3c4] text-lg font-semibold text-white shadow-lg transition active:scale-[0.98]"
          >
            Reservar nuevo turno
          </Link>

          {nextAppointment ? (
            <Link
              href="/perfil/mis-turnos"
              className="mb-6 block rounded-[24px] border border-[#7da3c4]/30 bg-[#7da3c4]/8 p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition hover:border-[#7da3c4]/50"
            >
              <p className="text-sm font-semibold text-[#7da3c4] uppercase tracking-wide">Próximo turno</p>
              <p className="mt-2 text-xl font-semibold text-gray-900">{nextAppointment.treatmentName}</p>
              <p className="mt-1 text-[16px] text-gray-600">
                {nextAppointment.displayDate} · {nextAppointment.timeLocal} hs
              </p>
              <p className="mt-3 text-[15px] font-medium text-[#7da3c4]">Ver detalle →</p>
            </Link>
          ) : (
            <p className="mb-6 rounded-[24px] border border-gray-100 bg-white px-5 py-4 text-[16px] text-gray-600 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
              No tenés turnos próximos. Reservá cuando quieras.
            </p>
          )}
        </>
      ) : null}

      <section className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-gray-500 uppercase">Menú</p>
        {menuItems.map(({ href, title, subtitle, Icon, badge, disabled }) =>
          disabled ? (
            <div
              key={title}
              className="flex items-center justify-between rounded-[24px] border border-gray-100 bg-gray-50 px-5 py-4 opacity-50"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                  <Icon className="h-6 w-6 text-gray-400" strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-[17px] font-semibold text-gray-700">{title}</p>
                  <p className="text-[15px] text-gray-400">{subtitle}</p>
                </div>
              </div>
            </div>
          ) : (
            <Link
              key={href}
              href={href}
              className="flex cursor-pointer items-center justify-between rounded-[24px] border border-gray-50 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(0,0,0,0.05)] transition active:scale-[0.99] hover:border-[#7da3c4]/25"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F5F5F5]">
                  <Icon className="h-6 w-6 text-[#7da3c4]" strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-[17px] font-semibold text-gray-900">{title}</p>
                  <p className="text-[15px] text-gray-500">{subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {badge !== undefined && Number(badge) > 0 ? (
                  <span className="rounded-full bg-[#7da3c4] px-2.5 py-0.5 text-[13px] font-semibold text-white">
                    {badge}
                  </span>
                ) : null}
                <ChevronRight className="h-5 w-5 text-gray-300" strokeWidth={2} />
              </div>
            </Link>
          ),
        )}
      </section>

      {logoutConfirmOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          aria-describedby="logout-confirm-desc"
          onClick={() => {
            if (!busy) setLogoutConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border border-gray-100 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="logout-confirm-title" className="font-heading text-2xl font-bold text-gray-900">
              Cerrar sesión
            </h3>
            <p id="logout-confirm-desc" className="mt-3 text-[16px] leading-relaxed text-gray-600">
              ¿Estás seguro/a de que querés cerrar sesión? Para ver tus turnos y datos vas a tener que
              ingresar tu WhatsApp otra vez. Tus reservas no se cancelan.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                disabled={busy}
                className="inline-flex h-10 items-center rounded-xl border border-gray-200 px-4 text-[15px] font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={busy}
                className="inline-flex h-10 items-center rounded-xl bg-[#7da3c4] px-4 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[#6d93b4] disabled:opacity-60"
              >
                {busy ? "Saliendo…" : "Sí, cerrar sesión"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
