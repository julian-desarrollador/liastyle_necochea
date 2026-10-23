"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  isIosDevice,
  isStandaloneDisplay,
  panelPushPublicKey,
  registerPanelServiceWorker,
  unsubscribeThisPanelDevice,
  urlBase64ToUint8Array,
} from "@/lib/push/panel-push-client";

type PushUiState = "loading" | "unconfigured" | "ios-install" | "unsupported" | "denied" | "off" | "on";

export function PanelPushToggle() {
  const [state, setState] = useState<PushUiState>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!panelPushPublicKey()) {
        if (alive) setState("unconfigured");
        return;
      }
      if (isIosDevice() && !isStandaloneDisplay()) {
        if (alive) setState("ios-install");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (alive) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (alive) setState("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!alive) return;
        setEndpoint(subscription?.endpoint ?? null);
        setState(subscription ? "on" : "off");
      } catch {
        if (alive) setState("off");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const registration = await registerPanelServiceWorker();
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const publicKey = panelPushPublicKey();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = subscription.toJSON();
      const res = await fetch("/api/panel-turnos/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      if (!res.ok) {
        setError("No se pudieron activar los avisos.");
        return;
      }
      setEndpoint(subscription.endpoint);
      setState("on");
    } catch {
      setError("No se pudieron activar los avisos.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeThisPanelDevice();
      setEndpoint(null);
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/panel-turnos/push/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      if (!res.ok) setError("No se pudo enviar el aviso de prueba.");
    } catch {
      setError("No se pudo enviar el aviso de prueba.");
    } finally {
      setBusy(false);
    }
  }

  const active = state === "on";
  const canToggle = state === "off" || state === "on";

  return (
    <>
      <button
        type="button"
        aria-label="Notificaciones"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full"
      >
        <Bell
          className={`h-5 w-5 text-[#E8A317] ${active ? "fill-[#E8A317]" : ""}`}
          strokeWidth={2.4}
        />
      </button>

      {open
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-push-title"
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="panel-push-title" className="font-montserrat text-[20px] font-bold text-gray-900">
              Notificaciones
            </h3>

            {state === "loading" ? <p className="mt-2 text-[14px] text-gray-500">Cargando…</p> : null}
            {state === "unconfigured" ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">Los avisos del panel no están configurados.</p>
            ) : null}
            {state === "ios-install" ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
                Para recibir avisos en iPhone, agregá el panel a la pantalla de inicio (Compartir, Agregar a inicio) y
                abrilo desde ahí.
              </p>
            ) : null}
            {state === "unsupported" ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">Este navegador no puede recibir avisos.</p>
            ) : null}
            {state === "denied" ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
                Los avisos están bloqueados. Activalos en los ajustes del teléfono para este sitio.
              </p>
            ) : null}
            {state === "off" ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
                Este celular no recibe avisos cuando alguien reserva o cancela.
              </p>
            ) : null}
            {state === "on" ? (
              <p className="mt-3 rounded-2xl bg-[#e7f0f7] px-3 py-3 text-center text-[15px] font-semibold leading-snug text-[#4b7394]">
                <span aria-hidden="true">🎉 </span>
                ¡Avisos activados en este celular!
              </p>
            ) : null}

            {canToggle ? (
              <button
                type="button"
                onClick={() => void (active ? deactivate() : activate())}
                disabled={busy}
                className="mt-4 flex h-11 w-full cursor-pointer items-center justify-center rounded-2xl bg-[#7da3c4] text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (active ? "Desactivando…" : "Activando…") : active ? "Desactivar" : "Activar"}
              </button>
            ) : null}

            {active ? (
              <button
                type="button"
                onClick={() => void sendTest()}
                disabled={busy}
                className="mt-3 w-full cursor-pointer text-center text-[13px] font-semibold text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Probar aviso
              </button>
            ) : null}

            {error ? <p className="mt-3 text-center text-[12px] text-red-600">{error}</p> : null}
          </div>
        </div>,
        document.body,
      )
        : null}
    </>
  );
}
