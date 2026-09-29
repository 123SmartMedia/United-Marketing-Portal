'use client';

/** "We restored your draft" banner with Keep / Start over. */
export function DraftNotice({ onKeep, onStartOver }) {
  return (
    <div
      role="status"
      data-testid="draft-restored"
      className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-navy-800"
    >
      <span>We restored your draft from earlier.</span>
      <span className="flex gap-3">
        <button type="button" onClick={onKeep} className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          Keep it
        </button>
        <button type="button" onClick={onStartOver} className="font-semibold text-navy-700 underline-offset-2 hover:underline">
          Start over
        </button>
      </span>
    </div>
  );
}

/**
 * Back / Continue / Submit row, plus the note explaining why Submit is disabled.
 * Submit waits for a Turnstile token ALWAYS — including when no site key is
 * configured — so a misconfiguration blocks early and visibly (see the comment
 * in RequestWizard). This is a convenience gate; the server redeems the token.
 */
export function WizardNav({ showBack, isLast, submitting, challengePending, challengeUnavailable, onBack, onNext }) {
  const blocked = challengePending || challengeUnavailable;
  return (
    <>
      <div className="mt-8 flex items-center justify-between gap-3">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-navy-600 transition hover:text-navy-900 disabled:opacity-60"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}

        {isLast ? (
          <button
            type="submit"
            data-testid="submit-request"
            disabled={submitting || blocked}
            aria-busy={submitting}
            aria-describedby={blocked ? 'challenge-pending' : undefined}
            className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {submitting ? 'Sending…' : 'Submit request'}
          </button>
        ) : (
          <button type="button" onClick={onNext} className="rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
            Continue →
          </button>
        )}
      </div>

      {/* Status region: announced to assistive tech whether or not it has content. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {submitting ? 'Submitting your request…' : ''}
      </div>

      {isLast && blocked && (
        <p id="challenge-pending" className={`mt-3 text-center text-xs ${challengeUnavailable ? 'text-red-600' : 'text-navy-500'}`}>
          {challengeUnavailable
            ? 'Submission is unavailable until verification is restored.'
            : 'Complete the verification above to enable Submit.'}
        </p>
      )}
    </>
  );
}
