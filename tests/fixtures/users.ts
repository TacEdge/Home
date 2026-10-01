// Fixture household for tests. Synthetic; never real people (CLAUDE.md rule 9).
// Addresses use the reserved .test TLD so mail can never leave the machine.

export const SAM = { name: 'Sam', email: 'sam@example.test' } as const;
export const ALEX = { name: 'Alex', email: 'alex@example.test' } as const;
export const OUTSIDER = { name: 'Stranger', email: 'stranger@example.test' } as const;
