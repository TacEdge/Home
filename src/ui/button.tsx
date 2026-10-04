'use client';

import { useFormStatus } from 'react-dom';

// Buttons (M3 contract §4.2). Primary is Pine on Morning: the one main action
// on a screen. Quiet is text: everything else. Neither uses the Sun. Inside a
// form a submit button reports the pending submission and cannot be pressed
// twice; the form still works without JavaScript.

const styles = {
  primary: 'bg-ink text-paper min-h-11 rounded-[22px] px-5 py-2 font-medium disabled:opacity-60',
  quiet: 'text-ink-2 min-h-11 px-1 py-2 underline-offset-4 hover:underline disabled:opacity-60',
} as const;

export function Button({
  children,
  variant = 'primary',
  type = 'submit',
  name,
  value,
  formAction,
  onClick,
}: {
  children: React.ReactNode;
  variant?: keyof typeof styles;
  type?: 'submit' | 'button';
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  onClick?: () => void;
}) {
  const { pending } = useFormStatus();
  const busy = type === 'submit' && pending;
  return (
    <button
      type={type}
      name={name}
      value={value}
      formAction={formAction}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className={styles[variant]}
    >
      {children}
    </button>
  );
}
