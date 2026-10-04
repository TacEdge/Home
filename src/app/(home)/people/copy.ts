import type { ContextCategory } from '@/domain/context/schema';

// Words for a person's role, age and what Kev knows on the People screens.

export function roleLabel(role: string): string {
  return role === 'parent' ? 'Parent' : role === 'child' ? 'Child' : 'Family or friend';
}

/** "age 9": a bare number reads ambiguously, aloud especially. */
export function ageLabel(age: number): string {
  return `age ${age}`;
}

/** What kind of thing to know, in plain words. Typed over every category. */
export const CONTEXT_CATEGORY_LABEL: Record<ContextCategory, string | null> = {
  interest: 'Something they enjoy',
  preference: 'A preference',
  routine: 'A routine',
  intention: 'Something planned',
  practical: 'Practical',
  other: null,
};
