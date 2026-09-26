/** Hoy y los 6 días siguientes, en hora de Necochea. */
export const BIRTHDAY_WINDOW_DAYS = 7;

const ART_TIME_ZONE = "America/Argentina/Buenos_Aires";

const MONTH_NAMES = [
  "",
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const MONTH_LENGTHS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type CustomerBirth = {
  birthDay: number;
  birthMonth: number;
  birthYear: number | null;
};

export type UpcomingBirthday = {
  phoneDigits: string;
  customerName: string;
  birthDay: number;
  birthMonth: number;
  birthYear: number | null;
  daysUntil: number;
  age: number | null;
};

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export class InvalidCustomerBirthError extends Error {
  constructor(message = "Fecha de nacimiento inválida.") {
    super(message);
    this.name = "InvalidCustomerBirthError";
  }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Febrero admite 29 si no hay año, o si el año es bisiesto. */
export function daysInBirthMonth(month: number, year: number | null): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    if (year == null) return 29;
    return isLeapYear(year) ? 29 : 28;
  }
  return MONTH_LENGTHS[month] ?? 0;
}

export function artDateParts(now = new Date()): CalendarDate {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: ART_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = formatted.split("-").map(Number);
  return { year, month, day };
}

export function addCalendarDays(parts: CalendarDate, days: number): CalendarDate {
  const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function emptyBirthToken(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function readInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Día y mes vacíos (y año vacío) borran la fecha.
 * Si falta solo uno de los dos, o el día no existe, lanza `InvalidCustomerBirthError`.
 */
export function parseCustomerBirthInput(
  input: { birthDay: unknown; birthMonth: unknown; birthYear: unknown },
  now = new Date(),
): CustomerBirth | null {
  const dayEmpty = emptyBirthToken(input.birthDay);
  const monthEmpty = emptyBirthToken(input.birthMonth);
  const yearEmpty = emptyBirthToken(input.birthYear);

  if (dayEmpty && monthEmpty && yearEmpty) return null;
  if (dayEmpty || monthEmpty) {
    throw new InvalidCustomerBirthError("Completá día y mes, o dejá la fecha vacía.");
  }

  const birthDay = readInt(input.birthDay);
  const birthMonth = readInt(input.birthMonth);
  if (birthDay == null || birthMonth == null) {
    throw new InvalidCustomerBirthError();
  }

  let birthYear: number | null = null;
  if (!yearEmpty) {
    birthYear = readInt(input.birthYear);
    if (birthYear == null) throw new InvalidCustomerBirthError();
  }

  assertValidBirth(birthDay, birthMonth, birthYear, now);
  return { birthDay, birthMonth, birthYear };
}

export function assertValidBirth(
  birthDay: number,
  birthMonth: number,
  birthYear: number | null,
  now = new Date(),
): void {
  if (birthMonth < 1 || birthMonth > 12) throw new InvalidCustomerBirthError();
  const maxDay = daysInBirthMonth(birthMonth, birthYear);
  if (birthDay < 1 || birthDay > maxDay) throw new InvalidCustomerBirthError();
  if (birthYear != null) {
    const { year } = artDateParts(now);
    if (birthYear < 1900 || birthYear > year) throw new InvalidCustomerBirthError();
  }
}

/**
 * En un año no bisiesto, el 29 de febrero se saluda el 28.
 */
export function birthdayOccursOn(
  birth: { birthDay: number; birthMonth: number },
  date: CalendarDate,
): boolean {
  if (birth.birthMonth === date.month && birth.birthDay === date.day) return true;
  return (
    birth.birthMonth === 2 &&
    birth.birthDay === 29 &&
    date.month === 2 &&
    date.day === 28 &&
    !isLeapYear(date.year)
  );
}

function birthdayAlreadyPassed(
  birth: { birthDay: number; birthMonth: number },
  today: CalendarDate,
): boolean {
  if (today.month > birth.birthMonth) return true;
  if (today.month < birth.birthMonth) return false;
  return today.day > birth.birthDay;
}

/** Días hasta el cumple dentro de la ventana, o `null` si cae después. */
export function daysUntilBirthday(
  birth: { birthDay: number; birthMonth: number },
  now = new Date(),
  windowDays = BIRTHDAY_WINDOW_DAYS,
): number | null {
  const today = artDateParts(now);
  for (let offset = 0; offset < windowDays; offset++) {
    if (birthdayOccursOn(birth, addCalendarDays(today, offset))) return offset;
  }
  return null;
}

export function ageTurningOnBirthday(birthYear: number | null, occursYear: number): number | null {
  if (birthYear == null) return null;
  const age = occursYear - birthYear;
  if (age < 0 || age > 120) return null;
  return age;
}

export function ageAsOfToday(birth: CustomerBirth, now = new Date()): number | null {
  if (birth.birthYear == null) return null;
  const today = artDateParts(now);
  let age = today.year - birth.birthYear;
  const hadBirthday = birthdayOccursOn(birth, today) || birthdayAlreadyPassed(birth, today);
  if (!hadBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function formatBirthdayDate(birthDay: number, birthMonth: number): string {
  const month = MONTH_NAMES[birthMonth] ?? "";
  return `${birthDay} de ${month}`;
}

export function birthdayWhenLabel(daysUntil: number): string {
  if (daysUntil <= 0) return "Hoy";
  if (daysUntil === 1) return "Mañana";
  return `En ${daysUntil} días`;
}

export const BIRTH_MONTH_OPTIONS = MONTH_NAMES.slice(1).map((label, index) => ({
  value: String(index + 1),
  label: label.charAt(0).toUpperCase() + label.slice(1),
}));
