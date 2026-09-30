/* HOME prototype — scripted Kev. No AI. Pattern-matches a handful of intents and
   answers from the current fixture. The point is the interaction pattern, not intelligence.

   A reply is a list of blocks:
   { say }  { detail }  { cite: [[title, meta], ...] }  { plan: [[step, meta], ...] }
   { proposal: { title, meta, yes, action } }  { basis }  { text } */

const KEV = (() => {
  const P = (title, meta, yes, action) => ({ proposal: { title, meta, yes: yes || 'Yes', action } });

  function intentOf(text) {
    const t = text.toLowerCase().trim();
    if (/week ahead/.test(t)) return 'weekahead';
    if (/^(add|remind|remember|we need|we should|need to|note|put|book|get|sort|buy|order|fix|call|pay)\b/.test(t) || /\bremind me\b|\bshould probably\b|\bsomething about\b/.test(t)) return 'tell';
    if (/anything (i|we) (need|should)|need to know|should i know/.test(t)) return 'need';
    if (/(when|where) could|hours? to|free window|find (me|us) (a|some|three)|time to paint|get .* done/.test(t)) return 'window';
    if (/saturday/.test(t)) return 'saturday';
    if (/weekend/.test(t)) return 'weekend';
    if (/tomorrow/.test(t)) return 'tomorrow';
    if (/today|happening|what's on|whats on|tell me about/.test(t)) return 'today';
    if (/pickup|pick up|3:30|interview|clash|who can/.test(t)) return 'sort';
    if (/plan|painting|fence|garage/.test(t)) return 'plan';
    return 'unknown';
  }

  /* Compound capture rule:
     - split when the parts are clearly independently actionable (each starts with its own verb);
     - keep together when the second part qualifies the first ("… and see if we can find a nicer one");
     - keep together, unstructured, when the intent is genuinely uncertain ("should probably … maybe …"). */
  function splitCapture(text) {
    const t = text.trim().replace(/[.!]$/, '');
    if (/maybe|probably|not sure|might/i.test(t)) return [t];
    const parts = t.split(/\s+and\s+/i);
    if (parts.length < 2) return [t];
    const verb = /^(remind( me)?( to)?|book|get|buy|order|add|call|pay|sort|fix|email|text|ring|ask|renew|cancel|sign|print|pack|check)\b/i;
    return parts.every(p => verb.test(p.trim())) ? parts.map(p => p.trim()) : [t];
  }

  // Turn "add sorting the garage light" into a task title.
  function titleFrom(text) {
    let t = text.trim().replace(/[.!]$/, '');
    t = t.replace(/^(please\s+)?(add|remind me to|remind me (that )?we need to|remind me (that )?|remember (that )?|note (that )?|we need to|we should (probably )?|need to|put)\s+/i, '');
    t = t.replace(/^(sorting|fixing|booking|getting|buying|ordering)\s+/i, (m) => ({ sorting: 'Sort ', fixing: 'Fix ', booking: 'Book ', getting: 'Get ', buying: 'Buy ', ordering: 'Order ' }[m.trim().toLowerCase()]));
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function guessHome(title) {
    const t = title.toLowerCase();
    if (/garage/.test(t)) return { where: 'Home · Garage', est: 'about an hour' };
    if (/fence|paint/.test(t)) return { where: 'Home · Back fence', est: 'about 3 hours · dry' };
    if (/car|wof|tyre|service/.test(t)) return { where: 'Life admin · Car', est: '' };
    if (/present|gift|cake|card|birthday/.test(t)) return { where: 'Family · Nana Jo', est: 'by Fri 20', priv: true };
    if (/charge/.test(t)) return { where: 'Tonight', est: '' };
    return { where: 'To do', est: '' };
  }

  const R = {
    today(s) {
      if (s.mode === 'evening') return R.tomorrow(s);
      const runs = s.runs.filter(r => r.time);
      const gaps = runs.filter(r => r.gap);
      const out = [];
      if (s.id === 'quiet') {
        out.push({ say: "Nothing on. Football's off — wet pitch — so the day's yours." });
        out.push({ detail: 'Dry and mild all day. If you fancy the fence, the morning suits.' });
        out.push({ cite: [['Football 9:00 — cancelled', 'Milo'], ['Sat 17 · dry, 15°', 'forecast']] });
        return out;
      }
      if (s.id === 'chaos') {
        out.push({ say: 'Full day. The 3:30 is the problem — three things at once and nobody down for two of them.' });
        out.push({ detail: "Sam's got the site meeting and Milo's dentist at the same time; Alex is on a cover shift till 6. Both of you are out this evening." });
        out.push({ cite: [['3:00 Isla — pickup', 'nobody'], ['3:30 Milo — dentist', 'Sam · clash'], ['3:30 Milo — swimming', 'nobody · clash'], ['5:15 Swimming pickup', 'nobody']] });
        out.push({ text: 'Want me to work through the 3:30s?' });
        return out;
      }
      out.push({ say: s.headline });
      if (gaps.length) out.push({ detail: `${gaps.length === 1 ? 'One run needs a name against it' : gaps.length + ' runs need names against them'}: ${gaps.map(g => g.title.replace(' — ', ' ')).join(', ')}.` });
      else if (runs.length) out.push({ detail: 'Runs are all covered.' });
      out.push({ cite: runs.map(r => [`${r.time} ${r.title}`, r.gap ? 'nobody yet' : r.who]) });
      return out;
    },

    tomorrow(s) {
      if (s.tomorrow) {
        const t = s.tomorrow;
        return [
          { say: t.headline },
          { detail: `${t.leaveBy} ${t.weather} After that it's an ordinary Thursday — Alex has drop-off and pickup.` },
          { cite: t.runs.map(r => [`${r.time} ${r.title}`, r.who]) },
        ];
      }
      const u = s.forward.week.units[0];
      return [{ say: `Tomorrow's ${u.load === '·' ? 'clear' : u.load.length > 2 ? 'a full one' : 'steady'}.` }, { detail: u.items.length ? u.items.join(' · ') + '.' : 'Just the usual.' }];
    },

    saturday(s) {
      if (s.id === 'bigweek') return [
        { say: "Saturday's Nana Jo's 70th — lunch at hers from 12." },
        { detail: "Football's at 9 first, so it'll be a quick turnaround. Cake, present and card are still open." },
        { cite: [['9:00 Football', 'Milo · Alex'], ["12:00 Nana Jo's 70th", 'everyone'], ['Order cake · Get present · Card', '3 open']] },
      ];
      if (s.id === 'chaos') return [
        { say: 'Just football at 9. Showers, so take the big coats.' },
        { cite: [['9:00 Football', 'Milo · Sam'], ['Sat 24 · showers, 13°', 'forecast']] },
      ];
      return [
        { say: 'Pretty clear. Football at 9, then nothing until Sunday lunch.' },
        { detail: 'Dry all morning — the back fence would fit between 9 and 12 if Sam wants it. Showers Sunday afternoon.' },
        { cite: [['9:00 Football', 'Milo · Alex'], ['Sat 17 · 9:00–12:00', 'Sam free · dry, 15°'], ['Sun 18', 'nothing on · showers pm']] },
      ];
    },

    weekend(s) { return R.saturday(s).concat([{ basis: 'Based on: your calendars (updated 7:00), forecast (6:45).' }]); },

    need(s) {
      const needs = s.insights.filter(i => i.kind === 'needs');
      if (!needs.length) {
        if (s.mode === 'evening') return [{ say: "Nothing tonight. Tomorrow's early start is the only thing — Sam's leaving at 6:05." }];
        return [{ say: 'Nothing that needs you.' }, { detail: s.insights.length ? s.insights[0].text : 'It’s a plain day.' }];
      }
      const out = [{ say: needs.length === 1 ? 'One thing.' : `${needs.length} things.` }];
      out.push({ detail: needs.map(n => n.text).join(' ') });
      const knows = s.insights.filter(i => i.kind === 'know');
      if (knows.length) out.push({ text: 'Also — ' + knows[0].text.charAt(0).toLowerCase() + knows[0].text.slice(1) });
      out.push({ cite: needs.map(n => [n.text.split('.')[0], 'needs you']) });
      return out;
    },

    window(s) {
      if (s.id === 'chaos') return [
        { say: 'Not this week, honestly. Saturday morning is the first real gap, and it’s showery.' },
        { detail: 'Sunday 25th looks dry and empty — three hours from 9 would work.' },
        { cite: [['Sun 25 · 9:00–12:00', 'dry · nothing on']] },
        P('Put "Paint the back fence" in Sunday 9:00–12:00?', 'Home · Back fence · Shared', 'Yes', 'schedule'),
      ];
      if (s.id === 'quiet' || s.id === 'bigweek') return [
        { say: 'Today, if you’re up for it. Dry, and nothing’s on until this evening.' },
        { detail: 'From 9 gives you the morning with time to spare.' },
        { cite: [[`${s.date.split(' ')[0]} · 9:00–12:00`, 'dry · nothing on']] },
        P('Put "Paint the back fence" in today, 9:00–12:00?', 'Home · Back fence · Shared', 'Yes', 'schedule'),
      ];
      return [
        { say: 'Saturday, 9 till 12, looks best.' },
        { detail: "Dry all morning and nothing's on until football at 1. Sunday turns showery after lunch." },
        { cite: [['Sat 17 · 9:00–12:00', 'dry, 15°'], ['Sat 17 · 1:00 Football', 'Milo']] },
        P('Put "Paint the back fence" in Saturday 9:00–12:00?', 'Home · Back fence · Shared', 'Yes', 'schedule'),
      ];
    },

    tell(s, text) {
      const parts = splitCapture(text);
      const out = [{ kept: true }];
      if (parts.length > 1) {
        out.push({ say: parts.length === 2 ? 'Two things:' : `${parts.length} things:` });
        parts.forEach(pt => { const t = titleFrom(pt); const g = guessHome(t); out.push(P(t, [g.where, g.est, g.priv ? 'Just you' : 'Shared'].filter(Boolean).join(' · '), 'Add', 'task')); });
        out.push({ yesall: true });
        return out;
      }
      const title = titleFrom(text);
      const g = guessHome(title);
      if (/\band\b/.test(text) && /maybe|probably|not sure|might/i.test(text)) {
        out.push({ say: "I've kept that as one thought for now — it isn't clear yet what it should become." });
        out.push({ text: 'Say the word when you want to turn it into something.' });
        return out;
      }
      if (/\band\b/.test(text)) {
        out.push({ say: 'One thing, with a note — the second part shapes the first.' });
        out.push(P(title.split(/\s+and\s+/)[0], [g.where, g.est, 'Shared', 'note: ' + title.split(/\s+and\s+/).slice(1).join(' and ')].filter(Boolean).join(' · '), 'Add', 'task'));
        return out;
      }
      const lead = /garage/i.test(title) ? 'Goes with the Garage project, I think.'
        : g.priv ? "I'll keep this one just for you, since it's a present." : 'Here’s where I’d put it.';
      out.push({ say: lead });
      out.push(P(title, [g.where, g.est, g.priv ? 'Just you' : 'Shared with ' + (s.people[0] && s.people[0].name === 'Sam' ? 'Alex' : 'Sam')].filter(Boolean).join(' · '), 'Add', 'task'));
      return out;
    },

    sort(s, text, focus) {
      const f = focus || (s.id === 'chaos' ? 'pickups' : s.id === 'conflict' ? 'thu-clash' : 'isla-pickup');
      const map = {
        'isla-pickup': [
          { say: 'Alex finishes at 2:30 and is free until swimming at 3:30.' },
          P('Alex does Isla’s pickup at 3:00', 'Today · Shared', 'Yes', 'assign'),
        ],
        'pickups': [
          { say: 'Here’s the least-bad version.' },
          { detail: "Alex can grab Isla at 3:00 before the cover shift if it starts at 3:15 rather than 3 — worth a text. Swimming's the harder one: Nana Jo is free Mondays and has done it before." },
          P('Alex does Isla’s pickup at 3:00', 'Today · Shared', 'Yes', 'assign'),
          P('Ask Nana Jo to do swimming (3:30 drop, 5:15 pickup)', 'Today · Shared · you send the message', 'Yes', 'assign'),
          { yesall: true },
          { text: "Sam's dentist-and-site clash I can't fix — one of them has to move." },
        ],
        'sam-clash': [
          { say: 'One of them has to move. The dentist is the easier call — they had 4:15 free last time.' },
          P('Move Milo’s dentist to 4:15', 'Today · Shared · you make the call', 'Yes', 'assign'),
        ],
        'thu-clash': [
          { say: 'Alex is free from 2:30 and can do the interviews alone; Sam stays at the site meeting.' },
          P('Alex does parent interviews (4:00); Sam not attending', 'Thu 15 · Shared', 'Yes', 'assign'),
          { text: 'Or Sam could ask to move the site meeting earlier — your call.' },
        ],
        'fri-pickup': [
          { say: 'Alex finishes at 2:30 Friday, so pickup at 3 is easy — it just isn’t written down.' },
          P('Alex does Friday pickup at 3:00', 'Fri 16 · Shared', 'Yes', 'assign'),
        ],
        'cake': [
          { say: "The cake needs ordering by Wednesday to be safe. Sam's away Tue–Thu, so it's really today or tomorrow." },
          P('Order cake for Nana Jo — by Mon 16', 'Family · Nana Jo · Sam · Shared', 'Yes', 'task'),
        ],
        'costume': [
          { say: "Isla's costume needs to be at school Tuesday. Tomorrow evening's the only real gap before then." },
          P('Sort Isla’s costume — Mon evening', 'Family · Isla · Alex · Shared', 'Yes', 'task'),
        ],
      };
      return map[f] || map['isla-pickup'];
    },

    plan(s, text, focus) {
      if (/exterior|painting|plan/.test((text || '').toLowerCase()) && !/fence/.test((text || '').toLowerCase())) {
        return [
          { say: 'Here’s a sensible order: prep, then two coats, all needing dry days. About 12 hours all up.' },
          { plan: [['1 Wash and sand walls', '3 hrs · dry'], ['2 Buy paint and rollers', '1 hr'], ['3 First coat', '4 hrs · dry'], ['4 Second coat', '4 hrs · dry']] },
          P('Start "Exterior painting" with these 4 tasks', 'Home · Shared', 'Yes', 'project'),
          { text: 'Want me to find a dry window for step 1 once that’s set up?' },
        ];
      }
      return R.window(s);
    },

    weekahead(s) {
      const w = s.forward.week;
      const needs = w.needs.filter(n => n.kind === 'needs');
      const knows = w.needs.filter(n => n.kind === 'know');
      return [
        { say: w.headline },
        { section: 'Needs coordination', lines: needs.length ? needs.map(n => n.text) : ['Nothing.'] },
        { section: 'Potential conflicts', lines: needs.filter(n => /two places|clash/.test(n.text)).map(n => n.text).concat(needs.some(n => /two places|clash/.test(n.text)) ? [] : ['None found.']) },
        { section: 'Family opportunities', lines: knows.length ? knows.map(n => n.text) : ['A quiet one — good for nothing in particular.'] },
        { section: 'Home', lines: [s.id === 'bigweek' ? 'Back fence: second coat could go on today.' : 'Back fence: 2 of 5 done. Saturday morning is dry.'] },
        { section: 'You two', lines: [s.id === 'bigweek' ? "Friday evening you're both free — first time in three weeks." : 'Nothing free this week. Next Thursday evening is the first gap.'] },
        { section: 'Coming over the horizon', lines: s.id === 'bigweek' ? ['School ends 16 Dec; the break is unplanned.', 'Milo turns 10 on 28 Dec.'] : ["Nana Jo's 70th on 21 Nov.", 'Sam in Sydney 10–12 Nov.'] },
        { section: 'To sort', lines: [s.toSort ? `${s.toSort} thing${s.toSort > 1 ? 's' : ''} waiting.` : 'Nothing waiting.'] },
        { basis: 'Based on: your calendars (updated 7:00), forecast (6:45), projects, what you’ve told me.' },
      ];
    },

    unknown() {
      return [
        { say: "I'm not sure about that one." },
        { detail: 'In this prototype I can answer things like "What\'s happening today?", "What does Saturday look like?", "When could I get three hours to paint?", "Anything I need to know?", "Read the week ahead" — or tell me something to keep.' },
      ];
    },
  };

  function reply(scenario, text, focus) {
    const intent = focus ? (/(fence)/.test(focus) ? 'plan' : 'sort') : intentOf(text);
    const fn = R[intent] || R.unknown;
    return { intent, blocks: fn(scenario, text, focus) };
  }

  return { reply, intentOf, titleFrom };
})();
