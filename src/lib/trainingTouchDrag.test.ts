import { describe, expect, it } from 'vitest';
import {
  TOUCH_DRAG_CANCEL_DISTANCE_PX,
  TOUCH_DRAG_LONG_PRESS_MS,
  TOUCH_DRAG_START_DISTANCE_PX,
  getTouchDragDistance,
  shouldCancelPendingTouchDrag,
  shouldStartActiveTouchDrag,
} from './trainingTouchDrag';

describe('trainingTouchDrag', () => {
  it('exposes the configured thresholds', () => {
    expect(TOUCH_DRAG_LONG_PRESS_MS).toBe(220);
    expect(TOUCH_DRAG_CANCEL_DISTANCE_PX).toBe(8);
    expect(TOUCH_DRAG_START_DISTANCE_PX).toBe(10);
  });

  it('measures pointer travel distance', () => {
    expect(
      getTouchDragDistance({ x: 10, y: 20 }, { x: 16, y: 28 }),
    ).toBeCloseTo(10);
  });

  it('cancels pending long press at the pending threshold', () => {
    expect(shouldCancelPendingTouchDrag(7.99)).toBe(false);
    expect(shouldCancelPendingTouchDrag(8)).toBe(true);
  });

  it('starts active drag at the drag threshold', () => {
    expect(shouldStartActiveTouchDrag(9.99)).toBe(false);
    expect(shouldStartActiveTouchDrag(10)).toBe(true);
  });
});
