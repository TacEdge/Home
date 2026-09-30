# HOME — M0.5 experience prototype

**Throwaway.** Static HTML/CSS/JS, fixture family only. No database, no auth, no APIs, no AI, no calendar, no weather, no production logic. It exists to evaluate the Today / Forward / Kev experience, then be deleted once M1's real screens exist. It must never be imported by, or import from, `src/`.

## Run it

Any of these:

```sh
# simplest: open the file
open prototype/index.html            # macOS
xdg-open prototype/index.html        # Linux

# or serve the folder (needed for some browsers' file:// restrictions on iPad)
cd prototype && python3 -m http.server 8080
# then http://localhost:8080  — or from an iPad on the same Wi-Fi, http://<your-computer-ip>:8080
```

Controls (prototype only — the dashed bar at the top is not part of HOME):
- **Scenario** dropdown, or keys **1–6**.
- **P** toggles a forced phone-width preview on a wide screen. `?phone=1` in the URL does the same; `?s=3` opens scenario 4.
- Resize the window to see tablet (≥768px) and desktop (≥1200px) layouts.

## The six fixture states

| # | State | Date | What it tests |
|---|---|---|---|
| 1 | **Normal weekday** | Wed 14 Oct, 7:03am | The five-second test on an ordinary day: one pickup gap, a good Saturday window, a birthday coming. |
| 2 | **Chaotic weekday** | Mon 19 Oct, 7:03am | Two clashes, three unassigned runs, both parents out late — does it stay calm? |
| 3 | **Quiet weekend** | Sat 17 Oct, 8:10am | Almost nothing scheduled. HOME must not fill the space. One genuine opportunity (dry morning, fence). |
| 4 | **Conflict** | Thu 15 Oct, 7:03am | One real clash (Sam: interviews vs site meeting) that needs sorting, with a sensible way out. |
| 5 | **Evening** | Wed 14 Oct, 8:40pm | Today is done. *Tonight — nothing else needs you*, then tomorrow morning's early start. |
| 6 | **Big week ahead** | Sun 15 Nov, 9:20am | Quiet today, heavy week: Sam away, school production, a 70th birthday, one free evening for the parents. |

Forward and Kev change with each state.

## Scripted Kev

No AI. `kev.js` pattern-matches a few intents and answers from the fixture. Try:

- "What's happening today?" · "What does Saturday look like?" · "What's on this weekend?"
- "Anything I need to know?" — in quiet states the answer is *Nothing that needs you.*
- "Add sorting the garage light." → **✓ Kept** instantly, then a proposal card → **Add / Change / Not now**
- "Book Milo's dentist and remind me to get Nana Jo a present" → two cards, one private, **Yes to all**
- "When could I get three hours to paint?" → a specific window with citations and a scheduling proposal
- "Help me plan the exterior painting" → the deep-tier pause, a plan, a project proposal
- "Read the week ahead" (or the link on Forward → Week)
- Tap **Sort it ›** on any insight to open Kev with that insight as focus.

Approving a proposal changes the fixture in memory (a task appears in To do; a pickup gap is filled; the insight clears; on state 1 the headline becomes "Easy day. Nothing needs sorting."). Switching scenario resets everything.

## Files

`index.html` shell · `styles.css` · `fixtures.js` (six states) · `kev.js` (scripted replies) · `app.js` (rendering).
