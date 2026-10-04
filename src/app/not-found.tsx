import Link from 'next/link';
import { CalmPage, Headline, Quiet } from '@/ui/calm';

export default function NotFound() {
  return (
    <CalmPage>
      <Headline>Nothing here.</Headline>
      <Quiet>
        That page doesn&rsquo;t exist. <Link href="/">Back to HOME</Link>.
      </Quiet>
    </CalmPage>
  );
}
