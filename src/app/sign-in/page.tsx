import { redirect } from 'next/navigation';
import { getActor } from '@/trust/session';
import { Headline, Page, Quiet } from '@/ui/calm';
import { requestLinkAction } from './actions';

// Depends on the session and query string on every request; never prerendered.
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  if (await getActor()) redirect('/today');
  const { sent, error } = await searchParams;

  return (
    <Page>
      <Headline>HOME</Headline>
      {sent ? (
        <Quiet>
          If that address can use HOME, a link is on its way. It works once, for 15 minutes.
        </Quiet>
      ) : (
        <>
          {error ? <Quiet>That link didn&rsquo;t work. Ask for a new one.</Quiet> : null}
          <Quiet>Enter your email and we&rsquo;ll send you a link to sign in.</Quiet>
          <form action={requestLinkAction} className="mt-6 flex flex-col gap-3">
            <label className="text-muted text-[13px] tracking-[0.1em] uppercase" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              className="bg-paper-2 border-line rounded-[22px] border px-4 py-3 text-[17px] outline-none"
            />
            <button
              type="submit"
              className="bg-ink text-paper mt-2 self-start rounded-[22px] px-5 py-2"
            >
              Send me a link
            </button>
          </form>
        </>
      )}
    </Page>
  );
}
