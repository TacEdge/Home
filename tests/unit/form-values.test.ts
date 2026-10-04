import { describe, expect, it, vi } from 'vitest';
import { formAction, submittedValues } from '@/app/_forms/action';
import { shown, shownChecked, type FormState } from '@/app/_forms/state';
import { ageLabel, CONTEXT_CATEGORY_LABEL } from '@/app/(home)/people/copy';
import { NotPermittedError } from '@/domain/common/errors';
import { log } from '@/lib/log';
import type { UserActor } from '@/trust/actor';

// A refused save hands the person's input back to the same form, and only
// there (ADR 0006 §33): never into a log line.

const sam: UserActor = {
  kind: 'user',
  userId: 'u',
  email: 'sam@example.test',
  via: 'ui',
  channel: 'web',
};
const signedIn = { requireActor: async () => sam };
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('submittedValues', () => {
  it('keeps the text fields, never Next’s own action fields or files', () => {
    const f = form({
      name: 'Uncle',
      stageNote: 'Visiting',
      $ACTION_ID_abc: 'x',
      $ACTION_REF_1: 'y',
    });
    f.set('upload', new Blob(['x']), 'x.txt');
    expect(submittedValues(f)).toEqual({ name: 'Uncle', stageNote: 'Visiting' });
  });
});

describe('formAction hands values back on a refusal, and only there', () => {
  it('returns the submitted values with a domain refusal', async () => {
    const s = await formAction(
      async () => {
        throw new NotPermittedError('real_data_closed');
      },
      { ...signedIn, form: form({ name: 'Typed name' }) },
    );
    expect(s).toMatchObject({ status: 'error', values: { name: 'Typed name' } });
  });

  it('returns none without a form, and none on success', async () => {
    const refused = await formAction(async () => {
      throw new NotPermittedError('not_eligible');
    }, signedIn);
    expect('values' in refused).toBe(false);
    const ok = await formAction(async () => undefined, { ...signedIn, form: form({ name: 'x' }) });
    expect(ok).toEqual({ status: 'ok', message: undefined });
  });

  it('never logs them, even for an unexpected error', async () => {
    const spy = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    await formAction(
      async () => {
        throw new Error('boom');
      },
      { ...signedIn, form: form({ stageNote: 'SECRET-TYPED-WORDS' }) },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-TYPED-WORDS');
    spy.mockRestore();
  });
});

describe('shown and shownChecked', () => {
  const refused: FormState = {
    status: 'error',
    message: 'm',
    fields: {},
    values: { name: 'Typed', inHousehold: 'on' },
  };
  it('show what was submitted after a refusal, else the stored value', () => {
    expect(shown(refused, 'name', 'Stored')).toBe('Typed');
    expect(shown(refused, 'stageNote', 'Stored note')).toBe(''); // submitted empty
    expect(shown({ status: 'idle' }, 'name', 'Stored')).toBe('Stored');
    expect(shown({ status: 'idle' }, 'name', null)).toBeUndefined();
    expect(shownChecked(refused, 'inHousehold', false)).toBe(true);
    expect(shownChecked({ ...refused, values: {} }, 'inHousehold', true)).toBe(false);
    expect(shownChecked({ status: 'idle' }, 'inHousehold', true)).toBe(true);
  });
});

describe('profile copy', () => {
  it('says "age 9", and has plain words for every context category', () => {
    expect(ageLabel(9)).toBe('age 9');
    for (const [k, v] of Object.entries(CONTEXT_CATEGORY_LABEL))
      if (v !== null) expect(v, k).not.toMatch(/^[a-z_]+$/);
  });
});
