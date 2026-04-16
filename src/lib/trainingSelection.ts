export type TrainingSelectionTapGuard = {
  type: 'player' | 'training';
  id: string;
};

type TrainingSelectable = {
  id: string;
};

export function toggleSelectionItem<T extends TrainingSelectable>(
  currentItems: T[],
  nextItem: T,
): T[] {
  const exists = currentItems.some(item => item.id === nextItem.id);
  if (exists) {
    return currentItems.filter(item => item.id !== nextItem.id);
  }

  return [...currentItems, nextItem];
}

export function isSuppressedSelectionTap(
  guard: TrainingSelectionTapGuard | null,
  type: TrainingSelectionTapGuard['type'],
  id: string,
): boolean {
  return guard?.type === type && guard.id === id;
}
