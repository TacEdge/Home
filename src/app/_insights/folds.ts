// How many entries inside a "+ N more" fold are rendered in full, with their
// Why and their Dismiss and Not useful forms (M6 Package 4, ADR 0009 §35).
// The count on the fold is always exact and every entry is still said; past
// this many, an entry is its sentence and mark alone, so a page with very
// many stays light. Responding to the ones in full brings the rest forward.
export const FOLDED_FULL = 12;
