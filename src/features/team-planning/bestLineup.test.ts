import { describe, expect, it } from "vitest";

import { formations } from "@/lib/formations";
import type { Player } from "@/types";

import { buildBestLineupForFormation } from "./bestLineup";

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
  squadRole: "reserve",
  ...overrides,
});

const formationByName = (name: string) => {
  const formation = formations.find((entry) => entry.name === name);
  if (!formation) {
    throw new Error(`Formation not found: ${name}`);
  }
  return formation;
};

describe("buildBestLineupForFormation", () => {
  it("ignores injured, released and expired players", () => {
    const players: Player[] = [
      createPlayer({
        id: "gk-injured",
        position: "GK",
        roles: ["GK"],
        overall: 0.95,
        injuryStatus: "injured",
      }),
      createPlayer({
        id: "gk-released",
        position: "GK",
        roles: ["GK"],
        overall: 0.94,
        contract: {
          expiresAt: "2099-01-01T00:00:00.000Z",
          status: "released",
        },
      }),
      createPlayer({
        id: "gk-expired",
        position: "GK",
        roles: ["GK"],
        overall: 0.93,
        contract: {
          expiresAt: "2000-01-01T00:00:00.000Z",
          status: "active",
        },
      }),
      createPlayer({
        id: "gk-healthy",
        position: "GK",
        roles: ["GK"],
        overall: 0.8,
      }),
      createPlayer({ id: "lb", position: "LB", roles: ["LB"], overall: 0.79 }),
      createPlayer({
        id: "cb-1",
        position: "CB",
        roles: ["CB"],
        overall: 0.78,
      }),
      createPlayer({
        id: "cb-2",
        position: "CB",
        roles: ["CB"],
        overall: 0.77,
      }),
      createPlayer({ id: "rb", position: "RB", roles: ["RB"], overall: 0.76 }),
      createPlayer({ id: "lm", position: "LM", roles: ["LM"], overall: 0.75 }),
      createPlayer({
        id: "cm-1",
        position: "CM",
        roles: ["CM"],
        overall: 0.74,
      }),
      createPlayer({
        id: "cm-2",
        position: "CM",
        roles: ["CM"],
        overall: 0.73,
      }),
      createPlayer({ id: "rm", position: "RM", roles: ["RM"], overall: 0.72 }),
      createPlayer({
        id: "st-1",
        position: "ST",
        roles: ["ST"],
        overall: 0.71,
      }),
      createPlayer({ id: "st-2", position: "ST", roles: ["ST"], overall: 0.7 }),
    ];

    const result = buildBestLineupForFormation(
      players,
      formationByName("4-4-2"),
      {}
    );

    expect(result.assignments).toHaveLength(11);
    expect(
      result.assignments.some(
        (assignment) => assignment.playerId === "gk-injured"
      )
    ).toBe(false);
    expect(
      result.assignments.some(
        (assignment) => assignment.playerId === "gk-released"
      )
    ).toBe(false);
    expect(
      result.assignments.some(
        (assignment) => assignment.playerId === "gk-expired"
      )
    ).toBe(false);
    expect(
      result.assignments.some(
        (assignment) => assignment.playerId === "gk-healthy"
      )
    ).toBe(true);
  });

  it("demotes replaced starters to bench", () => {
    const players: Player[] = [
      createPlayer({
        id: "gk",
        position: "GK",
        roles: ["GK"],
        overall: 0.8,
        squadRole: "starting",
      }),
      createPlayer({
        id: "lb",
        position: "LB",
        roles: ["LB"],
        overall: 0.79,
        squadRole: "starting",
      }),
      createPlayer({
        id: "cb-1",
        position: "CB",
        roles: ["CB"],
        overall: 0.78,
        squadRole: "starting",
      }),
      createPlayer({
        id: "cb-2",
        position: "CB",
        roles: ["CB"],
        overall: 0.77,
        squadRole: "starting",
      }),
      createPlayer({
        id: "rb",
        position: "RB",
        roles: ["RB"],
        overall: 0.76,
        squadRole: "starting",
      }),
      createPlayer({
        id: "lm",
        position: "LM",
        roles: ["LM"],
        overall: 0.75,
        squadRole: "starting",
      }),
      createPlayer({
        id: "cm-1",
        position: "CM",
        roles: ["CM"],
        overall: 0.74,
        squadRole: "starting",
      }),
      createPlayer({
        id: "cm-2",
        position: "CM",
        roles: ["CM"],
        overall: 0.73,
        squadRole: "starting",
      }),
      createPlayer({
        id: "rm",
        position: "RM",
        roles: ["RM"],
        overall: 0.72,
        squadRole: "starting",
      }),
      createPlayer({
        id: "old-st-1",
        position: "ST",
        roles: ["ST"],
        overall: 0.61,
        squadRole: "starting",
      }),
      createPlayer({
        id: "old-st-2",
        position: "ST",
        roles: ["ST"],
        overall: 0.6,
        squadRole: "starting",
      }),
      createPlayer({
        id: "new-st-1",
        position: "ST",
        roles: ["ST"],
        overall: 0.91,
        squadRole: "bench",
      }),
      createPlayer({
        id: "new-st-2",
        position: "ST",
        roles: ["ST"],
        overall: 0.9,
        squadRole: "bench",
      }),
    ];

    const result = buildBestLineupForFormation(
      players,
      formationByName("4-4-2"),
      {}
    );

    const oldStarterOne = result.players.find(
      (player) => player.id === "old-st-1"
    );
    const oldStarterTwo = result.players.find(
      (player) => player.id === "old-st-2"
    );
    const newStarterOne = result.players.find(
      (player) => player.id === "new-st-1"
    );
    const newStarterTwo = result.players.find(
      (player) => player.id === "new-st-2"
    );

    expect(oldStarterOne?.squadRole).toBe("bench");
    expect(oldStarterTwo?.squadRole).toBe("bench");
    expect(newStarterOne?.squadRole).toBe("starting");
    expect(newStarterTwo?.squadRole).toBe("starting");
  });

  it("uses strongest remaining unused player as fallback when slot specialist is missing", () => {
    const players: Player[] = [
      createPlayer({ id: "gk", position: "GK", roles: ["GK"], overall: 0.8 }),
      createPlayer({ id: "lb", position: "LB", roles: ["LB"], overall: 0.79 }),
      createPlayer({
        id: "cb-1",
        position: "CB",
        roles: ["CB"],
        overall: 0.78,
      }),
      createPlayer({
        id: "cb-2",
        position: "CB",
        roles: ["CB"],
        overall: 0.77,
      }),
      createPlayer({ id: "rb", position: "RB", roles: ["RB"], overall: 0.76 }),
      createPlayer({ id: "lm", position: "LM", roles: ["LM"], overall: 0.75 }),
      createPlayer({
        id: "cm-1",
        position: "CM",
        roles: ["CM"],
        overall: 0.74,
      }),
      createPlayer({
        id: "cm-2",
        position: "CM",
        roles: ["CM"],
        overall: 0.73,
      }),
      createPlayer({ id: "rm", position: "RM", roles: ["RM"], overall: 0.72 }),
      createPlayer({ id: "st", position: "ST", roles: ["ST"], overall: 0.7 }),
      createPlayer({
        id: "best-fallback",
        position: "CM",
        roles: ["CM"],
        overall: 0.95,
      }),
      createPlayer({
        id: "low-fallback",
        position: "CM",
        roles: ["CM"],
        overall: 0.63,
      }),
    ];

    const result = buildBestLineupForFormation(
      players,
      formationByName("4-4-2"),
      {}
    );

    const fallbackAssignment = result.assignments.find(
      (assignment) => assignment.playerId === "best-fallback"
    );
    const remainingFallbackAssignment = result.assignments.find(
      (assignment) => assignment.playerId === "cm-2"
    );
    const lowFallbackAssignment = result.assignments.find(
      (assignment) => assignment.playerId === "low-fallback"
    );

    expect(fallbackAssignment).toBeTruthy();
    expect(lowFallbackAssignment).toBeFalsy();
    expect(remainingFallbackAssignment?.position).toBe("ST");
  });
});
