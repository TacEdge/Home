// Words for a person's role and birthday on the People screens.

export function roleLabel(role: string): string {
  return role === 'parent' ? 'Parent' : role === 'child' ? 'Child' : 'Family or friend';
}
