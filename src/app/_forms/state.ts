// The form state shape, shared by server actions and client forms. Kept
// apart from action.ts, which is server-only.

export type FormState =
  | { status: 'idle' }
  | { status: 'ok'; message?: string }
  | { status: 'error'; message: string; fields: Record<string, string> };

export const idle: FormState = { status: 'idle' };
