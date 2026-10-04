import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Production gate on the People screens (ADR 0006 §31, §33): while the
// real-data gate is closed, Today shows no "Which one is you?" prompt and
// Settings › You explains instead of offering actions that can only fail.

const gate = { open: true };
const people: {
  id: string;
  name: string;
  colour: null;
  userId: string | null;
  role: string;
  visibility: string;
}[] = [];

vi.mock('@/lib/env', () => ({
  realDataGateOpen: () => gate.open,
  env: { HOME_TIMEZONE: 'Pacific/Auckland' },
}));
vi.mock('@/trust/session', () => ({
  requireActor: async () => ({
    kind: 'user',
    userId: 'u-sam',
    email: 'sam@example.test',
    via: 'ui',
    channel: 'web',
  }),
}));
vi.mock('@/domain/people/service', () => ({ listPeople: async () => people }));
vi.mock('@/domain/captures/service', () => ({ listCaptures: async () => [] }));
vi.mock('@/app/(home)/settings/you/actions', () => ({
  addMeAction: async () => ({ status: 'idle' }),
  linkSelfAction: async () => ({ status: 'idle' }),
  unlinkSelfAction: async () => ({ status: 'idle' }),
}));

const { default: TodayPage } = await import('@/app/(home)/today/page');
const { default: YouPage } = await import('@/app/(home)/settings/you/page');
const html = async (page: () => Promise<React.ReactElement>) => renderToStaticMarkup(await page());

beforeEach(() => {
  people.length = 0;
  people.push(
    {
      id: 'p-sam',
      name: 'Sam',
      colour: null,
      userId: null,
      role: 'parent',
      visibility: 'household',
    },
    {
      id: 'p-alex',
      name: 'Alex',
      colour: null,
      userId: null,
      role: 'parent',
      visibility: 'household',
    },
  );
});

describe('gate open', () => {
  beforeEach(() => {
    gate.open = true;
  });

  it('Today prompts an unlinked adult, and not a linked one', async () => {
    expect(await html(TodayPage)).toContain('Which one is you?');
    people[0]!.userId = 'u-sam';
    expect(await html(TodayPage)).not.toContain('Which one is you?');
  });

  it('You offers each parent by name, and Add me', async () => {
    const page = await html(YouPage);
    expect(page).toContain('aria-label="This is me: Sam"');
    expect(page).toContain('aria-label="This is me: Alex"');
    expect(page).toContain('Add me');
  });
});

describe('gate closed (Production, HOME_REAL_DATA not open)', () => {
  beforeEach(() => {
    gate.open = false;
  });

  it('Today shows no prompt', async () => {
    expect(await html(TodayPage)).not.toContain('Which one is you?');
  });

  it('You explains, and offers no link, add or unlink', async () => {
    const page = await html(YouPage);
    expect(page).toContain('HOME isn’t open for family data yet');
    expect(page).not.toContain('This is me');
    expect(page).not.toContain('Add me');
    people[0]!.userId = 'u-sam';
    const linked = await html(YouPage);
    expect(linked).toContain('In HOME, you are');
    expect(linked).not.toContain('Not me');
  });
});
