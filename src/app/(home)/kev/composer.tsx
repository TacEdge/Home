'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
  COMPOSER_LABEL,
  COMPOSER_PLACEHOLDER,
  FOCUS_TODAY,
  RELOAD,
  SEND,
  SENDING,
  STREAM_DROPPED,
  SUGGESTIONS_LABEL,
} from './copy';

// Kev's composer (M8 contract §11.2–§11.4; D17): the screen's one input.
//
// Without JavaScript it is a plain form posting to /kev/turn, which runs the
// turn to completion and returns to /kev with the stored answer. With
// JavaScript the same post asks for the event stream, a small progressive
// enhancement with no dependency:
//   - the person's words appear at once and the box clears ("Sending");
//   - one working line, HOME's fixed text for what Kev is looking at, in
//     muted ink, replaced as the turn moves on: a status region that is not
//     announced on every change;
//   - the answer arrives whole, once checked and stored, and is announced
//     once through a polite live region; the page then re-reads the stored
//     conversation (the same rendering as without JavaScript) and focus
//     returns to the box;
//   - an error is HOME's line, announced as an alert; if the words were not
//     stored (the stream never said `started`), they go back in the box;
//   - a dropped connection says so: the turn goes on without it, and its
//     answer is there on reload.
// No animation, so nothing to reduce. Nothing is kept on the device.

const MAX_CHARS = 2_000;
const COUNT_FROM = 1_800;
const OUTCOMES = new Set(['answer', 'declined', 'fallback', 'refused']);

type StreamEvent = { event: string; data: Record<string, unknown> };

/** The Server-Sent Events of a response body, as they arrive. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(data || '{}') as Record<string, unknown>;
      } catch {
        // not one of HOME's events
      }
      yield { event, data: parsed };
    }
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function Composer({
  focusToday,
  suggestions,
  notSaved,
  initialError,
}: {
  focusToday: boolean;
  /** Static questions chosen by code, on a day with no turns yet (§11.2). */
  suggestions: string[];
  /** HOME's line for a request that never reached Kev (nothing was saved). */
  notSaved: string;
  /** An error from a form post without JavaScript, said once. */
  initialError: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [dropped, setDropped] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [focus, setFocus] = useState(focusToday);
  const [asked, setAsked] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  async function send(words: string) {
    if (busy || !/\S/.test(words) || words.length > MAX_CHARS) return;
    setBusy(true);
    setAsked(true);
    setError(null);
    setDropped(false);
    setAnnounce('');
    setWorking(null);
    setPending(words);
    setText('');
    let stored = false;
    let ended = false;
    let failed: string | null = null;
    let progressSaid = false;
    try {
      const res = await fetch('/kev/turn', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ text: words, ...(focus ? { focus: 'today' } : {}) }),
      });
      if (!res.ok || !res.body) {
        let message = notSaved;
        try {
          const body = (await res.json()) as { message?: unknown };
          if (typeof body.message === 'string') message = body.message;
        } catch {
          // no body: HOME's own line
        }
        failed = message;
        ended = true;
      } else {
        for await (const e of readEvents(res.body)) {
          if (e.event === 'started') stored = true;
          else if (e.event === 'working' || e.event === 'escalated') {
            const line = str(e.data.text);
            setWorking(line);
            if (!progressSaid && line) {
              setAnnounce(line);
              progressSaid = true;
            }
          } else if (e.event === 'error') {
            failed = str(e.data.message) || notSaved;
            ended = true;
          } else if (OUTCOMES.has(e.event)) {
            const blocks = Array.isArray(e.data.blocks)
              ? (e.data.blocks as { text?: unknown }[]).map((b) => str(b.text))
              : [];
            setAnnounce([str(e.data.say), ...blocks].filter(Boolean).join(' '));
            ended = true;
          }
        }
      }
    } catch {
      // The connection went; the turn did not (it completes on the server).
    }
    setFocus(false);
    if (failed !== null) {
      setError(failed);
      if (!stored) setText(words); // nothing was kept: the words go back in the box
    } else if (!ended) setDropped(true);
    startTransition(() => {
      router.refresh();
      setPending(null);
      setWorking(null);
      setBusy(false);
    });
    box.current?.focus();
  }

  const count = text.length >= COUNT_FROM ? `${text.length.toLocaleString('en-NZ')} of 2,000` : '';

  return (
    <div data-testid="kev-composer">
      {pending ? (
        <div className="mt-6" data-testid="kev-pending">
          <p className="text-ink ml-auto max-w-[85%] text-right break-words whitespace-pre-wrap">
            <span className="sr-only">You: </span>
            {pending}
          </p>
          {working ? (
            <p
              role="status"
              aria-live="off"
              data-testid="kev-working"
              className="text-muted mt-3 text-[15px]"
            >
              {working}
            </p>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite" className="sr-only" data-testid="kev-announce">
        {announce}
      </div>
      {error ? (
        <p role="alert" data-testid="kev-error" className="text-ink mt-4 flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="bg-muted-mark inline-block h-2 w-2 shrink-0 rounded-full"
          />
          {error}
        </p>
      ) : null}
      {dropped ? (
        <p role="alert" className="text-ink mt-4">
          {STREAM_DROPPED}{' '}
          <a
            href="/kev#latest"
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {RELOAD}
          </a>
        </p>
      ) : null}

      {suggestions.length > 0 && !asked ? (
        <section aria-labelledby="kev-suggestions" className="mt-6">
          <h2
            id="kev-suggestions"
            className="text-muted mb-1 font-mono text-[11.5px] font-normal tracking-[0.14em] uppercase"
          >
            {SUGGESTIONS_LABEL}
          </h2>
          <ul className="border-line border-b">
            {suggestions.map((s) => (
              <li key={s} className="border-line border-t">
                <form
                  method="post"
                  action="/kev/turn"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(s);
                  }}
                >
                  <input type="hidden" name="text" value={s} />
                  {focus ? <input type="hidden" name="focus" value="today" /> : null}
                  <button
                    type="submit"
                    disabled={busy}
                    className="text-ink-2 hover:text-ink flex min-h-11 w-full items-center py-2 text-left disabled:opacity-60"
                  >
                    {s}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        method="post"
        action="/kev/turn"
        className="mt-6"
        aria-label={COMPOSER_LABEL}
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        {focus ? (
          <p className="text-muted mb-1 text-[15px]" data-testid="kev-focus">
            {FOCUS_TODAY}
            <input type="hidden" name="focus" value="today" />
          </p>
        ) : null}
        <label htmlFor="kev-text" className="sr-only">
          {COMPOSER_LABEL}
        </label>
        <div className="flex items-end gap-3">
          <textarea
            id="kev-text"
            ref={box}
            name="text"
            required
            rows={2}
            maxLength={MAX_CHARS}
            autoComplete="off"
            placeholder={COMPOSER_PLACEHOLDER}
            value={text}
            readOnly={busy}
            aria-describedby={count ? 'kev-count' : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            className="bg-paper-2 border-line text-ink rounded-home-sm placeholder:text-muted max-h-48 min-h-11 w-full min-w-0 flex-1 resize-y border px-4 py-2.5 text-[17px] break-words"
          />
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy || undefined}
            className="bg-ink text-paper min-h-11 shrink-0 rounded-[22px] px-5 py-2 font-medium disabled:opacity-60"
          >
            {busy ? SENDING : SEND}
          </button>
        </div>
        {count ? (
          <p id="kev-count" className="text-muted mt-1 text-[13px]">
            {count}
          </p>
        ) : null}
      </form>
    </div>
  );
}
