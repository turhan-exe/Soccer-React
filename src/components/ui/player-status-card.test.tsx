import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Player } from '@/types';

import { PlayerStatusCard } from './player-status-card';
import { TooltipProvider } from './tooltip';

const player: Player = {
  id: 'player-1',
  name: 'Test Stoper',
  position: 'CB',
  roles: ['CB', 'RB'],
  overall: 0.78,
  potential: 0.84,
  attributes: {
    strength: 0.7,
    acceleration: 0.6,
    topSpeed: 0.58,
    dribbleSpeed: 0.51,
    jump: 0.66,
    tackling: 0.74,
    ballKeeping: 0.49,
    passing: 0.54,
    longBall: 0.57,
    agility: 0.52,
    shooting: 0.38,
    shootPower: 0.46,
    positioning: 0.71,
    reaction: 0.69,
    ballControl: 0.55,
  },
  age: 24,
  height: 188,
  weight: 81,
  health: 0.95,
  condition: 0.81,
  motivation: 0.88,
  injuryStatus: 'healthy',
  squadRole: 'starting',
};

describe('PlayerStatusCard', () => {
  it('renders full Turkish label in summary and short Turkish labels in role badges', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PlayerStatusCard player={player} />
      </TooltipProvider>,
    );

    expect(html).toContain('Stoper');
    expect(html).toContain('STP');
    expect(html).toContain('SĞB');
    expect(html).not.toContain('>CB<');
    expect(html).not.toContain('>RB<');
  });
});
