export type PlayerId = 'human' | 'bot';
export type BotDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export type UnitType =
  | 'ARCHER'
  | 'BERSERKER'
  | 'CAVALRY'
  | 'CROSSBOWMAN'
  | 'ENSIGN'
  | 'FOOTMAN'
  | 'KNIGHT'
  | 'LANCER'
  | 'LIGHT_CAVALRY'
  | 'MARSHALL'
  | 'MERCENARY'
  | 'PIKEMAN'
  | 'ROYAL_GUARD'
  | 'SCOUT'
  | 'SWORDSMAN'
  | 'WARRIOR_PRIEST';

export type Coin = UnitType | 'ROYAL';

export type Coord = { q: number; r: number };
export type HexId = string;

export type BoardUnit = {
  id: string;
  owner: PlayerId;
  type: UnitType;
  hex: HexId;
  strength: number;
};

export type DiscardedCoin = {
  coin: Coin;
  faceUp: boolean;
};

export type PlayerState = {
  id: PlayerId;
  units: UnitType[];
  bag: Coin[];
  hand: Coin[];
  discard: DiscardedCoin[];
  supply: Partial<Record<UnitType, number>>;
  removed: Coin[];
  markersRemaining: number;
};

export type PendingAbility =
  | { kind: 'SWORDSMAN_MOVE'; player: PlayerId; unitId: string }
  | { kind: 'BERSERKER_EXTRA'; player: PlayerId; unitId: string }
  | { kind: 'MERCENARY_EXTRA'; player: PlayerId; unitId: string }
  | { kind: 'FOOTMAN_QUEUE'; player: PlayerId; unitIds: string[]; index: number };

export type ForcedCoin = {
  player: PlayerId;
  coin: Coin;
  source: 'WARRIOR_PRIEST';
};

export type GameState = {
  round: number;
  activePlayer: PlayerId;
  initiative: PlayerId;
  initiativeChangedThisRound: boolean;
  players: Record<PlayerId, PlayerState>;
  boardUnits: BoardUnit[];
  locations: Record<HexId, PlayerId | null>;
  winner: PlayerId | null;
  pending: PendingAbility | null;
  forcedCoin: ForcedCoin | null;
  log: string[];
  seedLabel: string;
};

export type ActionKind =
  | 'PASS'
  | 'CLAIM_INITIATIVE'
  | 'RECRUIT'
  | 'DEPLOY'
  | 'BOLSTER'
  | 'MOVE'
  | 'ATTACK'
  | 'CONTROL'
  | 'TACTIC_ARCHER'
  | 'TACTIC_CAVALRY'
  | 'TACTIC_CROSSBOWMAN'
  | 'TACTIC_ENSIGN'
  | 'TACTIC_FOOTMAN'
  | 'TACTIC_LANCER'
  | 'TACTIC_LIGHT_CAVALRY'
  | 'TACTIC_MARSHALL'
  | 'TACTIC_ROYAL_GUARD'
  | 'FREE_MOVE'
  | 'FREE_ATTACK'
  | 'FREE_CONTROL'
  | 'SKIP_ABILITY';

export type ActionSource = 'HAND' | 'FORCED' | 'FREE';

export type ActionPayload = {
  unitType?: UnitType;
  unitId?: string;
  targetUnitId?: string;
  destination?: HexId;
  intermediate?: HexId;
  recruitType?: UnitType;
  grantedUnitId?: string;
};

export type ActionCandidate = {
  id: string;
  player: PlayerId;
  source: ActionSource;
  coin?: Coin;
  coinIndex?: number;
  kind: ActionKind;
  label: string;
  group: string;
  payload: ActionPayload;
  relatedHexes: HexId[];
  score?: number;
};

export type UnitDefinition = {
  type: UnitType;
  name: string;
  ko: string;
  short: string;
  coinCount: number;
  rules: string;
  accent: string;
};
