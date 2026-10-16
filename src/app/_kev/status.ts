import 'server-only';
import { kevConfig } from '@/lib/env';

// Whether Kev is switched on here (M8 contract §9.6, §11.1, §14): its
// configuration as it is now, read on every request like the gate. Kev is
// on with a usable key, or with the scripted provider locally and in CI;
// off in every other state (off, the gate closed in Production, no key, an
// invalid key). With Kev off the Ask Kev button and Today's line are not
// rendered, Kev's screen says "Kev isn't switched on here." and the turn
// route refuses before any read. Never the key: only its status.
export function kevSwitchedOn(): boolean {
  const status = kevConfig().status;
  return status === 'on' || status === 'scripted';
}
