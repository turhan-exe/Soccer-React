export const TOUCH_DRAG_LONG_PRESS_MS = 220;
export const TOUCH_DRAG_CANCEL_DISTANCE_PX = 8;
export const TOUCH_DRAG_START_DISTANCE_PX = 10;

export type TouchDragPoint = {
  x: number;
  y: number;
};

export function getTouchDragDistance(
  start: TouchDragPoint,
  current: TouchDragPoint,
): number {
  return Math.hypot(current.x - start.x, current.y - start.y);
}

export function shouldCancelPendingTouchDrag(distance: number): boolean {
  return distance >= TOUCH_DRAG_CANCEL_DISTANCE_PX;
}

export function shouldStartActiveTouchDrag(distance: number): boolean {
  return distance >= TOUCH_DRAG_START_DISTANCE_PX;
}
