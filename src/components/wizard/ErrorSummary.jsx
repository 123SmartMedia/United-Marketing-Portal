'use client';

import { forwardRef } from 'react';
import { FIELD_LABELS } from '@/components/wizard/WizardSteps';

/**
 * Error summary (GOV.UK pattern): a focusable alert that lists every problem
 * field as a link which jumps to — and focuses — that field, even when it
 * lives on another step. Used for both step validation and server rejections.
 */
const ErrorSummary = forwardRef(function ErrorSummary(
  { title, message, fields = [], correlationId, onFieldClick },
  ref
) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-testid="error-summary"
      className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 outline-none"
    >
      <p className="font-semibold">{title}</p>
      {message && <p className="mt-1">{message}</p>}
      {fields.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {fields.map(({ name, message: fieldMessage }) => (
            <li key={name}>
              <a
                href={`#${name}`}
                onClick={(e) => {
                  e.preventDefault();
                  onFieldClick(name);
                }}
                className="font-medium underline underline-offset-2 hover:text-red-800"
              >
                {FIELD_LABELS[name] || name}
                {fieldMessage ? `: ${fieldMessage}` : ''}
              </a>
            </li>
          ))}
        </ul>
      )}
      {correlationId && (
        <p className="mt-2 text-xs text-red-600">
          Reference ID: <span className="font-mono">{correlationId}</span> — include this if you contact the
          marketing desk.
        </p>
      )}
    </div>
  );
});

export default ErrorSummary;
