import { BlockList, isIP } from 'node:net';

// Which network addresses HOME may connect to when it fetches something
// from outside (M4 contract §4.3): public unicast only. Loopback, private,
// carrier-grade NAT, link-local (including cloud metadata at 169.254.169.254),
// documentation, benchmarking, multicast, reserved, IPv4-mapped forms of all
// of those, and IPv6 local, unique-local, site-local, multicast, Teredo, 6to4
// and NAT64 are refused. Explicit ranges, no heuristics. Pure.

// Separate lists: a BlockList also matches IPv4 addresses against
// IPv4-mapped IPv6 rules, so the families must not share one.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked6.addSubnet(net, prefix, 'ipv6');
const globalUnicast = new BlockList();
globalUnicast.addSubnet('2000::', 3, 'ipv6');

/** True only for a public unicast IPv4 or IPv6 address (no hostnames). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked4.check(address, 'ipv4');
  if (family === 6) {
    const lower = address.toLowerCase();
    // An IPv4-mapped address is judged as the IPv4 address it carries.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (mapped) return false;
    if (lower.includes('%')) return false; // a zone id is always local
    return globalUnicast.check(address, 'ipv6') && !blocked6.check(address, 'ipv6');
  }
  return false;
}
