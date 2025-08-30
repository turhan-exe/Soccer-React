import { addDays } from 'date-fns';
// Berger round-robin algorithm for even number of teams
export function generateRoundRobinFixtures(teamIds) {
    const n = teamIds.length;
    if (n % 2 !== 0)
        throw new Error('Team count must be even');
    const rounds = n - 1;
    const half = n / 2;
    const teams = [...teamIds];
    const fixtures = [];
    for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < half; i++) {
            const homeIdx = (round + i) % (n - 1);
            const awayIdx = (n - 1 - i + round) % (n - 1);
            let home = teams[homeIdx];
            let away = teams[awayIdx];
            if (i === 0)
                away = teams[n - 1];
            if (round % 2 === 1) {
                const tmp = home;
                home = away;
                away = tmp;
            }
            fixtures.push({ round: round + 1, homeTeamId: home, awayTeamId: away });
        }
    }
    return fixtures;
}
// Returns 19:00 Europe/Istanbul of today or tomorrow if past 19:00
export function nextValid19TR(now = new Date()) {
    const tz = 'Europe/Istanbul';
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    let day = Number(parts.find((p) => p.type === 'day')?.value);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    if (hour >= 19)
        day += 1;
    const local = new Date(Date.UTC(year, month - 1, day, 19, 0, 0));
    const offset = new Date(local.toLocaleString('en-US', { timeZone: tz })).getTime() -
        local.getTime();
    return new Date(local.getTime() - offset);
}
export function addDaysUTC(date, days) {
    return addDays(date, days);
}
