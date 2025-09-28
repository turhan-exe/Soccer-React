export interface Lineup {
  formation: string;          // e.g. "4-3-3"
  starters: string[];         // playerId[]
  subs: string[];             // playerId[]
  reserves?: string[];        // optional reserve list for UI snapshots
  tactics?: Record<string, any>;
}

export interface TeamDoc {
  id: string;                 // doc id
  leagueId: string;           // denormalized for convenience
  ownerUid: string;
  clubName: string;
  elo?: number;
  lineupLocked?: boolean;
  lineup?: Lineup;            // set via setLineup
}


