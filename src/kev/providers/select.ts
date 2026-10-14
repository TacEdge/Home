import 'server-only';
import { deploymentEnv, kevConfig, type KevConfig } from '@/lib/env';
import { createAnthropicProvider } from './anthropic';
import { createScriptedProvider } from './scripted';
import type { KevProvider } from './types';

// The provider's composition root (M8 contract §5.4, §14; ADR 0012 §37).
// Kev's configuration decides, on every call: no provider at all when Kev
// is off, in Production while the real-data gate is closed (S10), or with no
// key (N2); the scripted provider locally and in CI (never deployed, N3);
// otherwise the Anthropic provider, given the key from HOME_KEV_PROVIDER_KEY
// and nothing else. The key goes from env.ts to the adapter and nowhere
// else: the result never carries it.

export type KevProviderSelection = Readonly<{
  status: KevConfig['status'];
  provider: KevProvider | null;
}>;

/** The scripted provider's default transcript for a local run: one short synthetic reply. */
const LOCAL_SCRIPT = [{ kind: 'answer' as const, text: ['Scripted reply.'] }];

export function selectKevProvider(
  source?: Record<string, string | undefined>,
): KevProviderSelection {
  const config = source ? kevConfig(source) : kevConfig();
  switch (config.status) {
    case 'on':
      return { status: 'on', provider: createAnthropicProvider({ apiKey: config.key }) };
    case 'scripted':
      return {
        status: 'scripted',
        provider: createScriptedProvider(
          LOCAL_SCRIPT,
          {},
          source ? deploymentEnv(source) : deploymentEnv(),
        ),
      };
    default:
      return { status: config.status, provider: null };
  }
}
