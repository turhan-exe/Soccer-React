export type VipActivityState = {
  isActive: boolean;
  expiresAt: string | null;
};

export const computeVipActive = (state: VipActivityState): boolean => {
  if (!state.isActive) {
    return false;
  }
  if (!state.expiresAt) {
    return true;
  }

  const expiresAt = new Date(state.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }

  return expiresAt.getTime() > Date.now();
};

export const resolveVipActive = (
  state: VipActivityState,
  isHydrated: boolean,
): boolean => (isHydrated ? computeVipActive(state) : false);
