import { describe, expect, it } from "vitest";

import { resolveFormationSlotZoneId, resolveSlotZoneId } from "./slotZones";

describe("resolveFormationSlotZoneId", () => {
  it("keeps default 4-4-2 centre back slots in the stopper band", () => {
    expect(
      resolveFormationSlotZoneId({
        position: "CB",
        x: 35,
        y: 65,
        slotSource: "template",
      })
    ).toBe("stoper sol");
    expect(
      resolveFormationSlotZoneId({
        position: "CB",
        x: 65,
        y: 65,
        slotSource: "template",
      })
    ).toBe("stoper sağ");
  });

  it("keeps default 4-2-3-1 pivot slots in holding midfield lanes", () => {
    expect(
      resolveFormationSlotZoneId({
        position: "CM",
        x: 40,
        y: 55,
        slotSource: "template",
      })
    ).toBe("defansif orta saha sol");
    expect(
      resolveFormationSlotZoneId({
        position: "CM",
        x: 60,
        y: 55,
        slotSource: "template",
      })
    ).toBe("defansif orta saha sağ");
  });

  it("restores gizli forvet only for truly manual drops in the narrow band", () => {
    expect(
      resolveFormationSlotZoneId({
        position: "ST",
        x: 50,
        y: 28,
        slotSource: "manual",
      })
    ).toBe("gizli forvet");
  });

  it("normalizes legacy mojibake zone ids from persisted formations", () => {
    expect(
      resolveFormationSlotZoneId({
        position: "RB",
        x: 20,
        y: 85,
        zoneId: "saÄŸ bek",
      })
    ).toBe("sağ bek");
  });
  it("prefers explicit zone ids even for manual slot renders", () => {
    expect(
      resolveFormationSlotZoneId({
        position: "CM",
        x: 48,
        y: 58,
        slotSource: "manual",
        zoneId: "merkez orta saha",
      })
    ).toBe("merkez orta saha");
  });
});

describe("resolveSlotZoneId", () => {
  it("keeps 4-4-2 centre midfielders in merkez orta saha", () => {
    expect(resolveSlotZoneId({ position: "CM", x: 40, y: 45 })).toBe(
      "merkez orta saha"
    );
    expect(resolveSlotZoneId({ position: "CM", x: 60, y: 45 })).toBe(
      "merkez orta saha"
    );
  });
});
