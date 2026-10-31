import type { Exercise, IsoDate } from "./types";

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

export function parseDate(iso: IsoDate): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid date: ${iso}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date: ${iso}`);
  return { y, m, d };
}

export function formatDate({ y, m, d }: Ymd): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toUtc({ y, m, d }: Ymd): number {
  return Date.UTC(y, m - 1, d);
}

/** Adds calendar months, clamping the day to the target month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Ymd, months: number): Ymd {
  const total = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

export function addDays(date: Ymd, days: number): Ymd {
  const t = new Date(toUtc(date) + days * 86_400_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return toUtc(parseDate(a)) - toUtc(parseDate(b));
}

/** Inclusive day count from `from` to `to`; 0 when `to` is before `from`. */
export function daysInclusive(from: Ymd, to: Ymd): number {
  return Math.max(0, Math.round((toUtc(to) - toUtc(from)) / 86_400_000) + 1);
}

export function addDaysIso(iso: IsoDate, days: number): IsoDate {
  return formatDate(addDays(parseDate(iso), days));
}

export function addYears(iso: IsoDate, years: number): IsoDate {
  return formatDate(addMonths(parseDate(iso), years * 12));
}

export function compareExercises(a: Exercise, b: Exercise): number {
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  return a.bidding - b.bidding;
}

/** True when `e` falls inside an inclusive [from, to] exercise range; null ends are open. */
export function exerciseInRange(e: Exercise, from: Exercise | null, to: Exercise | null): boolean {
  return (from === null || compareExercises(e, from) >= 0) && (to === null || compareExercises(e, to) <= 0);
}
