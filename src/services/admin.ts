import {
     collection,
     getDocs,
     doc,
     deleteDoc,
     writeBatch,
     query,
     where,
     getDoc,
     updateDoc,
     setDoc
} from 'firebase/firestore';
import { db, auth } from './firebase'; // Ensure auth is imported
import { League } from '@/types';

/**
 * Liglerdeki kapasite fazlası botları temizler.
 * Her lig için:
 * 1. Slotları ve Puan Durumunu çeker.
 * 2. İnsan ve Bot sayılarını belirler.
 * 3. Eğer toplam > kapasite ise, fazlalık botları siler.
 */
export const repairLeagueCapacities = async (): Promise<{ updatedLeagues: string[], removedBots: number }> => {
     console.log('[Repair] Starting repair process...');

     if (!auth.currentUser) {
          console.error('[Repair] No authenticated user found!');
          throw new Error('Authenticated user required for this operation.');
     }
     console.log(`[Repair] Authenticated user: ${auth.currentUser.uid}`);

     try {
          const leaguesSnap = await getDocs(collection(db, 'leagues'));
          console.log(`[Repair] Found ${leaguesSnap.size} leagues.`);

          let removedCount = 0;
          const updatedLeagues: string[] = [];

          // Lig verisini işle
          for (const leagueDoc of leaguesSnap.docs) {
               const leagueId = leagueDoc.id;
               const leagueData = leagueDoc.data() as League;
               const capacity = Number(leagueData.capacity) || 15;

               // Slotları çek
               const slotsRef = collection(db, 'leagues', leagueId, 'slots');
               const slotsSnap = await getDocs(slotsRef);
               const slots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() as any, _source: 'slot' }));

               // Standings çek
               const standingsRef = collection(db, 'leagues', leagueId, 'standings');
               const standingsSnap = await getDocs(standingsRef);
               const standings = standingsSnap.docs.map(d => ({ id: d.id, ...d.data() as any, _source: 'standing' }));

               // Benzersiz Takımları Birleştir (Slot ID veya Team ID veya Standings ID)
               // Hedef: Gerçek takım sayısını bulmak.
               // Map kullanarak unique ID'leri toplayalım.
               const uniqueTeams = new Map<string, any>();

               // 1. Önce slotları ekle
               slots.forEach(s => {
                    // Anahtar: teamId varsa teamId, yoksa slotId
                    const key = s.teamId || s.id;
                    uniqueTeams.set(key, { ...s, isSlot: true });
               });

               // 2. Standings'i ekle
               standings.forEach(s => {
                    const key = s.teamId || s.id; // TeamId veya document ID
                    if (!uniqueTeams.has(key)) {
                         uniqueTeams.set(key, { ...s, isStandingOnly: true });
                    } else {
                         // Mevcut kaydı güncelle (standing var diye işaretle)
                         const existing = uniqueTeams.get(key);
                         uniqueTeams.set(key, { ...existing, isStanding: true });
                    }
               });

               const allTeams = Array.from(uniqueTeams.values());


               // İnsanları ve Botları ayır
               const humans = allTeams.filter(s => {
                    const isHumanType = s.type === 'human';
                    const teamId = s.teamId || s.id || '';
                    // 'botteam-' ile başlayanlar kesinlikle bottur, type ne olursa olsun.
                    if (teamId.startsWith('botteam-') || teamId.startsWith('bot-')) return false;

                    return isHumanType || (teamId && !teamId.startsWith('slot-'));
               });

               const bots = allTeams.filter(s => !humans.includes(s));
               const totalCount = allTeams.length;


               console.log(`[Repair] League ${leagueId}: Cap ${capacity} | Total ${totalCount} (Slots: ${slots.length}, Standings: ${standings.length}) | Humans ${humans.length} | Bots ${bots.length}`);

               // --- Duplicate Standings Cleanup ---
               // If there are more standings than unique teams, we likely have duplicates
               if (standings.length > totalCount) {
                    console.log(`[Repair] Detected duplicate standings in league ${leagueId}. Cleaning up...`);
                    const standingsByTeam = new Map<string, any[]>();
                    standings.forEach(s => {
                         const tid = s.teamId || s.id; // fallback
                         if (!standingsByTeam.has(tid)) standingsByTeam.set(tid, []);
                         standingsByTeam.get(tid)?.push(s);
                    });

                    for (const [tid, docs] of standingsByTeam.entries()) {
                         if (docs.length > 1) {
                              // Keep the first one, delete others
                              console.log(`[Repair] Team ${tid} has ${docs.length} standings. Deleting ${docs.length - 1} duplicates.`);
                              // Sort by ID or something to be deterministic? 
                              // Let's just keep the first one in the list for now.
                              const toDelete = docs.slice(1);
                              for (const d of toDelete) {
                                   try {
                                        await deleteDoc(doc(db, 'leagues', leagueId, 'standings', d.id));
                                        removedCount++; // Count these as removals too
                                   } catch (e) {
                                        console.error(`[Repair] Failed to delete duplicate standing ${d.id}`, e);
                                   }
                              }
                         }
                    }
               }


               let finalCount = totalCount;

               if (totalCount > capacity) {
                    const excessCount = totalCount - capacity;

                    // Öncelik: Sadece 'standing' olan (slotu olmayan) hayalet botları sil
                    const ghostBots = bots.filter(b => b.isStandingOnly);
                    const regularBots = bots.filter(b => !b.isStandingOnly);

                    // Silinecekler listesi: Önce hayaletler, yetmezse normal botlar
                    const botsToRemove = [...ghostBots, ...regularBots].slice(0, excessCount);

                    console.log(`[Repair] -> Removing ${botsToRemove.length} excess bots.`);

                    for (const bot of botsToRemove) {
                         try {
                              // Slot'u sil (varsa)
                              if (bot.isSlot || slots.some(s => s.id === bot.id)) {
                                   const slotId = bot.id.startsWith('slot-') ? bot.id : (bot.slotIndex ? `slot-${bot.slotIndex}` : bot.id);
                                   const slotRef = doc(db, 'leagues', leagueId, 'slots', slotId);
                                   await deleteDoc(slotRef);
                              }

                              // Standings'den sil
                              const standingDoc = standingsSnap.docs.find(d => {
                                   const data = d.data();
                                   const botId = bot.id;
                                   return d.id === botId ||
                                        data.teamId === botId ||
                                        (bot.slotIndex && data.slotIndex === bot.slotIndex) ||
                                        d.id === `slot-${bot.slotIndex}`;
                              });

                              if (standingDoc) {
                                   await deleteDoc(standingDoc.ref);
                              }

                              removedCount++;
                         } catch (err) {
                              console.error(`[Repair] Failed to delete bot ${bot.id}:`, err);
                         }
                    }
                    finalCount = totalCount - botsToRemove.length;
               } else if (totalCount < capacity) {
                    // Refill with bots
                    const needed = capacity - totalCount;
                    console.log(`[Repair] League ${leagueId} is under capacity by ${needed}. Refilling...`);

                    // Find available slot indexes
                    const takenSlots = new Set<number>();
                    slots.forEach(s => { if (typeof s.slotIndex === 'number') takenSlots.add(s.slotIndex); });
                    standings.forEach(s => { if (typeof s.slotIndex === 'number') takenSlots.add(s.slotIndex); });

                    let addedCount = 0;
                    for (let i = 0; i < capacity; i++) {
                         if (addedCount >= needed) break;
                         if (!takenSlots.has(i)) {
                              const botId = `bot-${Date.now()}-${i}`;
                              const teamId = `botteam-${Date.now()}-${i}`;
                              const slotRef = doc(db, 'leagues', leagueId, 'slots', `slot-${i}`);
                              const standingRef = doc(db, 'leagues', leagueId, 'standings', teamId);

                              const botData = {
                                   type: 'bot',
                                   teamId,
                                   slotIndex: i,
                                   createdAt: new Date(),
                                   updatedAt: new Date(),
                                   botId: i
                              };

                              const standingData = {
                                   teamId,
                                   name: `Bot ${i}`,
                                   slotIndex: i,
                                   P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0
                              };

                              await setDoc(slotRef, botData);
                              await setDoc(standingRef, standingData);

                              takenSlots.add(i);
                              addedCount++;
                         }
                    }
                    finalCount = totalCount + addedCount;
                    console.log(`[Repair] Added ${addedCount} bots to League ${leagueId}.`);
               }


               // --- Repair Missing Standings (Fix for "15/15 but empty view") ---
               // If a team is in slots but not in standings, the UI won't show it. We must create the standing.
               const missingStandings = allTeams.filter(t => t.isSlot && !t.isStanding);
               if (missingStandings.length > 0) {
                    console.log(`[Repair] Found ${missingStandings.length} teams with slots but missing standings in league ${leagueId}. Repairing...`);

                    for (const t of missingStandings) {
                         const tid = t.teamId || t.id;
                         const standingRef = doc(db, 'leagues', leagueId, 'standings', tid);

                         let name = `Bot ${t.slotIndex}`;
                         // Try to resolve name if Human
                         if (t.type === 'human' || (t.teamId && !t.teamId.startsWith('bot'))) {
                              try {
                                   const teamDoc = await getDoc(doc(db, 'teams', tid));
                                   if (teamDoc.exists()) {
                                        const td = teamDoc.data();
                                        if (td?.name) name = td.name;
                                   }
                              } catch (e) { console.warn('Name resolve failed', e); }
                         }

                         const standingData = {
                              teamId: tid,
                              name: name,
                              slotIndex: typeof t.slotIndex === 'number' ? t.slotIndex : -1,
                              P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0
                         };

                         try {
                              await setDoc(standingRef, standingData);
                              // Update our local count just in case, though it shouldn't change totalCount
                         } catch (e) {
                              console.error(`[Repair] Failed to create standing for ${tid}`, e);
                         }
                    }
               }

               // Metadata sync check
               if (leagueData.teamCount !== finalCount) {
                    await updateDoc(leagueDoc.ref, { teamCount: finalCount });
                    console.log(`[Repair] Synced league ${leagueId} teamCount: ${leagueData.teamCount} -> ${finalCount}`);
                    updatedLeagues.push(leagueId);
               }
          }
          console.log(`[Repair] Process complete. Removed ${removedCount} bots.`);
          return { updatedLeagues, removedBots: removedCount };

     } catch (error) {
          console.error('[Repair] Fatal error during execution:', error);
          throw error;
     }
};
