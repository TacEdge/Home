import 'server-only';
import { calendarKeyEnv } from '@/lib/env';
import {
  CredentialError,
  credentialKeysFrom,
  fingerprintKeyFrom,
  requireCredentialKeys,
  requireFingerprintKey,
  type CredentialKeys,
  type FingerprintKey,
} from '@/trust/credentials';
import { NotPermittedError } from '../common/errors';

// The calendar keys, read from the environment on each use (so a key change
// applies on the next request, and tests can change them), never cached,
// never logged. A missing or invalid key refuses the calendar operation
// calmly; it never stops HOME (M4 contract §4.1, ADR 0007 §34).

export type CalendarKeys = { credentials: CredentialKeys; fingerprint: FingerprintKey };

export function calendarKeys(): CalendarKeys {
  const source = calendarKeyEnv();
  try {
    return {
      credentials: requireCredentialKeys(credentialKeysFrom(source)),
      fingerprint: requireFingerprintKey(fingerprintKeyFrom(source)),
    };
  } catch (e) {
    if (e instanceof CredentialError) throw new NotPermittedError('calendar_keys_unavailable');
    throw e;
  }
}
