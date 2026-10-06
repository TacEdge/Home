import { SafeFetchError, type SafeFetchErrorCode } from '@/integrations/net/safe-fetch';
import type { ProviderErrorCode } from '@/domain/calendar/provider';
import { fakeProvider } from '@/integrations/calendar/fake';
import { icsProvider } from '@/integrations/calendar/ics/provider';
import { providerContract, type ContractStep } from './provider-contract';

// The contract suite against both providers M4 has.

/** The fetch failure that the ICS adapter must report as each provider code. */
const AS_FETCH_FAILURE: Record<ProviderErrorCode, SafeFetchErrorCode> = {
  unreachable: 'timeout',
  address_rejected: 'address_rejected',
  too_large: 'too_large',
  not_a_calendar: 'bad_response',
};

providerContract(
  'ics adapter (synthetic feeds through an injected fetcher)',
  (steps: readonly ContractStep[]) => {
    let i = 0;
    const provider = icsProvider({
      homeTimeZone: 'Pacific/Auckland',
      fetchFeed: async () => {
        const s = steps[i]!;
        if ('fail' in s) throw new SafeFetchError(AS_FETCH_FAILURE[s.fail]);
        return s.ics;
      },
    });
    return { provider, advance: () => void (i = Math.min(i + 1, steps.length - 1)) };
  },
);

providerContract('fake provider', (steps: readonly ContractStep[]) => {
  const provider = fakeProvider(steps, { homeTimeZone: 'Pacific/Auckland' });
  return { provider, advance: () => provider.advance() };
});
