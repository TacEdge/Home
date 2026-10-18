import 'server-only';
import { CLARITY, RATING_LABELS, RUBRIC, TONE, USEFULNESS, transcriptsDigest } from './quality';
import { REVIEW_CATEGORY_LABELS, REVIEW_SET, type ReviewCategory } from './review-set';
import type { Citation, Transcript, TranscriptTurn } from './transcript';

// The owner's review page (M8 Package 5C; ADR 0012 §58): the review set's
// transcripts as one self-contained HTML file, in HOME's design language
// (src/ui/tokens.css: Morning paper, Pine ink, one warm accent; the Kev
// screen's answer layout), for a quick read at phone width. The owner rates
// each answer (useful, clear, natural, with an optional note); the page
// keeps the ratings in this browser only and downloads them as a review
// sheet (src/kev/evals/quality.ts), bound to these transcripts by digest.
// Nothing is sent anywhere: no network, no external file. Every text is
// escaped. Synthetic only, written beside the run's other outputs.

/** The review set's transcripts for one tier configuration, in the set's order (repeat 1). */
export function reviewTranscripts(all: readonly Transcript[], tier: 'fast' | 'deep'): Transcript[] {
  return REVIEW_SET.flatMap((e) => {
    const t = all.find((x) => x.scenario === e.scenario && x.tier === tier && x.repeat === 1);
    return t ? [t] : [];
  });
}

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const NAME = { sam: 'Sam', alex: 'Alex' } as const;

const RESULT: Readonly<Record<string, string>> = {
  first_pass: 'Accepted first time',
  after_regeneration: 'Accepted after one regeneration',
  after_escalation: 'Accepted after moving to deep',
  salvaged: 'Model’s words withheld; HOME’s lead over the checked facts',
  fallback: 'Nothing accepted; HOME’s fixed reply',
  no_answer: 'No answer stored',
};

const SIGNAL_TEXT: Readonly<Record<string, string>> = {
  fallback: 'Kev couldn’t give an answer that passed: HOME’s fixed reply was shown.',
  salvaged: 'The model’s own lead was withheld; HOME’s lead was shown over the checked facts.',
  regenerated: 'The first answer was rejected and regenerated.',
  escalated: 'Moved to the deep tier.',
  extra_citations: 'Cites records the scenario did not expect.',
  no_facts: 'An answer with no facts.',
  declined: 'A decline.',
  error: 'The turn ended in an error.',
};

const LIMIT_TEXT: Readonly<Record<string, string>> = {
  scripted_choice: 'a script chose the records and the lead',
  scripted_misbehaviour: 'the script misbehaves on purpose, to test HOME’s check',
  decline_only: 'the script declines without reading',
  fixed_text: 'what is shown is HOME’s fixed text',
};

function cites(list: readonly Citation[]): string {
  if (list.length === 0) return '';
  return `<ul class="cites" aria-label="What this answer cites">${list
    .map((c) => `<li><span>${esc(c.label)}</span><span class="kind">${esc(c.type)}</span></li>`)
    .join('')}</ul>`;
}

function turn(t: TranscriptTurn, asker: 'sam' | 'alex', last: boolean): string {
  const facts = t.facts.map((b) => `<p class="fact">${esc(b.text)}</p>`).join('');
  const view = t.view
    .map((b) => `<div class="view"><p class="label">Kev’s view</p><p>${esc(b.text)}</p></div>`)
    .join('');
  const limits = t.limits.map((l) => `<p class="limit">${esc(l)}</p>`).join('');
  return `<div class="turn${last ? '' : ' earlier'}">
  ${t.clearedBefore ? '<p class="cleared">The conversation was cleared before this question.</p>' : ''}
  <p class="asked">${NAME[asker]} asks · ${esc(t.askedAt)}</p>
  <p class="q">${esc(t.question)}</p>
  <div class="answer">
    ${t.say ? `<p class="say">${esc(t.say)}</p>` : '<p class="say muted">No answer shown.</p>'}
    ${facts}${view}${limits}
    ${cites(t.citations)}
  </div>
</div>`;
}

