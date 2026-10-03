import { describe, expect, it } from 'vitest';
import { PROPOSAL_ACTIONS } from '@/db/schema/proposal';
import { captureInput } from '@/domain/captures/schema';
import { createContextInput, updateContextInput } from '@/domain/context/schema';
import { createProposalInput, PROPOSAL_PAYLOADS } from '@/domain/proposals/schema';

// Package 4b inputs: one Zod schema per input, shared by future forms and
// Kev tools (CLAUDE.md conventions).

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;
const id = '00000000-0000-4000-8000-000000000000';

describe('capture input', () => {
  it('keeps the words exactly, spacing and all', () => {
    const text = '  two spaces, a tab\tand a newline\n';
    expect(captureInput.parse({ text })).toEqual({ text, channel: 'web' });
  });
  it.each([
    ['empty', { text: '' }],
    ['blank', { text: ' \n ' }],
    ['too long', { text: 'x'.repeat(10_001) }],
    ['an unknown channel', { text: 'x', channel: 'sms' }],
    ['a status (never an input)', { text: 'x', status: 'organised' }],
  ])('rejects %s', (_l, v) => expect(ok(captureInput, v)).toBe(false));
});

describe('context input', () => {
  it('accepts each subject shape and defaults to normal, household', () => {
    expect(
      createContextInput.parse({ subject: { type: 'household' }, content: 'x', category: 'other' }),
    ).toMatchObject({ sensitivity: 'normal', visibility: 'household' });
    expect(
      ok(createContextInput, {
        subject: { type: 'person', id },
        content: 'x',
        category: 'interest',
        validUntil: '2026-10-31',
      }),
    ).toBe(true);
  });
  it.each([
    [
      'a household subject with an id',
      { subject: { type: 'household', id }, content: 'x', category: 'other' },
    ],
    [
      'a person subject without an id',
      { subject: { type: 'person' }, content: 'x', category: 'other' },
    ],
    ['an unknown category', { subject: { type: 'household' }, content: 'x', category: 'mood' }],
    ['blank content', { subject: { type: 'household' }, content: '  ', category: 'other' }],
    [
      'an impossible valid_until',
      { subject: { type: 'household' }, content: 'x', category: 'other', validUntil: '2026-02-30' },
    ],
    [
      'a source (set by the service)',
      { subject: { type: 'household' }, content: 'x', category: 'other', sourceType: 'manual' },
    ],
    [
      'a status (set by the service)',
      { subject: { type: 'household' }, content: 'x', category: 'other', status: 'active' },
    ],
  ])('rejects %s', (_l, v) => expect(ok(createContextInput, v)).toBe(false));
  it('a person may mark context sensitive directly', () => {
    expect(ok(updateContextInput, { sensitivity: 'sensitive' })).toBe(true);
  });
});

describe('proposal input and payloads', () => {
  it('has exactly one payload schema per action', () => {
    expect(Object.keys(PROPOSAL_PAYLOADS).sort()).toEqual([...PROPOSAL_ACTIONS].sort());
  });
  it('payloads never carry sensitive context (D15)', () => {
    expect(
      ok(PROPOSAL_PAYLOADS['context.create'], {
        subject: { type: 'household' },
        content: 'x',
        category: 'other',
        sensitivity: 'sensitive',
      }),
    ).toBe(false);
    expect(
      ok(PROPOSAL_PAYLOADS['context.create'], {
        subject: { type: 'household' },
        content: 'x',
        category: 'other',
        sensitivity: 'normal',
      }),
    ).toBe(true);
    expect(
      ok(PROPOSAL_PAYLOADS['context.update'], {
        op: 'edit',
        id,
        patch: { sensitivity: 'sensitive' },
      }),
    ).toBe(false);
  });
  it.each([
    ['task.update', { id, patch: { status: 'done' } }],
    ['task.schedule', { id, scheduled: null }],
    ['context.update', { op: 'confirm', id }],
    ['context.update', { op: 'retire', id }],
    ['capture.dismiss', { id }],
    ['event_person.set', { eventId: id, personId: id, role: 'responsible' }],
  ])('%s accepts %j', (action, payload) => {
    expect(ok(PROPOSAL_PAYLOADS[action as keyof typeof PROPOSAL_PAYLOADS], payload)).toBe(true);
  });
  it.each([
    ['task.update without an id', 'task.update', { patch: {} }],
    ['an unknown context op', 'context.update', { op: 'delete', id }],
    ['an event source field', 'event.update', { id, patch: { source: 'synced' } }],
    [
      'a task completion time',
      'task.update',
      { id, patch: { completedAt: '2026-10-14T00:00:00Z' } },
    ],
  ])('rejects %s', (_l, action, payload) => {
    expect(ok(PROPOSAL_PAYLOADS[action as keyof typeof PROPOSAL_PAYLOADS], payload)).toBe(false);
  });
  it('requires a summary, and refuses unknown fields such as a status', () => {
    expect(ok(createProposalInput, { action: 'task.create', payload: {}, summary: ' ' })).toBe(
      false,
    );
    expect(
      ok(createProposalInput, {
        action: 'task.create',
        payload: {},
        summary: 'x',
        status: 'approved',
      }),
    ).toBe(false);
    expect(
      ok(createProposalInput, { action: 'task.create', payload: {}, summary: 'x', captureId: id }),
    ).toBe(true);
  });
});
