import { redirect } from 'next/navigation';
import { getActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { CalmPage, Quiet } from '@/ui/calm';
import { Field } from '@/ui/field';
import { Wordmark } from '@/ui/wordmark';
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
    <CalmPage>
      <div className="mb-8 pt-6">
        <Wordmark size="lg" as="h1" />
      </div>
      {sent ? (
        <Quiet>
          If that address can use HOME, a link is on its way. It works once, for 15 minutes.
        </Quiet>
      ) : (
        <>
          {error ? <Quiet>That link didn&rsquo;t work. Ask for a new one.</Quiet> : null}
          <Quiet>Enter your email and we&rsquo;ll send you a link to sign in.</Quiet>
          <form action={requestLinkAction} className="mt-2">
            <Field
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
            />
            <div className="mt-5">
              <Button>Send me a link</Button>
            </div>
          </form>
        </>
      )}
    </CalmPage>
  );
}
