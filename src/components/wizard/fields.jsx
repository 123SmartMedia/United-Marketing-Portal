'use client';

/**
 * Accessible, mobile-first field primitives for the request wizard.
 * Each wires label association + aria-invalid + aria-describedby for errors,
 * and takes a react-hook-form `registration` (the result of register(name)).
 * Inputs are full-width with large touch targets (h-12) for mobile.
 */

const inputBase =
  'w-full rounded-xl border bg-white px-4 text-[15px] text-navy-900 outline-none transition ' +
  'placeholder:text-navy-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 ' +
  'disabled:bg-navy-50 disabled:text-navy-400';

function borderClass(hasError) {
  return hasError ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-navy-200';
}

export function FieldShell({ id, label, required, error, hint, children }) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-navy-800">
        {label} {required && <span className="text-brand-500">*</span>}
      </label>
      {hint && (
        <p id={hintId} className="mb-1.5 text-xs text-navy-400">
          {hint}
        </p>
      )}
      {children({ errorId, hintId })}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ id, label, required, error, hint, type = 'text', placeholder, registration, ...rest }) {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      {({ errorId, hintId }) => (
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          className={`${inputBase} ${borderClass(!!error)} h-12`}
          aria-invalid={!!error}
          aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
          {...registration}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({ id, label, required, error, hint, options, placeholder = 'Select…', registration }) {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      {({ errorId, hintId }) => (
        <div className="relative">
          <select
            id={id}
            className={`${inputBase} ${borderClass(!!error)} h-12 appearance-none pr-10`}
            aria-invalid={!!error}
            aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
            defaultValue=""
            {...registration}
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400"
            width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"
          >
            <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </FieldShell>
  );
}

export function TextareaField({ id, label, required, error, hint, placeholder, rows = 4, registration }) {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      {({ errorId, hintId }) => (
        <textarea
          id={id}
          rows={rows}
          placeholder={placeholder}
          className={`${inputBase} ${borderClass(!!error)} py-3`}
          aria-invalid={!!error}
          aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
          {...registration}
        />
      )}
    </FieldShell>
  );
}

export function CheckboxField({ id, label, error, registration }) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-navy-300 text-brand-500 focus:ring-2 focus:ring-brand-200"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          {...registration}
        />
        <span className="text-sm text-navy-700">{label}</span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
