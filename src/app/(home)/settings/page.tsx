import { realDataGateOpen } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { ItemRow, List } from '@/ui/list';
import { Label, Page, Quiet } from '@/ui/page';
import { signOutAction } from './actions';

// Settings (M3 contract §3.1). You, What Kev knows, Archived and Export join
// this list as their packages land; Calendars (M4) and Usage (M8) are not
// listed in M3.
export default async function SettingsPage() {
  const actor = await requireActor();
  return (
    <Page title="Settings">
      {realDataGateOpen() ? null : (
        <div className="mt-4">
          <Quiet>
            HOME isn&rsquo;t open for family data yet. You can look around; nothing can be added.
          </Quiet>
        </div>
      )}
      <Label>Household</Label>
      <List>
        <ItemRow title="Activity" detail="Everything HOME has done" href="/settings/activity" />
        <ItemRow title="Export" detail="Download your HOME data" href="/settings/export" />
      </List>

      <Label>Account</Label>
      <p className="text-ink-2 break-words">Signed in as {actor.email}</p>
      <form action={signOutAction} className="mt-2">
        <Button variant="quiet">Sign out</Button>
      </form>
    </Page>
  );
}
