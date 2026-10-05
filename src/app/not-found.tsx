import Link from 'next/link';
import { CalmPage, Headline, Quiet } from '@/ui/calm';

export default function NotFound() {
  return (
    <CalmPage>
      <Headline>Nothing here.</Headline>
      <Quiet>That page doesn&rsquo;t exist.</Quiet>
      <p className="mt-2">
        <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4">
          Back to HOME
        </Link>
      </p>
    </CalmPage>
  );
}
