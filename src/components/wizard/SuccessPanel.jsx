'use client';

import { forwardRef, useState } from 'react';

/**
 * Confirmation shown after a request is accepted: ticket number with a copy
 * button, attachment outcome, portal links, and a way to start another request.
 */
const SuccessPanel = forwardRef(function SuccessPanel({ result, portalUrl, onSubmitAnother }, ref) {
  const [copyState, setCopyState] = useState(''); // '' | copied | failed
  const portal = result?.portalUrl || portalUrl;
  const att = result?.attachments;
  // Only claim files landed when Jira actually accepted them all.
  const allAttached = !att?.total || att.attached === att.total;

  async function copyTicket() {
    try {
      await navigator.clipboard.writeText(result.requestKey);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center outline-none"
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-xl text-white" aria-hidden="true">
        ✓
      </div>
      <h3 className="text-lg font-semibold text-navy-900">Request received</h3>

      {result?.requestKey && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-navy-600">
          <span>
            Your ticket number is{' '}
            <span className="rounded-md bg-white px-2 py-1 font-mono text-sm font-semibold text-navy-900">
              {result.requestKey}
            </span>
          </span>
          <button
            type="button"
            onClick={copyTicket}
            className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-navy-800 transition hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {copyState === 'copied' ? 'Copied ✓' : 'Copy ticket number'}
          </button>
          <span aria-live="polite" className="w-full text-xs text-navy-600">
            {copyState === 'copied' && <span className="sr-only">Ticket number copied.</span>}
            {copyState === 'failed' && 'Couldn’t copy automatically — select the number and press Ctrl+C.'}
          </span>
        </div>
      )}

      <p className="mx-auto mt-3 max-w-md text-sm text-navy-600">
        Thanks — the marketing desk has your request
        {att?.total > 0 && allAttached ? ` and ${att.total} file${att.total > 1 ? 's' : ''}` : ''} and will
        follow up by email at the address you provided.
      </p>

      {att?.total > 0 && !allAttached && (
        <p className="mx-auto mt-3 max-w-md rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="font-semibold">
            {att.attached} of {att.total} file{att.total > 1 ? 's' : ''} attached.
          </span>{' '}
          The rest couldn’t be added to the ticket. Please reply to your confirmation email with the
          remaining file{att.failed > 1 ? 's' : ''} so the marketing desk can attach {att.failed > 1 ? 'them' : 'it'}.
        </p>
      )}

      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {result?.requestUrl && (
          <a
            href={result.requestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            View request<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {portal && (
          <a
            href={portal}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-brand-600 underline-offset-2 transition hover:text-brand-700 hover:underline"
          >
            Open Marketing Requests Portal<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <button
          type="button"
          onClick={onSubmitAnother}
          data-testid="submit-another"
          className="rounded-full border border-navy-300 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Submit another request
        </button>
      </div>
    </div>
  );
});

export default SuccessPanel;
