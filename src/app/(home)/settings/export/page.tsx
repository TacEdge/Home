import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/field';
import { Label, Page, Quiet } from '@/ui/page';

// Export (M3 contract §7.1). A plain form POST to the download route, so it
// works without JavaScript and the browser saves the file.
export default function ExportPage() {
  return (
    <Page title="Export" intro="Everything you can see in HOME, in one file you can keep.">
      <Label>What&rsquo;s in it</Label>
      <div className="space-y-2">
        <Quiet>
          People, events, projects, tasks, notes and what Kev knows that you can see, archived ones
          included. Your own captures, conversations and Activity.
        </Quiet>
        <Quiet>Anything the other adult keeps private isn&rsquo;t included.</Quiet>
      </div>

      <form method="post" action="/settings/export/download" className="mt-6">
        <Checkbox
          name="includeSensitive"
          label="Include sensitive items"
          hint="Things marked sensitive are left out unless you ask. Including them is noted in Activity."
        />
        <div className="mt-6">
          <Button>Download my HOME data</Button>
        </div>
      </form>

      <Label>The file</Label>
      <Quiet>
        A JSON file, readable by any text editor or program. HOME can&rsquo;t import it back yet.
      </Quiet>
    </Page>
  );
}
