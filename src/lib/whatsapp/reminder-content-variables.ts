import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";

const SALON_TIME_ZONE = "America/Argentina/Buenos_Aires";

export type ReminderTemplateVariables = {
  nombre: string;
  servicio: string;
  fecha: string;
  hora: string;
};

/** Ejemplo: `Sábado 22/08`, como espera `{{3}}` en la plantilla aprobada. */
export function formatReminderDayAndDate(startsAt: Date): string {
  const value = formatInTimeZone(startsAt, SALON_TIME_ZONE, "EEEE dd/MM", {
    locale: es,
  });
  return value.charAt(0).toLocaleUpperCase("es-AR") + value.slice(1);
}

/** Variables de `recordatorio_turno_lia_nuevas_clientas`. */
export function buildReminderContentVariables(input: {
  nombre: string;
  servicio: string;
  startsAt: Date;
  hora: string;
}): {
  contentVariablesJson: string;
  templateVariables: ReminderTemplateVariables;
} {
  return buildReminderContentVariablesFromValues({
    nombre: input.nombre,
    servicio: input.servicio,
    fecha: formatReminderDayAndDate(input.startsAt),
    hora: input.hora,
  });
}

export function buildReminderContentVariablesFromValues(
  input: ReminderTemplateVariables,
): {
  contentVariablesJson: string;
  templateVariables: ReminderTemplateVariables;
} {
  const templateVariables: ReminderTemplateVariables = {
    nombre: input.nombre.trim(),
    servicio: input.servicio.trim(),
    fecha: input.fecha.trim(),
    hora: input.hora.trim(),
  };

  return {
    contentVariablesJson: JSON.stringify({
      "1": templateVariables.nombre,
      "2": templateVariables.servicio,
      "3": templateVariables.fecha,
      "4": templateVariables.hora,
    }),
    templateVariables,
  };
}
