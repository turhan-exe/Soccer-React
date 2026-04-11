import { translate } from '@/i18n/runtime';
import type { AppLanguage } from '@/i18n/types';
import type { Position } from '@/types';

const KNOWN_POSITIONS: readonly Position[] = [
  'GK',
  'CB',
  'LB',
  'RB',
  'CM',
  'LM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
] as const;

const POSITION_ALIAS_MAP: Record<string, Position> = {
  GK: 'GK',
  KL: 'GK',
  KALECI: 'GK',
  KALEC: 'GK',
  GOALKEEPER: 'GK',
  GOALIE: 'GK',

  CB: 'CB',
  STP: 'CB',
  STOPER: 'CB',
  DEF: 'CB',
  RCB: 'CB',
  LCB: 'CB',
  CBK: 'CB',
  BL: 'CB',

  LB: 'LB',
  SLB: 'LB',
  SOLBEK: 'LB',
  LWB: 'LB',
  LWFB: 'LB',
  LY: 'LB',

  RB: 'RB',
  SGB: 'RB',
  SAGBEK: 'RB',
  RWB: 'RB',
  RFB: 'RB',
  DR: 'RB',

  CM: 'CM',
  MO: 'CM',
  CMF: 'CM',
  CMID: 'CM',
  MID: 'CM',
  MIDFIELDER: 'CM',
  DM: 'CM',
  DMF: 'CM',
  CDM: 'CM',

  LM: 'LM',
  SLO: 'LM',
  SOLORTASAHA: 'LM',
  LMF: 'LM',

  RM: 'RM',
  SGO: 'RM',
  SAGORTASAHA: 'RM',
  RMF: 'RM',
  IR: 'RM',

  CAM: 'CAM',
  OOS: 'CAM',
  AM: 'CAM',
  AMF: 'CAM',
  IM: 'CAM',
  OFANSIFORTASAHA: 'CAM',

  LW: 'LW',
  SLK: 'LW',
  SOLKANAT: 'LW',
  LWF: 'LW',

  RW: 'RW',
  SGK: 'RW',
  SAGKANAT: 'RW',
  RWF: 'RW',
  EB: 'RW',

  ST: 'ST',
  SF: 'ST',
  SANTRAFOR: 'ST',
  SANTRFOR: 'ST',
  FORVET: 'ST',
  FWD: 'ST',
  FW: 'ST',
  FOR: 'ST',
  FORWARD: 'ST',
  STRIKER: 'ST',
  ATT: 'ST',
  SS: 'ST',
  HU: 'ST',
  FO: 'ST',
};

const normalizePositionKey = (value: string): string =>
  value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

const normalizeSearchToken = (value: string): string =>
  value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export const canonicalizePosition = (value?: Position | string | null): Position | null => {
  if (!value) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = normalizePositionKey(raw);
  if (!normalized) {
    return null;
  }

  if ((KNOWN_POSITIONS as readonly string[]).includes(normalized)) {
    return normalized as Position;
  }

  return POSITION_ALIAS_MAP[normalized] ?? null;
};

export const getPositionLabel = (
  position?: Position | string | null,
  language?: AppLanguage,
): string => {
  if (!position || !String(position).trim()) {
    return translate('common.positions.unknown', undefined, language);
  }

  const canonical = canonicalizePosition(position);
  return canonical
    ? translate(`common.positions.${canonical}`, undefined, language)
    : String(position).trim();
};

export const getPositionShortLabel = (
  position?: Position | string | null,
  language?: AppLanguage,
): string => {
  if (!position || !String(position).trim()) {
    return translate('common.positionShort.unknown', undefined, language);
  }

  const canonical = canonicalizePosition(position);
  return canonical
    ? translate(`common.positionShort.${canonical}`, undefined, language)
    : String(position).trim();
};

export const getPositionLabels = (
  positions?: Array<Position | string> | null,
  language?: AppLanguage,
): string[] => {
  if (!positions?.length) {
    return [];
  }

  return positions.map((position) => getPositionLabel(position, language));
};

export const getPositionSearchTokens = (
  position?: Position | string | null,
): string[] => {
  if (!position) {
    return [];
  }

  const raw = String(position).trim();
  if (!raw) {
    return [];
  }

  const canonical = canonicalizePosition(raw);
  const tokens = [
    raw,
    canonical ?? '',
    canonical ? getPositionLabel(canonical, 'tr') : '',
    canonical ? getPositionLabel(canonical, 'en') : '',
    canonical ? getPositionShortLabel(canonical, 'tr') : '',
    canonical ? getPositionShortLabel(canonical, 'en') : '',
  ];

  return Array.from(new Set(tokens.map(normalizeSearchToken).filter(Boolean)));
};
