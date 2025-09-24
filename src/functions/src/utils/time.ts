import { formatInTimeZone } from 'date-fns-tz';
import { addDays, differenceInCalendarDays } from 'date-fns';

const TZ = 'Europe/Istanbul';

export function trAt(date: Date, hh: number, mm = 0): Date {
  const dayStr = formatInTimeZone(date, TZ, 'yyyy-MM-dd');
  const offset = formatInTimeZone(new Date(`${dayStr}T00:00:00Z`), TZ, 'XXX');
  const hhStr = String(hh).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  return new Date(`${dayStr}T${hhStr}:${mmStr}:00${offset}`);
}

export function firstOfMonthAt19TR(base: Date = new Date()): Date {
  const d = new Date(base);
  const year = Number(formatInTimeZone(d, TZ, 'yyyy'));
  const month = Number(formatInTimeZone(d, TZ, 'MM'));
  const first = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  return trAt(first, 19, 0);
}

export function nextMonthFirstAt19TR(base: Date = new Date()): Date {
  const d = new Date(base);
  const year = Number(formatInTimeZone(d, TZ, 'yyyy'));
  const month = Number(formatInTimeZone(d, TZ, 'MM'));
  const nextFirst = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return trAt(nextFirst, 19, 0);
}

export function nextMonthOrThisMonthFirstAt19(base: Date = new Date()): Date {
  const thisFirst = firstOfMonthAt19TR(base);
  // If current TR time is past this month's 19:00 on day 1, pick next month
  const nowTR = new Date(formatInTimeZone(base, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"));
  if (nowTR.getTime() > thisFirst.getTime()) return nextMonthFirstAt19TR(base);
  return thisFirst;
}

export function monthKeyTR(date: Date = new Date()): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM');
}

export function computeRoundForDate(startDate: Date, at: Date = new Date()): number {
  // Round 1 is at startDate (19:00 TR); each subsequent round is +1 day at 19:00 TR
  const start = startDate;
  if (at.getTime() < start.getTime()) return 0;
  // Compare in TR calendar days to avoid DST issues
  const aKey = formatInTimeZone(at, TZ, 'yyyy-MM-dd');
  const sKey = formatInTimeZone(start, TZ, 'yyyy-MM-dd');
  const a = new Date(`${aKey}T00:00:00Z`);
  const s = new Date(`${sKey}T00:00:00Z`);
  const diff = differenceInCalendarDays(a, s);
  return diff + 1;
}

export function dateForRound(startDate: Date, round: number): Date {
  const d = addDays(startDate, Math.max(0, round - 1));
  return trAt(d, 19, 0);
}

