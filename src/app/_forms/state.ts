// The form state shape, shared by server actions and client forms. Kept
// apart from action.ts, which is server-only.

export type FormState =
  | { status: 'idle' }
  | { status: 'ok'; message?: string }
  | {
      status: 'error';
      message: string;
      fields: Record<string, string>;
      /**
       * What the person submitted, handed back to the same form so a refused
       * save never loses their words (fields re-render with these). Only ever
       * returned to the browser that sent them; never logged or audited.
       */
      values?: Record<string, string>;
    };

export const idle: FormState = { status: 'idle' };

/** The value to show in a field: what was just submitted, else the stored one. */
export function shown(
  state: FormState,
  name: string,
  stored: string | null | undefined,
): string | undefined {
  if (state.status === 'error' && state.values) return state.values[name] ?? '';
  return stored ?? undefined;
}

/** Whether a checkbox shows ticked: as just submitted, else as stored. */
export function shownChecked(state: FormState, name: string, stored: boolean): boolean {
  if (state.status === 'error' && state.values) return state.values[name] === 'on';
  return stored;
}

const keys = new WeakMap<object, number>();
let next = 0;

/**
 * A key that changes with every refused submission. A form keyed by it is
 * remounted with the submitted values as its defaults: React's own reset
 * after an action restores a <select> to its first-rendered value, so a
 * remount is the only way every control shows what was typed.
 */
export function formKey(state: FormState): string {
  if (state.status !== 'error') return 'form';
  let k = keys.get(state);
  if (k === undefined) keys.set(state, (k = ++next));
  return `refused-${k}`;
}
