import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Player, TransferListing } from '@/types';

import { MarketList } from './MarketList';

const player: Player = {
  id: 'player-1',
  name: 'Transfer Oyuncusu',
  position: 'CB',
  roles: ['CB'],
  overall: 0.76,
  potential: 0.82,
  attributes: {
    strength: 0.68,
    acceleration: 0.57,
    topSpeed: 0.59,
    dribbleSpeed: 0.46,
    jump: 0.7,
    tackling: 0.74,
    ballKeeping: 0.45,
    passing: 0.5,
    longBall: 0.54,
    agility: 0.49,
    shooting: 0.32,
    shootPower: 0.41,
    positioning: 0.71,
    reaction: 0.66,
    ballControl: 0.52,
  },
  age: 25,
  height: 186,
  weight: 79,
  health: 1,
  condition: 0.88,
  motivation: 0.84,
  injuryStatus: 'healthy',
  squadRole: 'reserve',
};

const listing: TransferListing = {
  id: 'listing-1',
  playerId: player.id,
  player,
  price: 125000,
  sellerId: 'seller-1',
  sellerTeamName: 'Rakip FC',
  status: 'available',
  overall: player.overall,
  pos: player.position,
};

describe('MarketList', () => {
  it('renders short Turkish position labels in the desktop list', () => {
    const html = renderToStaticMarkup(
      <MarketList
        listings={[listing]}
        isLoading={false}
        teamBudget={200000}
        purchasingId=""
        onPurchase={() => {}}
        currentSort="overall-desc"
        onSortChange={() => {}}
      />,
    );

    expect(html).toContain('STP');
    expect(html).not.toContain('>CB<');
  });
});
