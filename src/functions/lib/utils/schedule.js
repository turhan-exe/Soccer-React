import { formatInTimeZone } from 'date-fns-tz';
import { addMinutes } from 'date-fns';
import * as admin from 'firebase-admin';
const TZ = 'Europe/Istanbul';
export function dayKeyTR(d = new Date()) {
    return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}
export function trAt(d, hh, mm = 0) {
    // Build a TR-date string for midnight, then set UTC hours appropriately
    const baseStr = formatInTimeZone(d, TZ, "yyyy-MM-dd'T'00:00:00XXX");
    const base = new Date(baseStr);
    base.setUTCHours(hh - base.getTimezoneOffset() / 60, mm, 0, 0);
    return base; // UTC Date representing TR time desired
}
export function todayTR_19() {
    const d = new Date();
    return trAt(d, 19, 0);
}
// Alias used by other modules
export function today19TR(d = new Date()) {
    return trAt(d, 19, 0);
}
export function todayTR_18_30() {
    const d = new Date();
    return trAt(d, 18, 30);
}
export function isInLockWindow(now = new Date()) {
    const start = todayTR_18_30();
    const end = todayTR_19();
    return now >= start && now < end;
}
export function ts(date) {
    return admin.firestore.Timestamp.fromDate(date);
}
export function betweenTR_19_to_2359(dateTRKey) {
    // for yyyy-MM-dd in TR, get UTC Date range for 19:00–23:59 TR
    const base = new Date(dateTRKey);
    const start = trAt(base, 19, 0);
    const end = trAt(base, 23, 59);
    return { start, end };
}
export function addMinutesTR(date, minutes) {
    return addMinutes(date, minutes);
}
