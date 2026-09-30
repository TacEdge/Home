/* HOME prototype — fixture family only. Nothing here is real.
   Family: Sam (parent), Alex (parent), Milo (9), Isla (6), Nana Jo (Sam's mum, not in household).
   Projects: Back fence (paint, 3h, dry), Garage (light). */

const PEOPLE = {
  Sam:  { color: '#8c7a5b' },
  Alex: { color: '#6f8a8c' },
  Milo: { color: '#b0865b' },
  Isla: { color: '#9a7f9c' },
};

const USUAL = 'School weekdays · Alex works 9–2:30 · Sam in the office Mon–Thu · Milo swimming Wed 3:30 · Football Sat 9 · Alex Pilates Wed 6:15';

const BASE_MONTH = {
  headline: "Sam's away twice. Labour weekend is clear.",
  needs: [
    { kind: 'needs', text: "Fri 16 and Tue 27 — pickups while Sam's away.", facts: 'Sam: Wellington Fri 16 · Sydney Tue 27 · Alex works till 2:30 both days' },
    { kind: 'know', text: 'Back fence: 2 of 5 done; target end of October.', facts: 'Project target 31 Oct · 3 tasks open · 2 dry weekends left' },
  ],
  units: [
    { u: 'This week', load: '●●●', note: 'busy midweek', items: ['Parent interviews Thu', 'Sam away Fri'] },
    { u: '19–25 Oct', load: '●●', note: 'steady', items: ["Nana Jo's birthday Tue", 'Dentist (Milo) Mon'] },
    { u: '26 Oct–1 Nov', load: '●', note: 'quiet', items: ['Labour Day Mon', 'Sam in Sydney Tue–Wed'] },
    { u: '2–8 Nov', load: '●●', note: 'steady', items: ['School cross-country Fri'] },
  ],
};

const BASE_SEASON = {
  headline: 'Steady till December, then it all happens at once.',
  texture: '▁▃▂▁▂▂▁▂▃▅▆▇▅',
  needs: [
    { kind: 'know', text: 'School finishes 16 Dec; nothing planned for the break yet.', facts: 'Term ends Wed 16 Dec · no travel or bookings found' },
    { kind: 'know', text: "Nana Jo's 70th is 21 Nov — worth planning soon?", facts: 'Birthday Sat 21 Nov · no event or task linked' },
  ],
  months: [
    { u: 'October', items: ['Labour weekend', "Nana Jo's birthday 20th", 'Back fence target'] },
    { u: 'November', items: ["Nana Jo's 70th (21st)", 'Sam in Sydney 10–12', 'Cross-country 6th'] },
    { u: 'December', items: ['School ends 16th', 'Christmas', 'Milo turns 10 (28th)'] },
  ],
};

const NORMAL_WEEK = {
  headline: 'Busy midweek, easy weekend.',
  needs: [
    { kind: 'needs', text: "Thu — Sam's in two places at 4.", facts: 'Parent interviews 4:00 · Site meeting 3:30–4:30', action: { label: 'Sort it', focus: 'thu-clash' } },
    { kind: 'needs', text: "Fri — nobody's down for pickup (Sam's away).", facts: 'Sam: Wellington all day · Alex works till 2:30 · school out 3:00', action: { label: 'Sort it', focus: 'fri-pickup' } },
    { kind: 'know', text: "Tue — Nana Jo's birthday; nothing planned yet.", facts: 'Birthday Tue 20 · no event or task linked' },
  ],
  units: [
    { u: 'Thu', sub: '15', load: '●●●', items: ['Parent interviews 4:00', 'Sam flies out 6pm'] },
    { u: 'Fri', sub: '16', load: '●●', items: ['Sam away'] },
    { u: 'Sat', sub: '17', load: '●', items: ['Football 9:00'], wx: 'Dry morning' },
    { u: 'Sun', sub: '18', load: '·', items: ['Nothing on'], wx: 'Showers after lunch' },
    { u: 'Mon', sub: '19', load: '●●●', items: ['Dentist (Milo) 3:30'] },
    { u: 'Tue', sub: '20', load: '●●', items: ["Nana Jo's birthday"] },
    { u: 'Wed', sub: '21', load: '●', items: [] },
  ],
};

