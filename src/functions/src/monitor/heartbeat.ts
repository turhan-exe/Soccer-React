import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import { log } from '../logger.js';


const db = getFirestore();
const TZ = 'Europe/Istanbul';

export function dayTR(d: Date = new Date()): string {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}

// Writes/merges a heartbeat document under ops_heartbeats/{yyyy-mm-dd}
export async function markHeartbeat(patch: Record<string, any>, d?: Date) {
  const day = dayTR(d ?? new Date());
  const ref = db.doc(`ops_heartbeats/${day}`);
  await ref.set(
    { lastUpdated: FieldValue.serverTimestamp(), ...patch },
    { merge: true }
  );
  log.info('heartbeat marked', { day, ...patch });
}
