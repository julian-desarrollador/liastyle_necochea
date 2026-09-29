"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { perfilBackBtn, perfilPrimaryBtn } from "@/components/perfil/perfil-ui";
import { usePerfilSession } from "@/components/perfil/perfil-session-provider";
import { isLikelyWhatsappNumber } from "@/lib/booking/salon-availability";

export function MisDatosClient() {
  const router = useRouter();
  const { me, welcomeName, setDisplayName, reload } = usePerfilSession();

  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [initialName, setInitialName] = useState("");
  const [initialPhone, setInitialPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me === "guest") {
      setLoading(false);
      return;
    }
    if (me !== "authed") return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/me/profile", { credentials: "same-origin", cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setNameInput(welcomeName ?? "");
          setInitialName(welcomeName ?? "");
          setLoading(false);
          return;
        }
        const data = (await res.json()) as { displayName?: string | null; customerPhone?: string };
        const name = data.displayName?.trim() || welcomeName || "";
        const phone = data.customerPhone?.trim() || "";
        setNameInput(name);
        setInitialName(name);
        setPhoneInput(phone);
        setInitialPhone(phone);
      } catch {
        if (!cancelled) {
          setNameInput(welcomeName ?? "");
          setInitialName(welcomeName ?? "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, welcomeName]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = nameInput.trim();
    if (name.length < 2) {
      setError("El nombre es demasiado corto.");
      return;
    }
    const phone = phoneInput.trim();
    if (!isLikelyWhatsappNumber(phone)) {
      setError("Ingresá un WhatsApp válido (10 a 15 dígitos).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName: name, customerPhone: phone }),
      });
      const data = (await res.json()) as {
        error?: string;
        displayName?: string;
        customerPhone?: string | null;
        phoneChanged?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? "No se pudieron guardar tus datos.");
        return;
      }
      const savedName = data.displayName?.trim() || name;
      const savedPhone = data.customerPhone?.trim() || phone;
      setDisplayName(savedName, savedPhone);
      if (data.phoneChanged) {
        await reload();
      }
      router.replace("/perfil?saved=1");
    } catch {
      setError("Sin conexión. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    nameInput.trim().length >= 2 &&
    isLikelyWhatsappNumber(phoneInput) &&
    (nameInput.trim() !== initialName.trim() || phoneInput.trim() !== initialPhone.trim());

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-8 pb-28">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/perfil" className={perfilBackBtn} aria-label="Volver al perfil">
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </Link>
        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight text-gray-900">Mis datos</h1>
          <p className="mt-0.5 text-[16px] text-gray-500">Nombre y WhatsApp de tu cuenta</p>
        </div>
      </header>

      {me === "guest" ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[16px] text-amber-900">
          Iniciá sesión desde Perfil con tu WhatsApp.{" "}
          <Link href="/perfil#acceso" className="font-semibold text-[#7da3c4] underline-offset-2 hover:underline">
            Ir a acceso
          </Link>
        </p>
      ) : null}

      {me === "unknown" || (me === "authed" && loading) ? (
        <p className="text-[16px] text-gray-500">Cargando tus datos…</p>
      ) : null}

      {me === "authed" && !loading ? (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
          <p className="text-[16px] leading-relaxed text-gray-600">
            El nombre es el que ve Analia en la agenda. El celular es el de tu cuenta y de los próximos turnos.
          </p>

          <div>
            <label htmlFor="mis-datos-nombre" className="text-[16px] font-semibold text-gray-900">
              Nombre
            </label>
            <input
              id="mis-datos-nombre"
              name="displayName"
              type="text"
              autoComplete="name"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setError(null);
              }}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#7da3c4] focus:ring-2 focus:ring-[#7da3c4]/25"
            />
          </div>

          <div>
            <label htmlFor="mis-datos-phone" className="text-[16px] font-semibold text-gray-900">
              WhatsApp
            </label>
            <input
              id="mis-datos-phone"
              name="customerPhone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setError(null);
              }}
              placeholder="Ej: +54 9 11 2345-6789"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#7da3c4] focus:ring-2 focus:ring-[#7da3c4]/25"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[16px] text-red-800">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={busy || !dirty} className={perfilPrimaryBtn}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </form>
      ) : null}
    </main>
  );
}
