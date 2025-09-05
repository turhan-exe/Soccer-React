import { formatInTimeZone } from 'date-fns-tz';
import { addMinutes } from 'date-fns';
import { Timestamp } from 'firebase-admin/firestore';
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
// Next day's 19:00 in TR timezone
export function nextDay19TR(d = new Date()) {
    const next = new Date(d.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    return trAt(next, 19, 0);
}
export function ts(date) {
    return Timestamp.fromDate(date);
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
// Round-robin fixture generator (single round)
export function generateRoundRobinFixtures(teams) {
    const ids = [...teams];
    if (ids.length < 2)
        return [];
    // If odd, add a BYE placeholder and skip matches against it
    const BYE = '__BYE__';
    if (ids.length % 2 === 1)
        ids.push(BYE);
    const n = ids.length;
    const rounds = n - 1;
    const fixtures = [];
    const arr = [...ids];
    for (let r = 0; r < rounds; r++) {
        const half = n / 2;
        for (let i = 0; i < half; i++) {
            const a = arr[i];
            const b = arr[n - 1 - i];
            if (a !== BYE && b !== BYE) {
                // Alternate home/away by round for basic balance
                const even = r % 2 === 0;
                fixtures.push({
                    round: r + 1,
                    homeTeamId: even ? a : b,
                    awayTeamId: even ? b : a,
                });
            }
        }
        // Rotate while keeping first index fixed: [0, n-1, 1, 2, ..., n-2]
        const last = arr.pop();
        arr.splice(1, 0, last);
    }
    return fixtures;
}