function how(t: Transcript): string {
  const scripted = t.mode === 'scripted';
  return t.turns
    .map((x, i) => {
      const tools =
        x.tools.length === 0
          ? 'none (the answer came from the turn’s own bundle)'
          : x.tools
              .map(
                (r) =>
                  `${esc(r.tool)}${r.ok ? ` → ${r.results} result${r.results === 1 ? '' : 's'}` : ` → ${esc(r.code ?? 'failed')}`}`,
              )
              .join('; ');
      const rejected =
        x.check.rejectedCodes.length === 0
          ? ''
          : `<li>Rejected answers (closed codes only): ${x.check.rejectedCodes
              .map((c) => esc(c.join(', ') || 'no code'))
              .join(' · ')}</li>`;
      const cost =
        x.costUsdMicros === null
          ? '—'
          : scripted
            ? 'scripted (not a real cost)'
            : `US$${(Number(x.costUsdMicros) / 1_000_000).toFixed(4)}`;
      const time =
        x.ms === null
          ? '—'
          : scripted
            ? 'scripted (not a real time)'
            : `${(x.ms / 1000).toFixed(2)} s`;
      return `<ul class="facts">
  ${t.turns.length > 1 ? `<li class="turnlabel">Question ${i + 1}</li>` : ''}
  <li>Reads: ${tools}</li>
  <li>Answer check: ${esc(RESULT[x.check.result] ?? x.check.result)}${x.check.escalated ? ` · escalated (${esc(x.check.escalation ?? 'reason not recorded')})` : ''}</li>
  ${rejected}
  <li>Model calls: ${x.modelCalls ?? '—'} · tool rounds: ${x.toolRounds ?? '—'}</li>
  <li>Time to the checked answer: ${time} · cost: ${cost}</li>
</ul>`;
    })
    .join('');
}

function radios(key: string, field: string, values: readonly string[]): string {
  return `<div class="choices" role="radiogroup" aria-label="${field}">${values
    .map(
      (v) =>
        `<label><input type="radio" name="${esc(`${key}::${field}`)}" value="${v}" data-key="${esc(key)}" data-field="${field}"><span>${RATING_LABELS[v]}</span></label>`,
    )
    .join('')}</div>`;
}

function card(t: Transcript, i: number, n: number): string {
  const category = (t.review?.category ?? 'everyday') as ReviewCategory;
  const auto = t.automated.pass
    ? '<span class="pass">Passed every automated check</span>'
    : `<span class="fail">Failed: ${esc(t.automated.failed.join(', '))}</span>`;
  const signals = t.signals.map((g) => `<li>${esc(SIGNAL_TEXT[g] ?? g)}</li>`).join('');
  return `<article class="card" id="${esc(t.key)}" aria-labelledby="h-${i}">
  <header>
    <span class="chip">${esc(REVIEW_CATEGORY_LABELS[category])}</span>
    <span class="count">${i + 1} of ${n}</span>
  </header>
  <h2 id="h-${i}">${esc(t.turns.at(-1)!.question)}</h2>
  <p class="meta">${esc(t.scenario)} · ${t.tier} · ${t.mode}</p>
  ${t.review ? `<p class="focus"><strong>Look for:</strong> ${esc(t.review.focus)}</p>` : ''}
  ${t.turns.map((x, j) => turn(x, t.asker, j === t.turns.length - 1)).join('')}
  <details class="how"><summary>How HOME got there</summary>
    <p class="note">${esc(t.note)}</p>
    ${t.acceptable ? `<p class="note"><strong>A good answer:</strong> ${esc(t.acceptable)}</p>` : ''}
    ${how(t)}
  </details>
  <div class="auto"><p class="label">HOME’s automated check</p><p>${auto}</p>
    ${signals ? `<ul class="signals">${signals}</ul>` : ''}
    ${t.scriptedLimits ? `<p class="limitnote">Scripted: ${esc(t.scriptedLimits.map((l) => LIMIT_TEXT[l] ?? l).join('; '))}.</p>` : ''}
  </div>
  <fieldset class="rate" data-key="${esc(t.key)}">
    <legend>Your judgement</legend>
    <p class="label">Would this help the family?</p>${radios(t.key, 'usefulness', USEFULNESS)}
    <p class="label">Clarity</p>${radios(t.key, 'clarity', CLARITY)}
    <p class="label">Tone</p>${radios(t.key, 'tone', TONE)}
    <label class="label" for="fb-${i}">A short note (optional)</label>
    <textarea id="fb-${i}" maxlength="500" rows="2" data-key="${esc(t.key)}" data-field="feedback"></textarea>
  </fieldset>
</article>`;
}