const SCENARIOS = [
  /* 1 ─────────────────────────────────────────── NORMAL WEEKDAY */
  {
    id: 'normal', name: '1 · Normal weekday',
    date: 'Wednesday 14 October', clock: '7:03am',
    headline: 'Easy morning. One thing to sort before 3.', headlineQuiet: 'Easy day. Nothing needs sorting.',
    weather: 'Fine until mid-afternoon, then showers.',
    insights: [
      { kind: 'needs', onObject: true, text: "Nobody's down for Isla's 3:00 pickup. Alex finishes at 2:30.", facts: 'Isla — pickup 3:00 · Alex — work till 2:30 · Sam — client site all day', action: { label: 'Sort it', focus: 'isla-pickup' } },
      { kind: 'know', text: 'Saturday morning looks clear and dry — enough for the back fence.', facts: 'Sat 17 · 9:00–12:00 free for Sam · dry, 15° · Back fence needs 3 hrs, dry', action: { label: 'Plan it', focus: 'fence' } },
      { kind: 'know', text: "Nana Jo's birthday is Tuesday.", facts: 'Tue 20 Oct · no event or task linked' },
    ],
    runs: [
      { time: '8:30', title: 'School drop-off', who: 'Alex' },
      { time: '3:00', title: 'Isla — pickup', who: '', gap: true, focus: 'isla-pickup' },
      { time: '3:30', title: 'Milo — swimming', who: 'Alex' },
    ],
    people: [
      { name: 'Sam', day: ['Client site, all day', '7:00pm Board meeting'] },
      { name: 'Alex', day: ['Work till 2:30', '6:15pm Pilates'] },
      { name: 'Milo', day: ['School · swimming 3:30'] },
      { name: 'Isla', day: ['School'] },
    ],
    todos: ['Pay swimming term fees'],
    toSort: 2,
    forward: { week: NORMAL_WEEK, month: BASE_MONTH, season: BASE_SEASON },
    suggestions: ['Anything I need to know today?', "What's on this weekend?", 'Read the week ahead'],
  },

  /* 2 ─────────────────────────────────────────── CHAOTIC WEEKDAY */
  {
    id: 'chaos', name: '2 · Chaotic weekday',
    date: 'Monday 19 October', clock: '7:03am',
    headline: 'Full one. Two clashes, and the 3:30 runs need sorting.', headlineQuiet: 'Full one, but it all fits now.',
    weather: 'Wet all day.',
    insights: [
      { kind: 'needs', onObject: true, text: "Sam's in two places at 3:30 — dentist and the site meeting.", facts: 'Milo — dentist 3:30 (Sam responsible) · Site meeting 3:00–4:30 (Sam)', action: { label: 'Sort it', focus: 'sam-clash' } },
      { kind: 'needs', onObject: true, text: "Nobody's down for either 3:30 pickup.", facts: 'Isla — school out 3:00 · Milo — swimming 3:30, pickup 5:15 · Alex — Pilates cover shift 3–6', action: { label: 'Sort it', focus: 'pickups' } },
      { kind: 'know', text: "You're both out until after 6 tonight.", facts: 'Sam — site till 4:30, then board 7pm · Alex — cover shift till 6' },
    ],
    more: 2,
    runs: [
      { group: 'Morning' },
      { time: '8:30', title: 'School drop-off', who: 'Sam' },
      { group: 'Afternoon' },
      { time: '3:00', title: 'Isla — pickup', who: '', gap: true, focus: 'pickups' },
      { time: '3:30', title: 'Milo — dentist', who: 'Sam', clash: true, focus: 'sam-clash' },
      { time: '3:30', title: 'Milo — swimming', who: '', gap: true, clash: true, focus: 'pickups' },
      { time: '5:15', title: 'Swimming pickup', who: '', gap: true, focus: 'pickups' },
      { group: 'Evening' },
      { time: '6:45', title: 'Sam → board meeting', who: 'Sam' },
    ],
    people: [
      { name: 'Sam', day: ['Office · site 3:00 · dentist 3:30', '7:00pm Board meeting  +1'] },
      { name: 'Alex', day: ['Work till 2:30 · cover shift 3–6'] },
      { name: 'Milo', day: ['School · dentist 3:30 · swimming 3:30'] },
      { name: 'Isla', day: ['School · playdate?'] },
    ],
    todos: ['Sign the camp form (due today)', 'Pay swimming term fees', 'Book car in for WOF'],
    toSort: 4,
    forward: {
      week: {
        headline: 'Heavy start, then it eases.',
        needs: [
          { kind: 'needs', text: "Today — two clashes and three pickups unassigned.", facts: 'See Today', action: { label: 'Sort it', focus: 'pickups' } },
          { kind: 'needs', text: "Tue — Nana Jo's birthday; nothing planned.", facts: 'Tue 20 · no event or task' },
          { kind: 'know', text: 'Thu — Sam home by 5 for once.', facts: 'No evening commitments Thu' },
        ],
        units: [
          { u: 'Mon', sub: '19', load: '●●●', items: ['Dentist 3:30', 'Site meeting 3:00', 'Board 7pm'], more: 2 },
          { u: 'Tue', sub: '20', load: '●●', items: ["Nana Jo's birthday", 'Camp form due'] },
          { u: 'Wed', sub: '21', load: '●●', items: ['Swimming 3:30', 'Pilates'] },
          { u: 'Thu', sub: '22', load: '●', items: [] },
          { u: 'Fri', sub: '23', load: '●', items: ['School disco 6pm'] },
          { u: 'Sat', sub: '24', load: '●', items: ['Football 9:00'], wx: 'Showers' },
          { u: 'Sun', sub: '25', load: '·', items: ['Nothing on'] },
        ],
      },
      month: BASE_MONTH, season: BASE_SEASON,
    },
    suggestions: ['Anything I need to know today?', 'Who can do the 3:30 pickups?', 'What does Saturday look like?'],
  },

  /* 3 ─────────────────────────────────────────── QUIET WEEKEND */
  {
    id: 'quiet', name: '3 · Quiet weekend',
    date: 'Saturday 17 October', clock: '8:10am',
    headline: 'Nothing on today.',
    weather: 'Dry and mild all day.',
    insights: [
      { kind: 'know', text: "Good morning for the back fence, if you're keen. About 3 hours.", facts: 'Sat 17 · dry till evening · nobody has commitments before 1pm · Back fence needs 3 hrs, dry', action: { label: 'Plan it', focus: 'fence' } },
    ],
    runs: [],
    people: [
      { name: 'Sam', day: ['Free'] },
      { name: 'Alex', day: ['Free'] },
      { name: 'Milo', day: ['Football 9:00 cancelled — wet pitch'] },
      { name: 'Isla', day: ['Free'] },
    ],
    todos: [],
    toSort: 0,
    forward: {
      week: {
        headline: 'A quiet week. Just the usual.',
        needs: [
          { kind: 'know', text: 'Both weekends are clear — the back fence could fit either Saturday.', facts: 'Sat 17 and Sat 24 · no commitments · dry Sat 17' },
        ],
        units: [
          { u: 'Sun', sub: '18', load: '·', items: ['Nothing on'] },
          { u: 'Mon', sub: '19', load: '●', items: [] },
          { u: 'Tue', sub: '20', load: '●', items: ["Nana Jo's birthday"] },
          { u: 'Wed', sub: '21', load: '●', items: [] },
          { u: 'Thu', sub: '22', load: '●', items: [] },
          { u: 'Fri', sub: '23', load: '●', items: [] },
          { u: 'Sat', sub: '24', load: '·', items: ['Nothing on'] },
        ],
      },
      month: { ...BASE_MONTH, headline: 'A calm stretch. Labour weekend is clear.' },
      season: BASE_SEASON,
    },
    suggestions: ["What's on this weekend?", 'When could I get three hours to paint?', 'Anything I need to know?'],
  },

  /* 4 ─────────────────────────────────────────── CONFLICT */
  {
    id: 'conflict', name: '4 · Conflict',
    date: 'Thursday 15 October', clock: '7:03am',
    headline: 'Straightforward, apart from 4 o’clock.', headlineQuiet: 'Straightforward. Sam flies out at 6.',
    weather: 'Cloudy, staying dry.',
    insights: [
      { kind: 'needs', onObject: true, text: "Sam's in two places at 4 — parent interviews and the site meeting.", facts: 'Parent interviews 4:00–4:30 (Sam, Alex) · Site meeting 3:30–4:30 (Sam) · Alex free from 2:30', action: { label: 'Sort it', focus: 'thu-clash' } },
      { kind: 'know', text: 'Sam flies out at 6 — leaving home by 4:45 is safe.', facts: 'Flight 6:00pm · airport 35 min · check-in by 5:20' },
    ],
    runs: [
      { time: '8:30', title: 'School drop-off', who: 'Sam' },
      { time: '3:00', title: 'Pickup', who: 'Alex' },
      { time: '4:00', title: 'Parent interviews', who: 'Sam · Alex', clash: true, focus: 'thu-clash' },
      { time: '4:45', title: 'Sam → airport', who: 'Sam' },
    ],
    people: [
      { name: 'Sam', day: ['Office · site meeting 3:30', 'Interviews 4:00 · flight 6:00'] },
      { name: 'Alex', day: ['Work till 2:30', 'Interviews 4:00'] },
      { name: 'Milo', day: ['School'] },
      { name: 'Isla', day: ['School'] },
    ],
    todos: ['Pack for Wellington'],
    toSort: 1,
    forward: { week: NORMAL_WEEK, month: BASE_MONTH, season: BASE_SEASON },
    suggestions: ['Anything I need to know today?', 'Can Alex do the interviews alone?', "What's on this weekend?"],
  },

  /* 5 ─────────────────────────────────────────── EVENING */
  {
    id: 'evening', name: '5 · Evening',
    date: 'Wednesday 14 October', clock: '8:40pm', mode: 'evening',
    headline: 'Nothing else needs you tonight.',
    weather: '',
    tomorrow: {
      label: 'Thursday',
      headline: 'Early start — Sam’s at the airport by 6:40.',
      weather: 'Cool and clear first thing.',
      runs: [
        { time: '6:05', title: 'Sam → airport', who: 'Sam' },
        { time: '8:30', title: 'School drop-off', who: 'Alex' },
        { time: '3:00', title: 'Pickup', who: 'Alex' },
      ],
      leaveBy: 'Sam will need to leave around 6:05.',
    },
    insights: [
      { kind: 'know', onObject: true, text: "Tomorrow's pickups are all covered by Alex.", facts: 'Drop-off 8:30 (Alex) · Pickup 3:00 (Alex) · Sam away' },
    ],
    earlier: [
      { time: '8:30', title: 'School drop-off', who: 'Alex' },
      { time: '3:00', title: 'Isla — pickup', who: 'Alex' },
      { time: '3:30', title: 'Milo — swimming', who: 'Alex' },
      { time: '7:00', title: 'Board meeting', who: 'Sam' },
    ],
    runs: [], people: [], todos: ['Pack for Wellington'], toSort: 2,
    forward: { week: NORMAL_WEEK, month: BASE_MONTH, season: BASE_SEASON },
    suggestions: ["What's tomorrow look like?", 'Remind me to charge the car', 'Read the week ahead'],
  },

  /* 6 ─────────────────────────────────────────── BIG WEEK AHEAD */
  {
    id: 'bigweek', name: '6 · Big week ahead',
    date: 'Sunday 15 November', clock: '9:20am',
    headline: 'Quiet today. A big week from tomorrow.',
    weather: 'Sunny, light wind.',
    insights: [
      { kind: 'needs', text: "Nana Jo's 70th is Saturday and the cake isn't sorted.", facts: 'Sat 21 Nov · task "Order cake" open, no date · Sam responsible', action: { label: 'Sort it', focus: 'cake' } },
      { kind: 'know', text: "Sam's in Sydney Tue–Thu, so Alex has every run.", facts: 'Sam: Sydney 17–19 · 6 drop-offs and pickups · all set to Alex' },
      { kind: 'know', text: 'Today is dry and free — a good chance to finish the fence before the week.', facts: 'Sun 15 · dry · nothing on · Back fence: second coat, 4 hrs', action: { label: 'Plan it', focus: 'fence' } },
    ],
    runs: [],
    people: [
      { name: 'Sam', day: ['Free · packing for Sydney'] },
      { name: 'Alex', day: ['Free'] },
      { name: 'Milo', day: ['Free'] },
      { name: 'Isla', day: ['Free'] },
    ],
    todos: ['Order cake for Nana Jo', 'Print Sydney boarding pass'],
    toSort: 3,
    forward: {
      week: {
        headline: 'A full week: Sam away, school production, and Nana Jo’s 70th on Saturday.',
        needs: [
          { kind: 'needs', text: "Wed — production night. Isla needs her costume by Tuesday.", facts: 'School production Wed 6:30 · costume note from school · no task yet', action: { label: 'Sort it', focus: 'costume' } },
          { kind: 'needs', text: "Sat — the 70th. Cake, present and a card still open.", facts: '3 open tasks linked to Sat 21', action: { label: 'Sort it', focus: 'cake' } },
          { kind: 'know', text: "Sam's away Tue–Thu; all runs are Alex's.", facts: 'Sydney 17–19' },
          { kind: 'know', text: "Fri evening you're both free — first time in three weeks.", facts: 'Fri 20 · no commitments after 5 · Nana Jo could have the kids (Sat is at hers)' },
        ],
        units: [
          { u: 'Mon', sub: '16', load: '●●', items: ['Sam packs', 'Costume note due'] },
          { u: 'Tue', sub: '17', load: '●●●', items: ['Sam → Sydney 7am', 'Costume to school'] },
          { u: 'Wed', sub: '18', load: '●●●', items: ['School production 6:30', 'Swimming 3:30'] },
          { u: 'Thu', sub: '19', load: '●●', items: ['Sam home 9pm'] },
          { u: 'Fri', sub: '20', load: '●', items: ['Evening free — both of you'] },
          { u: 'Sat', sub: '21', load: '●●●', items: ["Nana Jo's 70th, lunch at hers", 'Football 9:00'], wx: 'Fine' },
          { u: 'Sun', sub: '22', load: '·', items: ['Nothing on'] },
        ],
      },
      month: {
        headline: 'November is the busy one. December is close behind.',
        needs: [
          { kind: 'needs', text: "Nana Jo's 70th (Sat 21) — three things still open.", facts: 'Cake · present · card' },
          { kind: 'know', text: 'School ends 16 Dec; the break is still unplanned.', facts: 'No bookings or travel found' },
        ],
        units: [
          { u: 'This week', load: '●●●', note: 'big', items: ['Sam in Sydney Tue–Thu', 'Production Wed', "70th Sat"] },
          { u: '23–29 Nov', load: '●', note: 'quiet', items: ['Dentist (Isla) Thu'] },
          { u: '30 Nov–6 Dec', load: '●●', note: 'steady', items: ['Prizegiving Fri'] },
          { u: '7–13 Dec', load: '●●', note: 'steady', items: ['Work Christmas do (Sam) Fri'] },
        ],
      },
      season: {
        headline: 'Busy till Christmas, then wide open.',
        texture: '▅▇▃▅▅▆▇▇▂▁▁▁▂',
        needs: [
          { kind: 'know', text: 'Nothing is booked for the school holidays yet.', facts: '16 Dec – 2 Feb · no travel or bookings' },
          { kind: 'know', text: "Milo turns 10 on 28 Dec — three days after Christmas.", facts: 'No plan linked' },
        ],
        months: [
          { u: 'November', items: ["Nana Jo's 70th 21st", 'Sam in Sydney 17–19', 'Production 18th'] },
          { u: 'December', items: ['Prizegiving 4th', 'School ends 16th', 'Christmas', 'Milo turns 10'] },
          { u: 'January', items: ['Nothing planned'] },
        ],
      },
    },
    suggestions: ['Read the week ahead', "What's Saturday look like?", 'Add getting a present for Nana Jo'],
  },
];
