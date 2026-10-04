import { describe, expect, it } from 'vitest';
import { readNewPerson, readPersonPatch } from '@/app/(home)/people/person-form-data';
import { createPersonInput, updatePersonInput } from '@/domain/people/schema';
import { longDate } from '@/lib/dates';

// The person form reads into the shared Zod schema's shape (M3 contract
// §4.1): the service validates, this only translates the browser's strings.

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('readNewPerson', () => {
  it('maps a full form, with blanks as null and the checkbox from its marker', () => {
    const data = readNewPerson(
      form({
        name: '  Nana Jo ',
        role: 'other',
        shortName: '',
        relationship: "Sam's mum",
        inHousehold_present: '1',
        dateOfBirth: '1958-10-20',
        stageNote: '',
        colour: '',
        visibility: 'household',
      }),
    );
    expect(createPersonInput.parse(data)).toMatchObject({
      name: 'Nana Jo',
      role: 'other',
      shortName: null,
      relationship: "Sam's mum",
      inHousehold: false,
      dateOfBirth: '1958-10-20',
      stageNote: null,
      colour: null,
      visibility: 'household',
    });
  });

  it('a ticked checkbox and defaults', () => {
    const data = readNewPerson(
      form({ name: 'Milo', role: 'child', inHousehold_present: '1', inHousehold: 'on' }),
    );
    expect(createPersonInput.parse(data)).toMatchObject({
      inHousehold: true,
      visibility: 'household',
    });
  });

  it('leaves an empty name for the schema to refuse, with the field named', () => {
    const r = createPersonInput.safeParse(readNewPerson(form({ name: '', role: 'child' })));
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('name');
  });
});

describe('readPersonPatch', () => {
  it('omits role and visibility when the form did not send them (a linked person)', () => {
    // What the linked person's form sends: every field but role and visibility.
    const patch = readPersonPatch(
      form({
        name: 'Sam',
        shortName: '',
        relationship: '',
        inHousehold_present: '1',
        inHousehold: 'on',
        dateOfBirth: '',
        stageNote: '',
        colour: '',
      }),
    );
    expect(updatePersonInput.parse(patch)).toEqual({
      name: 'Sam',
      shortName: null,
      relationship: null,
      inHousehold: true,
      dateOfBirth: null,
      stageNote: null,
      colour: null,
    });
    expect('role' in patch).toBe(false);
    expect('visibility' in patch).toBe(false);
  });

  it('leaves out every field the form did not send: no silent clear or tick', () => {
    const patch = readPersonPatch(form({ name: 'Isla' }));
    expect(patch).toEqual({ name: 'Isla' });
    expect('colour' in patch).toBe(false); // an absent colour is not cleared
    expect('inHousehold' in patch).toBe(false); // an absent box is not ticked
    expect(readPersonPatch(form({ stageNote: 'x' }))).toEqual({ stageNote: 'x' }); // no name sent
  });

  it('clears a sent but empty field, and reads an unticked box as false', () => {
    expect(readPersonPatch(form({ colour: '', inHousehold_present: '1' }))).toEqual({
      colour: null,
      inHousehold: false,
    });
  });

  it('carries role and visibility when sent', () => {
    const patch = readPersonPatch(form({ name: 'Isla', role: 'child', visibility: 'private' }));
    expect(updatePersonInput.parse(patch)).toMatchObject({ role: 'child', visibility: 'private' });
  });
});

describe('longDate', () => {
  it('writes a calendar date in NZ style, untouched by time zones', () => {
    expect(longDate('2026-10-20')).toBe('Tuesday 20 October');
    expect(longDate('2026-10-20', 'short')).toBe('20 Oct');
    expect(longDate('2028-02-29', 'short')).toBe('29 Feb');
  });
});
