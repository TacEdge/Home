// Reading FormData into the shape a domain Zod schema expects. Pure. The
// schema does the validating; this only turns the browser's strings into
// strings, nulls and booleans. An empty optional field clears (null); a
// field the form did not send is left out (undefined), so a patch changes
// only what was shown.

/** Trimmed text, or null when blank. Undefined when the field was not sent. */
export function textOf(form: FormData, name: string): string | null | undefined {
  if (!form.has(name)) return undefined;
  const v = form.get(name);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** Required text: an empty field stays an empty string so the schema says "This can't be empty." */
export function requiredTextOf(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

/** A checkbox, when the form carries its presence marker (`<name>_present`). */
export function checkboxOf(form: FormData, name: string): boolean | undefined {
  if (!form.has(`${name}_present`)) return undefined;
  return form.get(name) === 'on';
}

/** A select or radio value, or undefined when not sent. */
export function choiceOf(form: FormData, name: string): string | undefined {
  const v = form.get(name);
  return typeof v === 'string' ? v : undefined;
}

/** A hidden or path id. */
export function idOf(form: FormData, name = 'id'): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}
