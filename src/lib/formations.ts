import { Player } from "@/types";

export interface FormationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FormationPosition {
  slotKey: string;
  position: Player["position"];
  x: number;
  y: number;
  zoneId?: string;
  rect: FormationRect;
}

export interface Formation {
  name: string;
  positions: FormationPosition[];
}

type FormationSlotSeed = Omit<FormationPosition, "slotKey" | "rect">;

const SLOT_RECT_DIMENSIONS: Record<
  Player["position"],
  { width: number; height: number }
> = {
  GK: { width: 14, height: 18 },
  CB: { width: 16, height: 18 },
  LB: { width: 18, height: 16 },
  RB: { width: 18, height: 16 },
  CM: { width: 16, height: 18 },
  LM: { width: 18, height: 16 },
  RM: { width: 18, height: 16 },
  CAM: { width: 16, height: 18 },
  LW: { width: 18, height: 16 },
  RW: { width: 18, height: 16 },
  ST: { width: 16, height: 18 },
};

const clampRectEdge = (value: number, size: number): number =>
  Math.max(0, Math.min(100 - size, value));

export const buildFormationSlotRect = (
  position: Player["position"],
  x: number,
  y: number
): FormationRect => {
  const dimensions = SLOT_RECT_DIMENSIONS[position] ?? SLOT_RECT_DIMENSIONS.CM;
  const left = clampRectEdge(100 - y - dimensions.width / 2, dimensions.width);
  const top = clampRectEdge(x - dimensions.height / 2, dimensions.height);

  return {
    left,
    top,
    width: dimensions.width,
    height: dimensions.height,
  };
};

const createFormation = (
  name: string,
  slots: FormationSlotSeed[]
): Formation => ({
  name,
  positions: slots.map((slot, index) => ({
    ...slot,
    slotKey: `${name}-${index}-${slot.position.toLowerCase()}`,
    rect: buildFormationSlotRect(slot.position, slot.x, slot.y),
  })),
});

export const formations: Formation[] = [
  createFormation("4-4-2", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 45 },
    { position: "CM", x: 40, y: 45 },
    { position: "CM", x: 60, y: 45 },
    { position: "RM", x: 85, y: 45 },
    { position: "ST", x: 40, y: 20 },
    { position: "ST", x: 60, y: 20 },
  ]),
  createFormation("4-3-3", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 30, y: 45 },
    { position: "CM", x: 50, y: 40 },
    { position: "CM", x: 70, y: 45 },
    { position: "LW", x: 20, y: 25 },
    { position: "ST", x: 50, y: 15 },
    { position: "RW", x: 80, y: 25 },
  ]),
  createFormation("3-5-2", [
    { position: "GK", x: 45, y: 95 },
    { position: "CB", x: 30, y: 70 },
    { position: "CB", x: 50, y: 65 },
    { position: "CB", x: 70, y: 70 },
    { position: "LM", x: 10, y: 45 },
    { position: "CM", x: 30, y: 45 },
    { position: "CM", x: 50, y: 40 },
    { position: "CM", x: 70, y: 45 },
    { position: "RM", x: 90, y: 45 },
    { position: "ST", x: 40, y: 20 },
    { position: "ST", x: 60, y: 20 },
  ]),
  createFormation("4-5-1", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 50 },
    { position: "CM", x: 35, y: 50 },
    { position: "CAM", x: 50, y: 45 },
    { position: "CM", x: 65, y: 50 },
    { position: "RM", x: 85, y: 50 },
    { position: "ST", x: 50, y: 20 },
  ]),
  createFormation("4-2-3-1", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 40, y: 55 },
    { position: "CM", x: 60, y: 55 },
    { position: "LW", x: 20, y: 35 },
    { position: "CAM", x: 50, y: 35 },
    { position: "RW", x: 80, y: 35 },
    { position: "ST", x: 50, y: 20 },
  ]),
  createFormation("5-3-2", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 10, y: 70 },
    { position: "CB", x: 30, y: 65 },
    { position: "CB", x: 50, y: 60 },
    { position: "CB", x: 70, y: 65 },
    { position: "RB", x: 90, y: 70 },
    { position: "CM", x: 35, y: 45 },
    { position: "CM", x: 50, y: 40 },
    { position: "CM", x: 65, y: 45 },
    { position: "ST", x: 40, y: 20 },
    { position: "ST", x: 60, y: 20 },
  ]),
  createFormation("5-4-1", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 10, y: 70 },
    { position: "CB", x: 30, y: 65 },
    { position: "CB", x: 50, y: 60 },
    { position: "CB", x: 70, y: 65 },
    { position: "RB", x: 90, y: 70 },
    { position: "LM", x: 20, y: 50 },
    { position: "CM", x: 40, y: 50 },
    { position: "CM", x: 60, y: 50 },
    { position: "RM", x: 80, y: 50 },
    { position: "ST", x: 50, y: 20 },
  ]),
  createFormation("3-4-3", [
    { position: "GK", x: 45, y: 95 },
    { position: "CB", x: 30, y: 70 },
    { position: "CB", x: 50, y: 65 },
    { position: "CB", x: 70, y: 70 },
    { position: "LM", x: 10, y: 50 },
    { position: "CM", x: 40, y: 50 },
    { position: "CM", x: 60, y: 50 },
    { position: "RM", x: 90, y: 50 },
    { position: "LW", x: 20, y: 25 },
    { position: "ST", x: 50, y: 15 },
    { position: "RW", x: 80, y: 25 },
  ]),
  createFormation("4-1-4-1", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 50, y: 55 },
    { position: "LM", x: 15, y: 40 },
    { position: "CM", x: 35, y: 40 },
    { position: "CM", x: 65, y: 40 },
    { position: "RM", x: 85, y: 40 },
    { position: "ST", x: 50, y: 20 },
  ]),
  createFormation("4-4-1-1", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 50 },
    { position: "CM", x: 40, y: 50 },
    { position: "CM", x: 60, y: 50 },
    { position: "RM", x: 85, y: 50 },
    { position: "CAM", x: 50, y: 35 },
    { position: "ST", x: 50, y: 20 },
  ]),
  createFormation("3-4-1-2", [
    { position: "GK", x: 45, y: 95 },
    { position: "CB", x: 30, y: 70 },
    { position: "CB", x: 50, y: 65 },
    { position: "CB", x: 70, y: 70 },
    { position: "LM", x: 10, y: 50 },
    { position: "CM", x: 40, y: 50 },
    { position: "CM", x: 60, y: 50 },
    { position: "RM", x: 90, y: 50 },
    { position: "CAM", x: 50, y: 35 },
    { position: "ST", x: 40, y: 20 },
    { position: "ST", x: 60, y: 20 },
  ]),
  createFormation("4-3-2-1", [
    { position: "GK", x: 45, y: 95 },
    { position: "LB", x: 15, y: 70 },
    { position: "CB", x: 35, y: 65 },
    { position: "CB", x: 65, y: 65 },
    { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 30, y: 55 },
    { position: "CM", x: 50, y: 60 },
    { position: "CM", x: 70, y: 55 },
    { position: "CAM", x: 40, y: 35 },
    { position: "CAM", x: 60, y: 35 },
    { position: "ST", x: 50, y: 20 },
  ]),
];
