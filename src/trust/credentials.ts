import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// Calendar credentials at rest (M4 contract §4.1, ADR 0007 §11, §18, §34). A
// secret calendar address is a bearer credential: it is stored only sealed
// with AES-256-GCM, bound to the connection and owner it belongs to, and is
// recognisable again only through a keyed one-way fingerprint. Node's
// built-in crypto only.
//
// Two separate keys, both exactly 32 random bytes in canonical standard
// base64 (44 characters with padding), e.g. `openssl rand -base64 32`;
// different in every environment (Preview and Production never share one),
// never committed, never logged:
//
//   HOME_CREDENTIALS_KEY seals credentials. It rotates:
//   HOME_CREDENTIALS_KEY_PREVIOUS, while a key is being rotated, is the key
//   it replaces; it still opens what it sealed, and nothing new is sealed
//   with it.
//
//   HOME_FINGERPRINT_KEY fingerprints addresses, and nothing else. It is
//   stable: rotating the sealing key never changes a fingerprint, so a
//   calendar disconnected long ago (its address destroyed, only its
//   fingerprint kept) is still recognised when its owner connects the same
//   address again (ADR 0007 §5, §34). It must differ from the sealing keys.
//   Changing it means HOME no longer recognises any disconnected calendar,
//   so it is changed only if it may have leaked.
//
// The sealing key's subkey is derived with HKDF-SHA-256. A sealed value is
//   hc1.<key id>.<iv>.<ciphertext>.<tag>     (base64url parts)
// `hc1` is the format version; the key id names the key that sealed it (the
// first 8 bytes of SHA-256 over a label and the key, hex: it identifies the
// key without revealing it); the IV is 12 fresh random bytes; the tag is
// GCM's 16. The associated data is the connection id and owner id, so a
// sealed value moved to another row does not open. A fingerprint is
//   fp2.<HMAC-SHA-256 of the normalised address>   (base64url)
// under a subkey of HOME_FINGERPRINT_KEY. (`fp1`, Package 2's fingerprint
// under the sealing key, was never stored anywhere and is gone.)
//
// Nothing here is ever logged. Every failure is a CredentialError whose
// message is a fixed code: never the address, ciphertext, IV, tag or key.

const FORMAT = 'hc1';
const MAX_PLAINTEXT_BYTES = 4096;

export type CredentialErrorCode =
  | 'key_absent'
  | 'key_invalid'
  | 'fingerprint_key_absent'
  | 'fingerprint_key_invalid'
  | 'credential_too_long'
  | 'credential_unreadable';

export class CredentialError extends Error {
  constructor(readonly code: CredentialErrorCode) {
    super(code);
    this.name = 'CredentialError';
  }
}

/** One key, ready to use. Opaque outside this module. */
export type CredentialKey = {
  readonly id: string;
  readonly seal: Buffer;
};

/** The fingerprint key, ready to use. Opaque outside this module. */
export type FingerprintKey = { readonly hmac: Buffer };

export type CredentialKeys = { readonly current: CredentialKey; readonly previous?: CredentialKey };

/** Which connection and owner a sealed credential belongs to. */
export type CredentialBinding = { connectionId: string; ownerUserId: string };

/** 32 key bytes from one value in the accepted format, or null. */
function keyBytes(raw: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null;
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== raw) return null;
  // A key of one repeated byte is a placeholder, not a key.
  if (bytes.every((b) => b === bytes[0])) return null;
  return bytes;
}

const derive = (bytes: Buffer, info: string) =>
  Buffer.from(hkdfSync('sha256', bytes, Buffer.alloc(0), info, 32));

/** Parses one sealing key in the accepted format, or throws CredentialError('key_invalid'). */
export function parseCredentialKey(raw: string): CredentialKey {
  const bytes = keyBytes(raw);
  if (!bytes) throw new CredentialError('key_invalid');
  return {
    id: createHash('sha256')
      .update('home/credentials/key-id/v1')
      .update(bytes)
      .digest('hex')
      .slice(0, 16),
    seal: derive(bytes, 'home/credentials/aes-256-gcm/v1'),
  };
}

/** Parses the fingerprint key, or throws CredentialError('fingerprint_key_invalid'). */
export function parseFingerprintKey(raw: string): FingerprintKey {
  const bytes = keyBytes(raw);
  if (!bytes) throw new CredentialError('fingerprint_key_invalid');
  return { hmac: derive(bytes, 'home/calendar/address-fingerprint/v2') };
}

export type CredentialKeysState =
  | { status: 'ready'; keys: CredentialKeys }
  | { status: 'absent' }
  | { status: 'invalid'; variable: 'HOME_CREDENTIALS_KEY' | 'HOME_CREDENTIALS_KEY_PREVIOUS' };

/**
 * The keys from the environment's raw values (src/lib/env.ts reads them).
 * Never throws and never fails boot: a missing or malformed key means
 * calendar credentials are refused calmly while the rest of HOME runs.
 */
