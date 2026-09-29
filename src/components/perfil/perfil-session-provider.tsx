"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import type { CustomerReservationPublic } from "@/lib/reservations/customer-public-serialize";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type MeState = "unknown" | "guest" | "authed";

export type PerfilSessionCtx = {
  me: MeState;
  welcomeName: string | null;
  reservations: CustomerReservationPublic[] | null;
  /** Vuelve a buscar las reservas y refresca el estado (usar luego de cancelar/reprogramar). */
  reload: () => Promise<void>;
  /** Cierra la sesión y limpia el estado. */
  logout: () => Promise<void>;
  /** Llamar después de un login exitoso para refrescar. */
  onLoginSuccess: () => Promise<void>;
  /** Actualiza el nombre de ficha (y el WhatsApp en caché si viene). */
  setDisplayName: (name: string, phone?: string) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PerfilSession = createContext<PerfilSessionCtx | null>(null);

export function usePerfilSession(): PerfilSessionCtx {
  const ctx = useContext(PerfilSession);
  if (!ctx) throw new Error("usePerfilSession debe usarse dentro de PerfilSessionProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CACHE_KEY = "mp_customer_profile_cache";
const CACHE_TTL_MS = 90_000; // 90 s — si la caché es más nueva no re-fetch al volver atrás

function pickWelcomeName(rows: CustomerReservationPublic[]): string | null {
  const sorted = [...rows].sort((a, b) => b.startsAtIso.localeCompare(a.startsAtIso));
  for (const r of sorted) {
    const n = r.customerName?.trim();
    if (n && n !== "Cliente") return n;
  }
  return sorted[0]?.customerName?.trim() || null;
}

function saveCache(name: string | null, phone: string) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ name: name ?? "", phone, cachedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

function readCache(): { name: string; cachedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: string; cachedAt?: number };
    if (typeof parsed.name === "string" && typeof parsed.cachedAt === "number") {
      return { name: parsed.name, cachedAt: parsed.cachedAt };
    }
  } catch {
    // ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PerfilSessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeState>("unknown");
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const [reservations, setReservations] = useState<CustomerReservationPublic[] | null>(null);

  // Evita que el effect de bootstrap corra dos veces (StrictMode)
  const bootstrapped = useRef(false);
  // Marca de cuándo fue el último fetch exitoso (para decidir si refetch al volver)
  const lastFetchedAt = useRef<number>(0);

  const applyReservations = useCallback((list: CustomerReservationPublic[], displayName?: string | null) => {
    setReservations(list);
    setMe("authed");
    const fromProfile = displayName?.trim() ?? "";
    const name = fromProfile.length >= 2 ? fromProfile : pickWelcomeName(list);
    setWelcomeName(name);
    lastFetchedAt.current = Date.now();
    const latest = [...list].sort((a, b) => b.startsAtIso.localeCompare(a.startsAtIso))[0];
    saveCache(name, latest?.customerPhone ?? "");
  }, []);

  const fetchReservations = useCallback(async () => {
    try {
      const res = await fetch("/api/me/reservations?source=perfil_home", {
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setMe("guest");
        setWelcomeName(null);
        setReservations([]);
        try {
          localStorage.removeItem(CACHE_KEY);
        } catch {
          // ignore
        }
        return;
      }
      if (!res.ok) {
        setMe((prev) => (prev === "authed" ? "authed" : "guest"));
        return;
      }
      const data = (await res.json()) as {
        reservations?: CustomerReservationPublic[];
        displayName?: string | null;
      };
      applyReservations(Array.isArray(data.reservations) ? data.reservations : [], data.displayName);
    } catch {
      setMe((prev) => (prev === "authed" ? "authed" : "guest"));
    }
  }, [applyReservations]);

  const reload = useCallback(async () => {
    await fetchReservations();
  }, [fetchReservations]);

  const onLoginSuccess = useCallback(async () => {
    await fetchReservations();
  }, [fetchReservations]);

  const setDisplayName = useCallback((name: string, phone?: string) => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setWelcomeName(trimmed);
    const latest = reservations
      ? [...reservations].sort((a, b) => b.startsAtIso.localeCompare(a.startsAtIso))[0]
      : undefined;
    saveCache(trimmed, phone?.trim() || latest?.customerPhone || "");
  }, [reservations]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/me/session", { method: "DELETE", credentials: "same-origin" });
    } catch {
      // ignore network errors
    }
    setMe("guest");
    setWelcomeName(null);
    setReservations([]);
    lastFetchedAt.current = 0;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    // Mostrar caché inmediatamente si es reciente
    const cached = readCache();
    if (cached && cached.name && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      setMe("authed");
      setWelcomeName(cached.name);
      // Igual hacemos el fetch en background para mantener reservas actualizadas
      void fetchReservations();
    } else {
      // Caché vencida o ausente: fetch bloqueante
      void fetchReservations();
    }
  }, [fetchReservations]);

  return (
    <PerfilSession.Provider
      value={{ me, welcomeName, reservations, reload, logout, onLoginSuccess, setDisplayName }}
    >
      {children}
    </PerfilSession.Provider>
  );
}
