import { describe, expect, it } from "vitest";
import {
  buildRewardedMatchEntryAccessDocId,
  isRewardedMatchEntryAccessActive,
  resolveRewardedMatchEntryRequirement,
} from "./rewardedMatchEntry.js";

describe("rewardedMatchEntry helpers", () => {
  it("builds deterministic grant ids", () => {
    expect(buildRewardedMatchEntryAccessDocId("u1", "friendly", "req1")).toBe(
      "u1__friendly__req1",
    );
  });

  it("detects active grants by expiry", () => {
    const nowMs = Date.parse("2026-04-19T12:00:00.000Z");
    expect(
      isRewardedMatchEntryAccessActive(
        { expiresAt: { toMillis: () => nowMs + 1 } },
        nowMs,
      ),
    ).toBe(true);
    expect(
      isRewardedMatchEntryAccessActive(
        { expiresAt: { toMillis: () => nowMs } },
        nowMs,
      ),
    ).toBe(false);
  });

  it("requires grants only for player live entry targets", () => {
    expect(
      resolveRewardedMatchEntryRequirement(
        { mode: "friendly", friendlyRequestId: "req-1" },
        "player",
      ),
    ).toEqual({ matchKind: "friendly", targetId: "req-1" });
    expect(
      resolveRewardedMatchEntryRequirement(
        { mode: "league", fixtureId: "fx-1" },
        "player",
      ),
    ).toEqual({ matchKind: "league", targetId: "fx-1" });
    expect(
      resolveRewardedMatchEntryRequirement(
        { mode: "league", fixtureId: "fx-1" },
        "spectator",
      ),
    ).toBeNull();
  });
});
