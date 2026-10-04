// A labelled form field (M3 contract §4.2, §4.5). Native controls only, so
// forms work without JavaScript; the label, hint and error are tied to the
// control for assistive technology. An error is marked with the Sun ("needs
// you"), never red.

type Option = { value: string; label: string };

type Common = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  defaultValue?: string;
};

type FieldProps = Common &
  (
    | {
        type?: 'text' | 'email' | 'date' | 'time' | 'number' | 'search';
        autoComplete?: string;
        inputMode?: 'text' | 'email' | 'numeric' | 'decimal' | 'search';
        min?: string;
        max?: string;
      }
    | { type: 'textarea'; rows?: number }
    | { type: 'select'; options: Option[] }
  );

const control =
  'bg-paper-2 border-line text-ink rounded-home-sm min-h-11 w-full border px-4 py-2.5 text-[17px]';

export function Field(props: FieldProps) {
  const id = `field-${props.name}`;
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const described = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const shared = {
    id,
    name: props.name,
    required: props.required,
    defaultValue: props.defaultValue,
    'aria-describedby': described,
    'aria-invalid': props.error ? true : undefined,
    className: control,
  };

  return (
    <div className="mt-5">
      <label htmlFor={id} className="text-ink-2 mb-1.5 block text-[15px] font-medium">
        {props.label}
        {props.required ? null : <span className="text-muted font-normal"> (optional)</span>}
      </label>
      {props.type === 'textarea' ? (
        <textarea {...shared} rows={props.rows ?? 3} />
      ) : props.type === 'select' ? (
        <select {...shared}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          type={props.type ?? 'text'}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          min={props.min}
          max={props.max}
        />
      )}
      {props.hint ? (
        <p id={hintId} className="text-muted mt-1.5 text-[14px]">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="text-ink mt-1.5 flex items-baseline gap-2 text-[15px]">
          <span
            aria-hidden="true"
            className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full"
          />
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/** Less-used fields, folded away until asked for (M3 contract §3.5). */
export function More({ children, label = 'More' }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group mt-6">
      <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center gap-2 underline-offset-4 hover:underline">
        {label}
      </summary>
      <div>{children}</div>
    </details>
  );
}
