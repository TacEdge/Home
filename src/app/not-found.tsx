import Link from 'next/link';
import { Headline, Page, Quiet } from '@/ui/calm';

export default function NotFound() {
  return (
    <Page>
      <Headline>Nothing here.</Headline>
      <Quiet>
        That page doesn&rsquo;t exist. <Link href="/">Back to HOME</Link>.
      </Quiet>
    </Page>
  );
}
