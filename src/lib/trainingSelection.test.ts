import { describe, expect, it } from 'vitest';
import {
  isSuppressedSelectionTap,
  toggleSelectionItem,
  type TrainingSelectionTapGuard,
} from './trainingSelection';

describe('toggleSelectionItem', () => {
  it('adds an item when it is not selected yet', () => {
    expect(toggleSelectionItem([{ id: '1' }], { id: '2' })).toEqual([
      { id: '1' },
      { id: '2' },
    ]);
  });

  it('removes an item when it is already selected', () => {
    expect(toggleSelectionItem([{ id: '1' }, { id: '2' }], { id: '2' })).toEqual([
      { id: '1' },
    ]);
  });
});

describe('isSuppressedSelectionTap', () => {
  it('matches the same type and id', () => {
    const guard: TrainingSelectionTapGuard = { type: 'training', id: 'passing' };
    expect(isSuppressedSelectionTap(guard, 'training', 'passing')).toBe(true);
  });

  it('ignores different targets', () => {
    const guard: TrainingSelectionTapGuard = { type: 'player', id: '10' };
    expect(isSuppressedSelectionTap(guard, 'training', '10')).toBe(false);
    expect(isSuppressedSelectionTap(guard, 'player', '11')).toBe(false);
  });
});
