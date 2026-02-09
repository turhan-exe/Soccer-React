
import { resolveZoneId } from './src/features/team-planning/slotZones';
import { canonicalPosition } from './src/features/team-planning/teamPlanningUtils';

const testLM = () => {
     const pos = 'LM';
     const canon = canonicalPosition(pos);
     console.log(`canonicalPosition('LM') = ${canon}`);

     const slot = {
          slotIndex: 0,
          position: 'LM' as any,
          x: 15,
          y: 45,
          player: null
     };

     const zone = resolveZoneId(slot);
     console.log(`resolveZoneId({ position: 'LM', x: 15, y: 45 }) = ${zone}`);

     // Test 'LW' as well from snippet
     const slotLW = {
          slotIndex: 0,
          position: 'LW' as any,
          x: 20,
          y: 35, // 4-2-3-1 LW coord
          player: null
     };
     console.log(`resolveZoneId({ position: 'LW', x: 20, y: 35 }) = ${resolveZoneId(slotLW)}`);

};

testLM();
