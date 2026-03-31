import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { NegotiationContext } from './NegotiationDialog';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/services/negotiation', () => ({
  startNegotiationAttempt: vi.fn(),
  submitNegotiationOffer: vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { NegotiationDialog } from './NegotiationDialog';

const context: NegotiationContext = {
  playerId: 'academy-1',
  playerName: 'Genç Oyuncu',
  overall: 74,
  transferFee: 0,
  source: 'academy',
  position: 'DEF',
  contextId: 'academy-1',
};

describe('NegotiationDialog', () => {
  it('renders raw academy positions with full Turkish labels', () => {
    const html = renderToStaticMarkup(
      <NegotiationDialog
        open
        context={context}
        onClose={() => {}}
        onAccepted={() => {}}
      />,
    );

    expect(html).toContain('Genç Oyuncu');
    expect(html).toContain('Stoper');
    expect(html).not.toContain('(DEF)');
  });
});