const CSS = `
:root{--paper:#f6f4ee;--paper-2:#ebe7dc;--ink:#1f3b36;--ink-2:#4f6b62;--muted:#5a6b64;--line:#d9d4c6;--accent:#f0a05a;--accent-soft:#fbe7d3;--ok:#a8c3a0;--plum:#6e5a86;
--font-display:'Bricolage Grotesque','Avenir Next','Segoe UI',system-ui,sans-serif;--font-sans:'Figtree','Avenir Next','Segoe UI',system-ui,sans-serif;--font-mono:'DM Mono','SFMono-Regular',Menlo,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#161d1b;--paper-2:#212a27;--ink:#ece8de;--ink-2:#b9c4bf;--muted:#8e9b96;--line:#303936;--accent:#f2b072;--accent-soft:#3a2a1b;--ok:#7e9a78;--plum:#a893c3;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.5 var(--font-sans)}
main{max-width:640px;margin:0 auto;padding:24px 16px 96px}
h1{font:600 30px/1.15 var(--font-display);margin:8px 0 4px}h2{font:500 22px/1.25 var(--font-display);margin:12px 0 2px}
.lede{color:var(--ink-2);margin:0 0 16px}.banner{background:var(--accent-soft);border-radius:14px;padding:12px 16px;margin:16px 0}
.label,.meta,.count,.asked,.kind{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card{border-top:1px solid var(--line);padding:24px 0}.card header{display:flex;justify-content:space-between;align-items:center;gap:8px}
.chip{border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:14px;color:var(--ink-2)}
.focus{color:var(--ink-2);margin:8px 0}.turn{margin-top:16px}.turn.earlier{opacity:.8}
.q{margin:2px 0 0;padding:10px 14px;background:var(--paper-2);border-radius:14px;margin-left:auto;max-width:90%;width:fit-content}
.answer{margin-top:12px}.say{font:500 22px/1.25 var(--font-display);margin:0}.say.muted{color:var(--muted)}
.fact{margin:6px 0 0}.view{margin-top:12px;border-left:3px solid var(--plum);padding-left:12px}.view p:last-child{color:var(--ink-2);margin:2px 0 0}
.limit{color:var(--ink-2);font-size:15px;margin:8px 0 0}.cleared{color:var(--muted);font-size:15px}
.cites{list-style:none;padding:0;margin:12px 0 0;border-top:1px solid var(--line)}.cites li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.how{margin-top:16px}.how summary{cursor:pointer;color:var(--ink-2);min-height:44px;display:flex;align-items:center}
.facts{margin:4px 0 8px;padding-left:18px;color:var(--ink-2);font-size:15px}.turnlabel{list-style:none;margin-left:-18px;font-weight:600}.note{font-size:15px;color:var(--ink-2)}
.auto{margin-top:12px}.auto p{margin:2px 0}.pass::before{content:'';display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--ok);margin-right:8px}
.fail::before{content:'';display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:8px}
.signals{margin:6px 0;padding-left:18px;font-size:15px;color:var(--ink-2)}.limitnote{font-size:14px;color:var(--muted)}
.rate{border:1px solid var(--line);border-radius:14px;margin:16px 0 0;padding:12px 16px}.rate legend{font-weight:600;padding:0 6px}
.choices{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 10px}.choices label{position:relative}
.choices input{position:absolute;opacity:0;inset:0}.choices span{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:999px;cursor:pointer}
.choices input:checked+span{background:var(--ink);color:var(--paper);border-color:var(--ink)}.choices input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
textarea{width:100%;font:inherit;color:inherit;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--paper-2);border-top:1px solid var(--line);padding:10px 16px}
.bar div{max-width:640px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px}
button{font:inherit;min-height:44px;padding:0 16px;border-radius:999px;border:0;background:var(--ink);color:var(--paper);cursor:pointer}
.rubric{margin:8px 0 16px}.rubric summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--ink-2)}.rubric dt{font-weight:600;margin-top:8px}.rubric dd{margin:0;color:var(--ink-2);font-size:15px}
`;

