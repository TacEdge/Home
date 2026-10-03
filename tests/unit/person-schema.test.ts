import { describe, expect, it } from 'vitest';
import { createPersonInput, updatePersonInput } from '@/domain/people/schema';
import { CANARY, FAMILY_PEOPLE } from '../fixtures/family';

describe('createPersonInput', () => {
  it('accepts every fixture person and applies the defaults', () => {
    for (const input of Object.values(FAMILY_PEOPLE))
      expect(() => createPersonInput.parse(input)).not.toThrow();
    const milo = createPersonInput.parse(FAMILY_PEOPLE.milo);
    expect(milo).toMatchObject({ inHousehold: true, visibility: 'household' });
    expect(createPersonInput.parse(FAMILY_PEOPLE.nanaJo).inHousehold).toBe(false);
    expect(createPersonInput.parse(CANARY.sam).visibility).toBe('private');
  });

  it('trims names and rejects empty ones', () => {
    expect(createPersonInput.parse({ name: '  Milo ', role: 'child' }).name).toBe('Milo');
    expect(() => createPersonInput.parse({ name: '   ', role: 'child' })).toThrow();
  });

  it.each([
    ['name too long', { name: 'x'.repeat(101), role: 'child' }],
    ['relationship too long', { name: 'A', role: 'other', relationship: 'x'.repeat(201) }],
    ['stage note too long', { name: 'A', role: 'child', stageNote: 'x'.repeat(10_001) }],
    ['unknown role', { name: 'A', role: 'pet' }],
    ['unknown colour', { name: 'A', role: 'child', colour: 'red' }],
    ['unknown visibility', { name: 'A', role: 'child', visibility: 'public' }],
    ['impossible date of birth', { name: 'A', role: 'child', dateOfBirth: '2023-02-29' }],
    ['date of birth in another form', { name: 'A', role: 'child', dateOfBirth: '03/05/2017' }],
    ['missing role', { name: 'A' }],
    ['a user link (only linkSelf sets it)', { name: 'A', role: 'parent', userId: 'u-x' }],
    ['a creator (the actor sets it)', { name: 'A', role: 'parent', createdBy: 'u-x' }],
  ])('rejects %s', (_label, input) => {
    expect(() => createPersonInput.parse(input)).toThrow();
  });
});

describe('updatePersonInput', () => {
  it('accepts a partial patch and keeps only the given keys', () => {
    expect(Object.keys(updatePersonInput.parse({ stageNote: 'starting school in Feb' }))).toEqual([
      'stageNote',
    ]);
  });

  it('allows clearing optional fields with null, never the name or role', () => {
    expect(updatePersonInput.parse({ dateOfBirth: null, colour: null }).colour).toBeNull();
    expect(() => updatePersonInput.parse({ name: null })).toThrow();
    expect(() => updatePersonInput.parse({ role: null })).toThrow();
  });

  it('applies the creation limits and refuses fields no patch may set', () => {
    expect(() => updatePersonInput.parse({ role: 'robot' })).toThrow();
    expect(() => updatePersonInput.parse({ name: 'x'.repeat(101) })).toThrow();
    expect(() => updatePersonInput.parse({ userId: 'u-x' })).toThrow();
    expect(() => updatePersonInput.parse({ archivedAt: null })).toThrow();
    expect(() => updatePersonInput.parse({ createdBy: 'u-x' })).toThrow();
  });
});
