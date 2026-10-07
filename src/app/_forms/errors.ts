/**
 * A refusal a form reader makes before the domain sees the input, naming
 * the fields (for example, a recurrence the model cannot express). Pure;
 * formAction turns it into field errors like a Zod refusal.
 */
export class FormFieldError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super('form fields refused');
    this.name = 'FormFieldError';
  }
}

/**
 * A refusal an action states in its own words, with somewhere to go: calm
 * copy and a HOME path, never input or an error's text. formAction shows it
 * as the form's message with the link under it.
 */
export class FormRefusal extends Error {
  constructor(
    readonly copy: string,
    readonly link?: { href: string; label: string },
  ) {
    super('form refused');
    this.name = 'FormRefusal';
  }
}
