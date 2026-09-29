"use client";

import { useCallback, useEffect, useState } from "react";

import {
  hasSeenMisDatosUpdateAnnouncement,
  markMisDatosUpdateAnnouncementSeen,
} from "@/lib/announcements/mis-datos-update";

export function MisDatosUpdateAnnouncement() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasSeenMisDatosUpdateAnnouncement()) return;
    setOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    markMisDatosUpdateAnnouncementSeen();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-5"
      onClick={dismiss}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mis-datos-update-title"
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#7da3c4] px-6 py-5 text-center">
          <p className="text-[40px] leading-none" aria-hidden>
            ✨
          </p>
          <h2 id="mis-datos-update-title" className="font-heading mt-3 text-[22px] font-bold text-white">
            Nuevo: Mis datos
          </h2>
        </div>
        <div className="px-6 py-5 text-center">
          <p className="text-[17px] leading-snug text-gray-800">
            Editá tu <span className="font-semibold text-[#7da3c4]">nombre</span> y{" "}
            <span className="font-semibold text-[#7da3c4]">WhatsApp</span> cuando quieras.
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="mt-5 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-[#7da3c4] text-[16px] font-semibold text-white shadow-sm transition hover:bg-[#6d93b4] active:scale-[0.99]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
