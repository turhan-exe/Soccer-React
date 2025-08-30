import { addDays } from 'date-fns';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
// Circle method (team[0] sabit) — ilk yarı: A, B, C, ... sırasıyla
// A'nın ev sahibi olduğu karşılaşmalar; ikinci yarı birebir aynısının
// deplasman olarak aynen tekrarı. Kullanıcı beklentisiyle uyumlu sıra.
export function generateRoundRobinFixtures(teamIds) {
    const n = teamIds.length;
    if (n % 2 !== 0)
        throw new Error('Team count must be even');
    const rounds = n - 1;
    const half = n / 2;
    const fixed = teamIds[0];
    const rotating = teamIds.slice(1); // dönen kuyruk
    const firstLeg = [];
    for (let r = 0; r < rounds; r++) {
        // 1) Sabit takım fixed, her turda rotating[0] ile oynar
        firstLeg.push({ round: r + 1, homeTeamId: fixed, awayTeamId: rotating[0] });
        // 2) Kalan eşleşmeler: uçlardan içeri doğru eşleştir
        for (let i = 1; i < half; i++) {
            const t1 = rotating[i];
            const t2 = rotating[rotating.length - i];
            // Basit dengeleme: tur numarasına göre ev sahibi değiştir (opsiyonel)
            if (r % 2 === 0) {
                firstLeg.push({ round: r + 1, homeTeamId: t1, awayTeamId: t2 });
            }
            else {
                firstLeg.push({ round: r + 1, homeTeamId: t2, awayTeamId: t1 });
            }
        }
        // 3) Döndür: ilk elemanı sona al (A vs B -> A vs C -> ...)
        const first = rotating.shift();
        rotating.push(first);
    }
    // İkinci yarı: aynı sıranın ev/deplasman ters çevrilmiş hali
    const secondLeg = firstLeg.map((m) => ({
        round: rounds + m.round,
        homeTeamId: m.awayTeamId,
        awayTeamId: m.homeTeamId,
    }));
    return [...firstLeg, ...secondLeg];
}
// Returns the next day at 19:00 in Europe/Istanbul, as a UTC Date
export function nextDay19TR(baseDate = new Date()) {
    const tz = 'Europe/Istanbul';
    // Find tomorrow's date in TR timezone (string)
    const tomorrowYmdInTR = formatInTimeZone(addDays(baseDate, 1), tz, 'yyyy-MM-dd');
    // Convert that local TR 19:00 to a UTC Date
    return fromZonedTime(`${tomorrowYmdInTR} 19:00:00`, tz);
}
export function addDaysUTC(date, days) {
    return addDays(date, days);
}