const SCRIPT = `
(function(){
  var cfg=JSON.parse(document.getElementById('review-config').textContent);
  var storeKey='kev-review:'+cfg.digest;var state={};
  try{state=JSON.parse(localStorage.getItem(storeKey)||'{}')||{}}catch(e){state={}}
  function save(){try{localStorage.setItem(storeKey,JSON.stringify(state))}catch(e){}progress()}
  function progress(){var n=cfg.keys.filter(function(k){var s=state[k];return s&&(s.usefulness||s.clarity||s.tone)}).length;document.getElementById('progress').textContent=n+' of '+cfg.keys.length+' rated'}
  document.querySelectorAll('input[type=radio]').forEach(function(el){var s=state[el.dataset.key];if(s&&s[el.dataset.field]===el.value)el.checked=true;
    el.addEventListener('change',function(){(state[el.dataset.key]=state[el.dataset.key]||{})[el.dataset.field]=el.value;save()})});
  document.querySelectorAll('textarea').forEach(function(el){var s=state[el.dataset.key];if(s&&s.feedback)el.value=s.feedback;
    el.addEventListener('input',function(){(state[el.dataset.key]=state[el.dataset.key]||{}).feedback=el.value.slice(0,500);save()})});
  document.getElementById('download').addEventListener('click',function(){
    var scores=cfg.keys.filter(function(k){return state[k]}).map(function(k){var s=state[k];var o={key:k};
      ['usefulness','clarity','tone'].forEach(function(f){if(s[f])o[f]=s[f]});var fb=(s.feedback||'').trim();if(fb)o.feedback=fb;return o})
      .filter(function(o){return o.usefulness||o.clarity||o.tone||o.feedback});
    var sheet={format:'home-kev-quality-review',version:1,mode:cfg.mode,transcripts:cfg.digest,scores:scores};
    var url=URL.createObjectURL(new Blob([JSON.stringify(sheet,null,2)],{type:'application/json'}));
    var a=document.createElement('a');a.href=url;a.download='kev-review-'+cfg.mode+'-'+cfg.tier+'.json';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)});
  progress();
})();
`;

/** The review page for a set of transcripts (one mode, one tier configuration). */
export function reviewPageHtml(
  transcripts: readonly Transcript[],
  opts: { mode: 'scripted' | 'live'; tier: 'fast' | 'deep' },
): string {
  if (transcripts.some((t) => t.mode !== opts.mode || t.tier !== opts.tier))
    throw new Error('review page: every transcript must be of the page’s mode and tier');
  const digest = transcriptsDigest(transcripts);
  const config = JSON.stringify({
    digest,
    mode: opts.mode,
    tier: opts.tier,
    keys: transcripts.map((t) => t.key),
  }).replaceAll('<', '\\u003c');
  const banner =
    opts.mode === 'scripted'
      ? '<p class="banner"><strong>Scripted answers.</strong> A hand-written script chose each answer’s records and lead, so these pages show how HOME renders, checks and limits an answer, not how well a real model answers. Use them to try the review; judge Kev’s quality on a live run’s page.</p>'
      : '<p class="banner"><strong>Live answers</strong> from the real model on the evaluation key, on synthetic scenarios only.</p>';
  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kev answer review</title>
<style>${CSS}</style>
</head>
<body>
<main>
<p class="label">HOME · Kev · ${opts.tier} tier · ${opts.mode}</p>
<h1>Kev answer review</h1>
<p class="lede">${transcripts.length} synthetic questions from the evaluation. For each: would this answer genuinely help the family understand, organise or act on something?</p>
${banner}
<details class="rubric"><summary>What to judge (the rubric)</summary><dl>${RUBRIC.map(
    (d) => `<dt>${esc(d.name)}</dt><dd>${esc(d.question)}</dd>`,
  ).join(
    '',
  )}</dl><p class="note">HOME’s automated check is shown with each answer and is kept apart from your judgement: your ratings never change it, and it never fills them in.</p></details>
${transcripts.map((t, i) => card(t, i, transcripts.length)).join('\n')}
</main>
<div class="bar"><div><span id="progress" aria-live="polite"></span><button id="download" type="button">Download review sheet</button></div></div>
<script type="application/json" id="review-config">${config}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
