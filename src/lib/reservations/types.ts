import type { ObjectId } from "mongodb";
import type { TreatmentCategory } from "@/lib/treatments/catalog";

export type { TreatmentCategory };

/** Estados de la reserva en ciclo de vida operativo */
export type ReservationStatus =
  | "pending_payment"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

/** Estado del cobro de seña / total (Mercado Pago) */
export type PaymentStatus = "not_required" | "pending" | "simulated_paid" | "approved" | "failed" | "refunded";

export type ReservationSource = "app_turnos" | "panel";
export type ReservationBookingMode = "single" | "combo";
export type ReservationCancelledBy = "panel" | "customer" | "whatsapp" | "system";

export type ReservationServiceItem = {
  treatmentId: string;
  treatmentName: string;
  subtitle: string;
  category: TreatmentCategory;
  durationMinutes: number;
};

export type ReservationDoc = {
  _id: ObjectId;
  treatmentId: string;
  treatmentName: string;
  subtitle: string;
  category: TreatmentCategory;
  dateKey: string;
  timeLocal: string;
  displayDate: string;
  startsAt: Date;
  /** Duración del servicio en minutos (catálogo al crear; ausente en reservas viejas). */
  durationMinutes?: number;
  /** En combos, snapshot de servicios incluidos al momento de reservar. */
  serviceItems?: ReservationServiceItem[];
  /** Duración total del bloque reservado (incluye combos). */
  totalDurationMinutes?: number;
  /** Modo de reserva: servicio único o combo. */
  bookingMode?: ReservationBookingMode;
  customerName: string;
  customerPhone: string;
  /** Solo dígitos; índice para “mis turnos”. Opcional en documentos viejos hasta backfill. */
  customerPhoneDigits?: string;
  whatsappOptIn: boolean;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentStatus;
  source: ReservationSource;
  /** Quién creó la reserva desde el panel (no hay multi-usuario: default "panel" o env). */
  createdBy?: string | null;
  /** Notas internas solo para reservas cargadas desde el panel. */
  panelNotes?: string | null;
  /** Ficha técnica de la visita (panel): fórmulas, detalles del servicio, etc. */
  technicalNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Secreto de un solo uso para crear la preferencia Checkout Pro (no es password del usuario). */
  checkoutToken?: string;
  /** Igual a _id hex; también enviado a MP como external_reference. */
  externalReference?: string;
  preferenceId?: string | null;
  /** Último payment id de MP asociado (aprobado). */
  mpPaymentId?: string | null;
  /** Último status devuelto por la API de pagos (approved, pending, rejected, etc.). */
  mpPaymentStatusLast?: string | null;
  mpPaymentApprovedAt?: Date | null;
  paymentDeadlineAt?: Date | null;
  /** Monto de seña cobrado online vía Mercado Pago (cuando aplica). */
  depositAmountArs?: number;
  depositRate?: number;
  /** True si el precio base del servicio/combo es “desde”. */
  depositPriceIsFrom?: boolean;
  cancelReason?: string | null;
  cancelledBy?: ReservationCancelledBy | null;
  /** Marca de envío del recordatorio WhatsApp ~24h antes (cron). */
  waReminder24hSentAt?: Date | null;
  /** SID del recordatorio vigente; invalida botones de mensajes anteriores. */
  waReminder24hMessageSid?: string | null;
  /** Estado técnico del intento vigente. */
  waReminder24hStatus?: "sending" | "sent" | "unknown" | null;
  /** La clienta confirmó asistencia desde el botón del recordatorio. */
  waAttendanceConfirmedAt?: Date | null;
};

export type CreateReservationInput = {
  treatmentId: string;
  treatmentName: string;
  subtitle: string;
  category: TreatmentCategory;
  dateKey: string;
  timeLocal: string;
  displayDate: string;
  customerName: string;
  customerPhone: string;
  whatsappOptIn: boolean;
  /** Combo de servicios (v1: 1 a 3). Si no viene, usa `treatmentId` simple. */
  serviceIds?: string[];
};

/** Auditoría de notificaciones Mercado Pago (webhook / IPN). */
export type MpWebhookEventDoc = {
  _id?: ObjectId;
  receivedAt: Date;
  method: string;
  topic: string | null;
  resourceId: string | null;
  querySnapshot: Record<string, string>;
  bodySnapshot: unknown;
  processingOutcome: "processed" | "ignored" | "error";
  detail?: string;
  reservationHexId?: string | null;
  mpPaymentId?: string | null;
};
