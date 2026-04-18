export function buildRewardedMatchEntryAccessDocId(uid, matchKind, targetId) {
  return `${uid}__${matchKind}__${targetId}`;
}

export function toRewardedMatchEntryExpiresAtMs(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (value && typeof value === "object" && typeof value.toMillis === "function") {
    try {
      return Number(value.toMillis());
    } catch {
      return null;
    }
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

export function isRewardedMatchEntryAccessActive(grant, nowMs = Date.now()) {
  const expiresAtMs = toRewardedMatchEntryExpiresAtMs(grant?.expiresAt);
  return expiresAtMs != null && expiresAtMs > nowMs;
}

export function resolveRewardedMatchEntryRequirement(match, role = "spectator") {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "spectator") {
    return null;
  }

  const mode = String(match?.mode || "").trim().toLowerCase();
  if (mode === "friendly") {
    const targetId = String(match?.friendlyRequestId || "").trim();
    return targetId ? { matchKind: "friendly", targetId } : null;
  }

  if (mode === "league") {
    const targetId = String(match?.fixtureId || "").trim();
    return targetId ? { matchKind: "league", targetId } : null;
  }

  return null;
}
