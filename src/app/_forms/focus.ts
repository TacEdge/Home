'use client';

import { useEffect, useRef } from 'react';
import type { FormState } from './state';

/**
 * After a refused submission, puts keyboard focus where the person needs to
 * act (M3 contract §4.5, ADR 0006 §34): the first field marked invalid, or,
 * when the refusal names no field, the form's own message. Attach the
 * returned ref to the element that holds both (the form, or a wrapper).
 * Every M3 form that shows FormState uses this, so focus never drops to the
 * top of the page after the form is re-rendered with what was typed.
 */
export function useRefusalFocus<T extends HTMLElement>(state: FormState) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (state.status !== 'error') return;
    const root = ref.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      root.querySelector<HTMLElement>('[data-form-message]');
    target?.focus();
  }, [state]);
  return ref;
}
