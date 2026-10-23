"use client";

import { useEffect, useState } from "react";

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

  if (state === "loading") return null;

  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      {state === "unconfigured" ? (
        <p className="text-[13px] text-gray-500">Los avisos del panel no están configurados.</p>
      ) : null}
      {state === "ios-install" ? (
        <p className="text-[13px] leading-snug text-gray-700">
          Para recibir avisos en iPhone, agregá el panel a la pantalla de inicio (Compartir, Agregar a inicio) y
          abrilo desde ahí.
        </p>
      ) : null}
      {state === "unsupported" ? (
        <p className="text-[13px] text-gray-500">Este navegador no puede recibir avisos.</p>
      ) : null}
      {state === "denied" ? (
        <p className="text-[13px] leading-snug text-gray-700">
          Los avisos están bloqueados. Activalos en los ajustes del teléfono para este sitio.
        </p>
      ) : null}
      {state === "off" ? (
        <button
          type="button"
          onClick={() => void activate()}
          disabled={busy}
          className="flex h-11 w-full cursor-pointer items-center justify-center rounded-2xl bg-[#7da3c4] text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Activando…" : "Activar avisos"}
        </button>
      ) : null}
      {state === "on" ? (
        <div className="flex flex-col gap-2">
          <p className="text-center text-[13px] font-medium text-gray-800">Avisos activados en este celular</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={busy}
              className="h-10 cursor-pointer rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Probar aviso
            </button>
            <button
              type="button"
              onClick={() => void deactivate()}
              disabled={busy}
              className="h-10 cursor-pointer rounded-xl text-[13px] font-semibold text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Desactivar
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-center text-[12px] text-red-600">{error}</p> : null}
    </div>
  );
}
