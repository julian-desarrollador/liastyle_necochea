export type PanelReservation = {
  id: string;
  treatmentId: string;
  treatmentName: string;
  subtitle: string;
  category: string;
  dateKey: string;
  timeLocal: string;
  displayDate: string;
  customerName: string;
  customerPhone: string;
  reservationStatus: string;
  paymentStatus: string;
  cancelledBy?: "panel" | "customer" | "whatsapp" | "system" | null;
  source?: string;
  waReminder24hSentAt?: string | null;
  waReminder24hStatus?: "sending" | "sent" | "unknown" | null;
  waAttendanceConfirmedAt?: string | null;
  startsAt: string;
  createdAt: string;
};

export type PanelAgendaBlock = {
  id: string;
  anchorDateKey: string;
  timeLocal: string;
  durationMinutes: number;
  scope: string;
  recurrence: { type: "weekly"; untilDateKey?: string | null } | null;
  notes?: string | null;
};
