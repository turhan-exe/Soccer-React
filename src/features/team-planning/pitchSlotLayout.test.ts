import { describe, expect, it } from "vitest";

import { formations } from "@/lib/formations";
import type { Player } from "@/types";

import {
  buildFormationSlotTemplates,
  buildStableManualLayoutMap,
  buildStableSlotAssignments,
  resolvePitchDropSlot,
  resolveSafeManualPosition,
} from "./pitchSlotLayout";

const defaultAttributes: Player["attributes"] = {
  strength: 0.7,
  acceleration: 0.7,
  topSpeed: 0.7,
  dribbleSpeed: 0.7,
  jump: 0.7,
  tackling: 0.7,
  ballKeeping: 0.7,
  passing: 0.7,
  longBall: 0.7,
  agility: 0.7,
  shooting: 0.7,
  shootPower: 0.7,
  positioning: 0.7,
  reaction: 0.7,
  ballControl: 0.7,
};

const createPlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "player-1",
  name: "Oyuncu 1",
  position: "CM",
  roles: ["CM"],
  overall: 0.7,
  potential: 0.85,
  attributes: defaultAttributes,
  age: 24,
  height: 180,
  weight: 76,
  health: 1,
  condition: 1,
  motivation: 1,
  injuryStatus: "healthy",
  squadRole: "starting",
  ...overrides,
});

const formationByName = (name: string) => {
  const formation = formations.find((entry) => entry.name === name);
  if (!formation) {
    throw new Error(`Formation not found: ${name}`);
  }
  return formation;
};

describe("pitchSlotLayout", () => {
  it("keeps unrelated same-position players on their original slots", () => {
    const slots = buildFormationSlotTemplates(formationByName("4-4-2"));
    const players: Player[] = [
      createPlayer({ id: "gk", position: "GK", roles: ["GK"] }),
      createPlayer({ id: "lb", position: "LB", roles: ["LB"] }),
      createPlayer({ id: "cb-left", position: "CB", roles: ["CB"] }),
      createPlayer({ id: "cb-right", position: "CB", roles: ["CB"] }),
      createPlayer({ id: "rb", position: "RB", roles: ["RB"] }),
      createPlayer({ id: "lm", position: "LM", roles: ["LM"] }),
      createPlayer({ id: "cm-left", position: "CM", roles: ["CM"] }),
      createPlayer({ id: "cm-right", position: "CM", roles: ["CM"] }),
      createPlayer({ id: "rm", position: "RM", roles: ["RM"] }),
      createPlayer({ id: "st-left", position: "ST", roles: ["ST"] }),
      createPlayer({ id: "st-right", position: "ST", roles: ["ST"] }),
    ];

    const baselineAssignments = buildStableSlotAssignments({
      slots,
      players,
    });
    const movedAssignments = buildStableSlotAssignments({
      slots,
      players,
      manualLayout: {
        "st-left": {
          x: slots[10]!.x,
          y: slots[10]!.y,
          position: slots[10]!.position,
          slotIndex: slots[10]!.slotIndex,
        },
      },
    });

    const baselineByPlayerId = new Map(
      baselineAssignments.map((assignment) => [
        assignment.player.id,
        assignment.slot.slotIndex,
      ] as const)
    );
    const movedByPlayerId = new Map(
      movedAssignments.map((assignment) => [
        assignment.player.id,
        assignment.slot.slotIndex,
      ] as const)
    );

    expect(movedByPlayerId.get("cm-left")).toBe(baselineByPlayerId.get("cm-left"));
    expect(movedByPlayerId.get("cm-right")).toBe(
      baselineByPlayerId.get("cm-right")
    );
  });

  it("resolves duplicate slot claims without placing two players on the same slot", () => {
    const slots = buildFormationSlotTemplates(formationByName("4-4-2")).filter(
      (slot) => slot.position === "CM"
    );
    const players: Player[] = [
      createPlayer({ id: "cm-a", position: "CM", roles: ["CM"] }),
      createPlayer({ id: "cm-b", position: "CM", roles: ["CM"] }),
    ];

    const assignments = buildStableSlotAssignments({
      slots,
      players,
      manualLayout: {
        "cm-a": {
          x: slots[0]!.x,
          y: slots[0]!.y,
          position: "CM",
          slotIndex: slots[0]!.slotIndex,
        },
        "cm-b": {
          x: slots[0]!.x,
          y: slots[0]!.y,
          position: "CM",
          slotIndex: slots[0]!.slotIndex,
        },
      },
    });

    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.slot.slotIndex)).size).toBe(
      2
    );
  });

  it("builds a fully slot-indexed layout map for every starter", () => {
    const slots = buildFormationSlotTemplates(formationByName("4-4-2")).filter(
      (slot) => slot.position === "CM"
    );
    const players: Player[] = [
      createPlayer({ id: "cm-a", position: "CM", roles: ["CM"] }),
      createPlayer({ id: "cm-b", position: "CM", roles: ["CM"] }),
    ];

    const layout = buildStableManualLayoutMap({
      slots,
      players,
      manualLayout: {
        "cm-a": {
          x: slots[0]!.x,
          y: slots[0]!.y,
          position: "CM",
          slotIndex: slots[0]!.slotIndex,
        },
      },
    });

    expect(Object.keys(layout)).toEqual(["cm-a", "cm-b"]);
    expect(layout["cm-a"]?.slotIndex).toBeDefined();
    expect(layout["cm-b"]?.slotIndex).toBeDefined();
  });

  it("clamps and separates manual coordinates inside a slot", () => {
    const slot = buildFormationSlotTemplates(formationByName("4-4-2"))[6]!;
    const resolved = resolveSafeManualPosition({
      slot,
      desired: { x: 999, y: -999 },
      occupiedPoints: [{ x: slot.x, y: slot.y }],
    });

    expect(resolved.x).toBeGreaterThanOrEqual(slot.rect!.top);
    expect(resolved.x).toBeLessThanOrEqual(slot.rect!.top + slot.rect!.height);
    expect(resolved.y).toBeGreaterThanOrEqual(
      100 - (slot.rect!.left + slot.rect!.width)
    );
    expect(resolved.y).toBeLessThanOrEqual(100 - slot.rect!.left);
    expect(Math.abs(resolved.x - slot.x) + Math.abs(resolved.y - slot.y)).toBeGreaterThan(
      0
    );
  });

  it("falls back to the current slot when a pitch drop misses every slot area", () => {
    const slots = buildFormationSlotTemplates(formationByName("4-4-2"));
    const resolved = resolvePitchDropSlot({
      slots,
      coordinates: { x: 2, y: 2 },
      fallbackSlotIndex: slots[6]!.slotIndex,
    });

    expect(resolved?.slotIndex).toBe(slots[6]!.slotIndex);
  });
});
