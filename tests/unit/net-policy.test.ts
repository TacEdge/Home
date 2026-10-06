import { describe, expect, it } from 'vitest';
import { isPublicAddress } from '@/lib/net-policy';

// Where HOME may connect when it fetches from outside (M4 contract §4.3).

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '169.254.1.1',
    '192.0.0.8',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::7f00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::1',
    '100::1',
    '::127.0.0.1',
    'localhost',
    'calendar.google.com',
    '',
    '127.1',
    '2130706433',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '142.250.70.78',
    '1.1.1.1',
    '2404:6800:4006:80f::200e',
    '2001:4860:4860::8888',
  ])('allows public %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
