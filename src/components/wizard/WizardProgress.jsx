'use client';

import { forwardRef } from 'react';

/**
 * Step heading + progress bar. The heading receives focus on every step change
 * (so keyboard and screen-reader users start at the top of the new step), and a
 * live region announces "Step N of M: Title".
 */
const WizardProgress = forwardRef(function WizardProgress({ steps, index, announce }, headingRef) {
  const step = steps[index];
  const label = `Step ${index + 1} of ${steps.length}: ${step.title}`;
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-sm">
        <h2 ref={headingRef} tabIndex={-1} className="font-semibold text-navy-900 outline-none">
          Step {index + 1} of {steps.length}
          <span className="sr-only">: {step.title}</span>
        </h2>
        <span className="text-navy-500" aria-hidden="true">
          {step.title}
        </span>
      </div>
      <div
        className="mt-2 flex gap-1.5"
        role="progressbar"
        aria-label="Request progress"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={index + 1}
        aria-valuetext={label}
      >
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i <= index ? 'bg-brand-500' : 'bg-navy-100'}`}
          />
        ))}
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="step-announcer">
        {announce ? label : ''}
      </div>
    </div>
  );
});

export default WizardProgress;
