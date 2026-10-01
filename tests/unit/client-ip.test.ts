import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, clientIp } from '@/trust/client-ip';

const h = (value?: string) => new Headers(value === undefined ? {} : { [CLIENT_IP_HEADER]: value });

describe('clientIp', () => {
  it('reads only the platform header', () => {
    expect(CLIENT_IP_HEADER).toBe('x-real-ip');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBeNull();
  });

  it('accepts a single valid IPv4 address', () => {
    expect(clientIp(h('203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(h(' 203.0.113.9 '))).toBe('203.0.113.9');
  });

  it('buckets IPv6 to its /64', () => {
    expect(clientIp(h('2001:db8:1:2:3:4:5:6'))).toBe('2001:db8:1:2::/64');
    expect(clientIp(h('2001:0db8:0001:0002::1'))).toBe('2001:db8:1:2::/64');
    expect(clientIp(h('2001:db8:1:2:ffff:ffff:ffff:ffff'))).toBe('2001:db8:1:2::/64');
    expect(clientIp(h('::1'))).toBe('0:0:0:0::/64');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 client', () => {
    expect(clientIp(h('::ffff:203.0.113.9'))).toBe('203.0.113.9');
  });

  it('rejects a spoofed multi-value header', () => {
    expect(clientIp(h('203.0.113.9, 198.51.100.1'))).toBeNull();
    expect(clientIp(h('203.0.113.9 198.51.100.1'))).toBeNull();
  });

  it('rejects garbage', () => {
    expect(clientIp(h('not-an-ip'))).toBeNull();
    expect(clientIp(h('999.1.1.1'))).toBeNull();
    expect(clientIp(h('2001:db8::1%eth0'))).toBeNull();
    expect(clientIp(h(''))).toBeNull();
  });

  it('returns null when the header is missing', () => {
    expect(clientIp(h())).toBeNull();
  });
});
