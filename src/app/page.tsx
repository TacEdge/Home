import { Headline, Page, Quiet } from '@/ui/calm';

// Placeholder root. Step 9 makes this redirect to /today behind sign-in.
export default function RootPage() {
  return (
    <Page>
      <Headline>HOME</Headline>
      <Quiet>Quiet for now.</Quiet>
    </Page>
  );
}
