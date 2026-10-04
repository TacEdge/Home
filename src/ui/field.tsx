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
  /** For a form that shows or hides other questions as this one changes. */
  onChange?: (value: string) => void;
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
    onChange: props.onChange
      ? (e: { target: { value: string } }) => props.onChange?.(e.target.value)
      : undefined,
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
export function More({
  children,
  label = 'More',
  open,
}: {
  children: React.ReactNode;
  label?: string;
  /** Start unfolded, e.g. when a field inside needs another look. */
  open?: boolean;
}) {
  return (
    <details className="group mt-6" open={open || undefined}>
      <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center gap-2 underline-offset-4 hover:underline">
        {label}
      </summary>
      <div>{children}</div>
    </details>
  );
}

/** A single checkbox with its label beside it; unticked unless said otherwise. */
export function Checkbox({
  name,
  label,
  hint,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="mt-5">
      <div className="flex min-h-11 items-center gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
          aria-describedby={hintId}
          className="accent-ink h-5 w-5 shrink-0"
        />
        <label htmlFor={id} className="text-ink">
          {label}
        </label>
      </div>
      {hint ? (
        <p id={hintId} className="text-muted mt-1 pl-8 text-[14px]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A set of choices as inline checkboxes under one question (weekdays, who's
 * going). Each box has its own name (`<name>_<value>`), so a submitted form
 * carries each choice separately and a refused save shows them again.
 */
export function Choices({
  name,
  legend,
  options,
  checked,
  hint,
  error,
}: {
  name: string;
  legend: string;
  options: readonly { value: string; label: React.ReactNode }[];
  checked: ReadonlySet<string>;
  hint?: string;
  error?: string;
}) {
  const hintId = hint ? `choices-${name}-hint` : undefined;
  const errorId = error ? `choices-${name}-error` : undefined;
  return (
    <fieldset
      className="mt-5"
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
    >
      <legend className="text-ink-2 mb-1.5 text-[15px] font-medium">{legend}</legend>
      <input type="hidden" name={`${name}_present`} value="1" />
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {options.map((o) => {
          const id = `choice-${name}-${o.value}`;
          return (
            <span key={o.value} className="inline-flex min-h-11 items-center gap-2">
              <input
                id={id}
                type="checkbox"
                name={`${name}_${o.value}`}
                defaultChecked={checked.has(o.value)}
                className="accent-ink h-5 w-5 shrink-0"
              />
              <label htmlFor={id} className="text-ink">
                {o.label}
              </label>
            </span>
          );
        })}
      </div>
      {hint ? (
        <p id={hintId} className="text-muted mt-1 text-[14px]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-ink mt-1.5 flex items-baseline gap-2 text-[15px]">
          <span
            aria-hidden="true"
            className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full"
          />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
