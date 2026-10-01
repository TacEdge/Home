import { describe, expect, it } from 'vitest';
import { hashEmail, isAllowed } from '@/trust/allowlist';

const list = ['sam@example.test', 'alex@example.test'];
const secret = 's'.repeat(40);

describe('isAllowed', () => {
  it('accepts allowlisted addresses regardless of case and whitespace', () => {
    expect(isAllowed('  SAM@example.test ', list)).toBe(true);
    expect(isAllowed('alex@EXAMPLE.test', list)).toBe(true);
  });

  it('rejects anything else, including near misses', () => {
    expect(isAllowed('sam@example.com', list)).toBe(false);
    expect(isAllowed('sam+extra@example.test', list)).toBe(false);
    expect(isAllowed('', list)).toBe(false);
  });
});

describe('hashEmail', () => {
  it('is deterministic and normalises first', () => {
    expect(hashEmail('Sam@Example.test ', secret)).toBe(hashEmail('sam@example.test', secret));
  });

  it('never contains the address and differs by secret', () => {
    const h = hashEmail('sam@example.test', secret);
    expect(h).not.toContain('sam');
    expect(h).not.toContain('example');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(hashEmail('sam@example.test', 't'.repeat(40))).not.toBe(h);
  });
});
