import { describe, expect, it } from "vitest";

import { buildFreeFormationAssignments, hasFreeFormationOverlap } from "./freeFormation";

const createPlayer = (id: string, position: string) => ({
  id,
  position: position as any,
});

describe("freeFormation", () => {
  it("allows multiple outfield players in the striker band without slot caps", () => {
    const assignments = buildFreeFormationAssignments({
      formation: "4-4-2",
      players: [
        createPlayer("gk", "GK"),
        createPlayer("a", "ST"),
        createPlayer("b", "ST"),
        createPlayer("c", "CAM"),
      ],
      starters: ["gk", "a", "b", "c"],
      manualLayout: {
        gk: { x: 45, y: 95, position: "GK", zoneId: "kaleci" },
        a: { x: 40, y: 18, position: "ST", zoneId: "santrafor" },
        b: { x: 50, y: 16, position: "ST", zoneId: "santrafor" },
        c: { x: 60, y: 18, position: "ST", zoneId: "santrafor" },
      },
    });

    expect(assignments).toHaveLength(4);
    expect(assignments.slice(1).every((assignment) => assignment.zoneId === "santrafor")).toBe(true);
    expect(assignments.map((assignment) => assignment.slotIndex)).toEqual([0, 1, 2, 3]);
  });

  it("derives shadow striker from coordinates and keeps coarse position as CAM", () => {
    const assignments = buildFreeFormationAssignments({
      formation: "4-2-3-1",
      players: [createPlayer("p1", "ST")],
      starters: ["p1"],
      manualLayout: {
        p1: { x: 50, y: 28, position: "ST" as any },
      },
    });

    expect(assignments[0]?.zoneId).toBe("gizli forvet");
    expect(assignments[0]?.position).toBe("CAM");
  });

  it("flags overlapping players as invalid", () => {
    expect(
      hasFreeFormationOverlap([
        { playerId: "a", slotIndex: 0, x: 45, y: 20, position: "ST" as any, zoneId: "santrafor" },
        { playerId: "b", slotIndex: 1, x: 46, y: 21, position: "ST" as any, zoneId: "santrafor" },
      ]),
    ).toBe(true);
  });
});