export function credentialKeysFrom(source: {
  HOME_CREDENTIALS_KEY?: string;
  HOME_CREDENTIALS_KEY_PREVIOUS?: string;
}): CredentialKeysState {
  if (!source.HOME_CREDENTIALS_KEY) return { status: 'absent' };
  let current: CredentialKey;
  try {
    current = parseCredentialKey(source.HOME_CREDENTIALS_KEY);
  } catch {
    return { status: 'invalid', variable: 'HOME_CREDENTIALS_KEY' };
  }
  if (!source.HOME_CREDENTIALS_KEY_PREVIOUS) return { status: 'ready', keys: { current } };
  try {
    const previous = parseCredentialKey(source.HOME_CREDENTIALS_KEY_PREVIOUS);
    if (previous.id === current.id) throw new CredentialError('key_invalid');
    return { status: 'ready', keys: { current, previous } };
  } catch {
    return { status: 'invalid', variable: 'HOME_CREDENTIALS_KEY_PREVIOUS' };
  }
}

/** The keys, or a CredentialError naming why there are none to use. */
export function requireCredentialKeys(state: CredentialKeysState): CredentialKeys {
  if (state.status === 'ready') return state.keys;
  throw new CredentialError(state.status === 'absent' ? 'key_absent' : 'key_invalid');
}

export type FingerprintKeyState =
  { status: 'ready'; key: FingerprintKey } | { status: 'absent' } | { status: 'invalid' };

/**
 * The fingerprint key from the environment's raw values. Never throws and
 * never fails boot: a missing or malformed key, or one equal to a sealing
 * key (the two must be separate key material), refuses calendar connection
 * operations calmly while the rest of HOME runs.
 */
export function fingerprintKeyFrom(source: {
  HOME_FINGERPRINT_KEY?: string;
  HOME_CREDENTIALS_KEY?: string;
  HOME_CREDENTIALS_KEY_PREVIOUS?: string;
}): FingerprintKeyState {
  const raw = source.HOME_FINGERPRINT_KEY;
  if (!raw) return { status: 'absent' };
  if (raw === source.HOME_CREDENTIALS_KEY || raw === source.HOME_CREDENTIALS_KEY_PREVIOUS)
    return { status: 'invalid' };
  try {
    return { status: 'ready', key: parseFingerprintKey(raw) };
  } catch {
    return { status: 'invalid' };
  }
}

/** The fingerprint key, or a CredentialError naming why there is none to use. */
export function requireFingerprintKey(state: FingerprintKeyState): FingerprintKey {
  if (state.status === 'ready') return state.key;
  throw new CredentialError(
    state.status === 'absent' ? 'fingerprint_key_absent' : 'fingerprint_key_invalid',
  );
}

const b64u = (b: Buffer) => b.toString('base64url');
const aad = (b: CredentialBinding) =>
  Buffer.from(
    JSON.stringify(['home/calendar-credential/v1', b.connectionId, b.ownerUserId]),
    'utf8',
  );

/** Seals a credential for one connection and owner, with the current key. */
export function sealCredential(
  keys: CredentialKeys,
  plaintext: string,
  binding: CredentialBinding,
): string {
  const data = Buffer.from(plaintext, 'utf8');
  if (data.length === 0 || data.length > MAX_PLAINTEXT_BYTES)
    throw new CredentialError('credential_too_long');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.current.seal, iv);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return [FORMAT, keys.current.id, b64u(iv), b64u(ciphertext), b64u(cipher.getAuthTag())].join('.');
}

/**
 * Opens a sealed credential for the connection and owner it was sealed for,
 * with whichever key sealed it (current or previous). Any other key, row,
 * format or a single changed bit: CredentialError('credential_unreadable').
 */
export function openCredential(
  keys: CredentialKeys,
  sealed: string,
  binding: CredentialBinding,
): string {
  const parts = sealed.split('.');
  if (parts.length !== 5 || parts[0] !== FORMAT) throw new CredentialError('credential_unreadable');
  const [, keyId, ivPart, ctPart, tagPart] = parts as [string, string, string, string, string];
  const key = [keys.current, keys.previous].find((k) => k?.id === keyId);
  if (!key) throw new CredentialError('credential_unreadable');
  // Canonical base64url only: a part that decodes to the same bytes under
  // another spelling (spare low bits in the last character) is refused, so a
  // sealed value has exactly one written form.
  const decode = (part: string) => {
    const bytes = Buffer.from(part, 'base64url');
    if (b64u(bytes) !== part) throw new CredentialError('credential_unreadable');
    return bytes;
  };
  const iv = decode(ivPart);
  const tag = decode(tagPart);
  const ciphertext = decode(ctPart);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0)
    throw new CredentialError('credential_unreadable');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.seal, iv, { authTagLength: 16 });
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialError('credential_unreadable');
  }
}

/** Whether a sealed value was made with the previous key and should be sealed again. */
export function sealedWithPreviousKey(keys: CredentialKeys, sealed: string): boolean {
  return !!keys.previous && sealed.split('.')[1] === keys.previous.id;
}

/**
 * A keyed one-way fingerprint of a normalised calendar address (HMAC-SHA-256
 * under HOME_FINGERPRINT_KEY's subkey): equal for the exact same address
 * under the same fingerprint key, whatever the sealing key, so an exact
 * duplicate can be refused or a disconnected connection recognised (ADR 0007
 * §5–6, §34), and useless for recovering the address or for matching across
 * environments. Never used to compare events or sources. Pass the output of
 * normaliseCalendarAddress, never raw input.
 */
export function addressFingerprint(key: FingerprintKey, normalisedAddress: string): string {
  return `fp2.${b64u(createHmac('sha256', key.hmac).update(normalisedAddress, 'utf8').digest())}`;
}

/** Constant-time comparison of two fingerprints. */
export function sameFingerprint(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
