import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formAction, toFormState } from '@/app/_forms/action';
import { FormRefusal } from '@/app/_forms/errors';
import { NOT_FOUND_COPY, NOT_PERMITTED_COPY, UNEXPECTED_COPY } from '@/app/_forms/error-copy';
import { NotFoundError, NotPermittedError, type NotPermittedCode } from '@/domain/common/errors';
import { NotSignedInError, type UserActor } from '@/trust/actor';

// The M3 server-action and error-copy pattern (M3 contract §4.3).

const sam: UserActor = {
  kind: 'user',
  userId: 'u',
  email: 'sam@example.test',
  via: 'ui',
  channel: 'web',
};
const signedIn = { requireActor: async () => sam };

describe('error copy', () => {
  it('has calm copy for every domain refusal code', () => {
    for (const [code, copy] of Object.entries(NOT_PERMITTED_COPY)) {
      expect(copy.length, code).toBeGreaterThan(10);
      expect(copy, code).not.toMatch(/!|_|\{/); // no exclamation, no codes, no templates
    }
  });
});

describe('toFormState', () => {
  it('maps validation issues to per-field copy without echoing input', () => {
    const r = z
      .object({ title: z.string().trim().min(1), note: z.string().max(3), when: z.string() })
      .safeParse({ title: '   ', note: 'secret words', when: undefined });
    const s = toFormState(r.error);
    expect(s.fields).toEqual({
      title: 'This can’t be empty.',
      note: 'That’s too long.',
      when: 'This is needed.',
    });
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('reads not-found the same whatever the entity', () => {
    expect(toFormState(new NotFoundError('person')).message).toBe(NOT_FOUND_COPY);
    expect(toFormState(new NotFoundError('task')).message).toBe(NOT_FOUND_COPY);
  });

  it.each(Object.keys(NOT_PERMITTED_COPY) as NotPermittedCode[])('maps %s', (code) => {
    expect(toFormState(new NotPermittedError(code)).message).toBe(NOT_PERMITTED_COPY[code]);
  });

  it('shows an action’s own refusal with its link, and nothing else', () => {
    const s = toFormState(
      new FormRefusal('You’ve connected this calendar before.', {
        href: '/settings/calendars/abc',
        label: 'Go to Sam’s work',
      }),
    );
    expect(s).toEqual({
      status: 'error',
      message: 'You’ve connected this calendar before.',
      fields: {},
      link: { href: '/settings/calendars/abc', label: 'Go to Sam’s work' },
    });
    expect(toFormState(new FormRefusal('No.'))).toEqual({
      status: 'error',
      message: 'No.',
      fields: {},
    });
  });

  it('never shows an unexpected error’s message', () => {
    const s = toFormState(new Error('duplicate key value violates "person_user_id" detail'));
    expect(s.message).toBe(UNEXPECTED_COPY);
  });
});

describe('formAction', () => {
  it('runs as the signed-in actor and reports success', async () => {
    let seen: UserActor | null = null;
    const s = await formAction(async (a) => {
      seen = a;
      return { message: 'Saved.' };
    }, signedIn);
    expect(seen).toBe(sam);
    expect(s).toEqual({ status: 'ok', message: 'Saved.' });
  });

  it('turns a refusal into calm form state, including the closed real-data gate', async () => {
    const s = await formAction(async () => {
      throw new NotPermittedError('real_data_closed');
    }, signedIn);
    expect(s).toEqual({
      status: 'error',
      message: 'HOME isn’t open for family data yet.',
      fields: {},
    });
  });

  it('sends a signed-out person to sign in', async () => {
    await expect(
      formAction(async () => undefined, {
        requireActor: async () => {
          throw new NotSignedInError();
        },
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });

  it('lets navigation from the action through', async () => {
    const { redirect } = await import('next/navigation');
    await expect(formAction(async () => redirect('/people/1'), signedIn)).rejects.toMatchObject({
      digest: expect.stringContaining('/people/1'),
    });
  });
});
