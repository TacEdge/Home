// Planning hours (M7 contract §5.4, D9; ADR 0011 §22): the part of every home
// day that the gap engine looks across and that Forward Week's day phrase
// describes. Home wall time, the same every day; a code constant, changed only
// by an ADR amendment. Shared by `gaps.ts` and `weather.ts`, so a stretch and
// the forecast words for it always mean the same hours.

export const PLANNING_FROM = '08:00';
export const PLANNING_TO = '20:00';
