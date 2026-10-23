const PANEL_SW_URL = "/panel-sw.js";
const PANEL_SW_SCOPE = "/panel-turnos";

export function panelPushPublicKey(): string {
  return process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isStandaloneDisplay(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export async function registerPanelServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(PANEL_SW_URL, { scope: PANEL_SW_SCOPE });
}

/** Da de baja este celular mientras la sesión del panel sigue activa. */
export async function unsubscribeThisPanelDevice(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    const endpoint = subscription?.endpoint;
    if (!endpoint) return;
    await fetch("/api/panel-turnos/push/subscribe", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    await subscription.unsubscribe();
  } catch {
    /* Cerrar sesión no debe trabarse si el navegador no tiene avisos. */
  }
}
