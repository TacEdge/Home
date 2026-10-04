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
