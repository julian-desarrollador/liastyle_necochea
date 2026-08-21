"use client";

type PanelSobreturnoConfirmProps = {
  open: boolean;
  title?: string;
  detail?: string | null;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PanelSobreturnoConfirm({
  open,
  title = "Este horario ya tiene otra clienta",
  detail,
  confirmLabel = "Cargar igual",
  busy = false,
  onCancel,
  onConfirm,
}: PanelSobreturnoConfirmProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sobreturno-title"
    >
      <div className="w-full max-w-md rounded-[24px] border border-gray-100 bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
        <p id="sobreturno-title" className="font-heading text-[20px] text-gray-900">
          {title}
        </p>
        <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
          {detail?.trim()
            ? detail
            : "Podés cargar el sobreturno igual. Es tu decisión."}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex h-[48px] w-full cursor-pointer items-center justify-center rounded-full bg-[#7da3c4] text-[15px] font-semibold text-white shadow-md transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Guardando…" : confirmLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex h-[44px] w-full cursor-pointer items-center justify-center rounded-full text-[14px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
