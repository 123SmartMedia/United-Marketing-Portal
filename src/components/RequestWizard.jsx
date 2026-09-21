'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  requestSchema,
  REQUEST_TYPES,
  PRINT_TYPES,
  COBRAND_TYPES,
  YES_NO,
  QUANTITIES,
  SIZES,
  FINISHES,
  hasStep2,
} from '@/lib/requestSchema';
import { TextField, SelectField, TextareaField, CheckboxField } from '@/components/wizard/fields';
import FileDropzone from '@/components/wizard/FileDropzone';
import TurnstileWidget from '@/components/wizard/TurnstileWidget';

const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// One id per form instance. The server returns the original ticket for a repeat
// submission carrying the same id, so a double click can't open two tickets.
const newSubmissionId = () =>
  globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function RequestWizard({
  defaultType = '',
  portalUrl = '',
  turnstileSiteKey = '',
  turnstileAction = '',
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [submitError, setSubmitError] = useState(null); // { message, correlationId }
  const [result, setResult] = useState(null); // { requestKey, requestUrl, portalUrl, attachments }
  // Single-use Turnstile token. Cleared and re-minted after every attempt.
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [challengeReset, setChallengeReset] = useState(0);
  const minDate = useMemo(() => todayISO(), []);

  const submissionIdRef = useRef(null);
  const inFlightRef = useRef(false);
  const errorSummaryRef = useRef(null);
  const successRef = useRef(null);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    setValue,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(requestSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '', email: '', phone: '', nmls: '', branch: '',
      requestType: defaultType || '', dateNeeded: '', rush: false,
      printingNeeded: '', quantity: '', size: '', finish: '',
      cobrand: '', partnerName: '', complianceApproved: false,
      projectTitle: '', keyMessage: '', additionalDetails: '', files: [], company: '',
    },
  });

  const requestType = watch('requestType');
  const printingNeeded = watch('printingNeeded');
  const cobrand = watch('cobrand');
  const files = watch('files');

  const showPrint = PRINT_TYPES.has(requestType);
  const showCobrand = COBRAND_TYPES.has(requestType);

  // Dynamic steps: the middle "details" step only exists when the request type needs it.
  const steps = useMemo(() => {
    const s = [{ key: 'basics', title: 'The basics' }];
    if (hasStep2(requestType)) s.push({ key: 'details', title: 'Details' });
    s.push({ key: 'creative', title: 'Creative & files' });
    return s;
  }, [requestType]);

  const clampedIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[clampedIndex];
  const isLast = clampedIndex === steps.length - 1;

  // Move focus to the summary when a submission fails, and to the confirmation
  // when it succeeds, so screen-reader and keyboard users land on the outcome.
  useEffect(() => {
    if (status === 'error') errorSummaryRef.current?.focus();
    if (status === 'success') successRef.current?.focus();
  }, [status]);

  function fieldsForStep(key) {
    if (key === 'basics') return ['name', 'email', 'phone', 'nmls', 'branch', 'requestType', 'dateNeeded'];
    if (key === 'details') {
      const f = [];
      if (showPrint) {
        f.push('printingNeeded');
        if (printingNeeded === 'Yes') f.push('quantity', 'size', 'finish');
      }
      if (showCobrand) {
        f.push('cobrand');
        if (cobrand === 'Yes') f.push('partnerName', 'complianceApproved');
      }
      return f;
    }
    return ['projectTitle', 'keyMessage'];
  }

  async function next() {
    const valid = await trigger(fieldsForStep(step.key), { shouldFocus: true });
    if (valid) setStepIndex(clampedIndex + 1);
  }

  function back() {
    setStepIndex(Math.max(0, clampedIndex - 1));
  }

  async function onSubmit(values) {
    // Guard against a second submit slipping through before React re-renders.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (!submissionIdRef.current) submissionIdRef.current = newSubmissionId();

    setStatus('submitting');
    setSubmitError(null);
    setTurnstileError('');
    try {
      // File objects live only in the browser. The server is sent metadata, and
      // the bytes go straight to R2 in stage 2 — never through this JSON body.
      const selected = Array.isArray(values.files) ? values.files : [];
      const fileMeta = selected.map((f) => ({ name: f.name, size: f.size, type: f.type }));
      const basePayload = { ...values, files: fileMeta, source: 'wizard' };

      // Stage 1 — validate everything and redeem the Turnstile token. No upload
      // URL exists until this returns.
      const initRes = await fetch('/api/jira/requests/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          submissionId: submissionIdRef.current,
          turnstileToken,
        }),
      });
      let json = await initRes.json().catch(() => ({}));

      // The honeypot path answers ok with no token and mints nothing. A real
      // submission always carries one, so treat its absence as "done" rather
      // than calling finalize with nothing to present.
      if (initRes.ok && json.ok && !json.finalizeToken) {
        setResult({ requestKey: null, portalUrl });
        setStatus('success');
        return;
      }

      if (initRes.ok && json.ok) {
        // Stage 1b — upload the bytes to the presigned PUTs, in order. Each URL
        // is single-purpose and expires in five minutes.
        const uploads = Array.isArray(json.uploads) ? json.uploads : [];
        const uploadedFiles = [];
        for (const upload of uploads) {
          const file = selected[upload.index]?.file;
          if (!file) throw new Error('upload_missing_file');
          const putRes = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          });
          if (!putRes.ok) throw new Error('upload_failed');
          uploadedFiles.push({ ...fileMeta[upload.index], key: upload.key });
        }

        // Stage 2 — prove we hold the signed token, then create the ticket.
        // The payload must match stage 1 exactly or the bound hash rejects it.
        const finalizeRes = await fetch('/api/jira/requests/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...basePayload,
            files: uploadedFiles,
            finalizeToken: json.finalizeToken,
          }),
        });
        const finalizeJson = await finalizeRes.json().catch(() => ({}));

        if (finalizeRes.ok && finalizeJson.ok) {
          setResult(finalizeJson);
          setStatus('success');
          return;
        }
        json = finalizeJson;
      }

      // A Turnstile token is single use, so any outcome invalidates it. Mint a
      // fresh one before the user can try again.
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
      if (typeof json.error === 'string' && json.error.startsWith('turnstile_')) {
        setTurnstileError(json.message || 'Verification failed. Please try again.');
      }

      // Server-side validation: surface the offending fields inline and send the
      // user back to the step that owns the first one.
      if (Array.isArray(json.fields) && json.fields.length) {
        for (const field of json.fields) {
          setError(field, { type: 'server', message: 'Please check this field.' });
        }
        const firstStep = steps.findIndex((s) => fieldsForStep(s.key).includes(json.fields[0]));
        if (firstStep >= 0) setStepIndex(firstStep);
      }

      setStatus('error');
      setSubmitError({
        message:
          json.message ||
          'We couldn’t submit your request right now. Your details are still here — please try again.',
        correlationId: json.correlationId || null,
      });
    } catch {
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
      setStatus('error');
      setSubmitError({
        message:
          'We couldn’t reach the marketing desk. Your details are still here — check your connection and try again.',
        correlationId: null,
      });
    } finally {
      inFlightRef.current = false;
    }
  }

  if (status === 'success') {
    const portal = result?.portalUrl || portalUrl;
    const att = result?.attachments;
    // Only claim files landed when Jira actually accepted them all.
    const allAttached = !att?.total || att.attached === att.total;
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center outline-none"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-xl text-white">
          ✓
        </div>
        <h3 className="text-lg font-semibold text-navy-900">Request received</h3>

        {result?.requestKey && (
          <p className="mt-3 text-sm text-navy-600">
            Your ticket number is{' '}
            <span className="rounded-md bg-white px-2 py-1 font-mono text-sm font-semibold text-navy-900">
              {result.requestKey}
            </span>
          </p>
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
              View request
            </a>
          )}
          {portal && (
            <a
              href={portal}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-brand-600 underline-offset-2 transition hover:text-brand-700 hover:underline"
            >
              Open Marketing Requests Portal
            </a>
          )}
        </div>
      </div>
    );
  }

  const submitting = status === 'submitting';
  // When Turnstile is configured, the submit button waits for a token. This is a
  // convenience only — the server redeems the token regardless of what the
  // browser did, so bypassing this check achieves nothing.
  const challengePending = Boolean(turnstileSiteKey) && !turnstileToken;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {/* Honeypot */}
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" {...register('company')} />

      {/* Progress indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-navy-900">
            Step {clampedIndex + 1} of {steps.length}
          </span>
          <span className="text-navy-400">{step.title}</span>
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`h-1.5 flex-1 rounded-full transition-colors ${i <= clampedIndex ? 'bg-brand-500' : 'bg-navy-100'}`}
            />
          ))}
        </div>
      </div>

      {/* Steps */}
      <fieldset disabled={submitting} className="contents">
        <div key={step.key} className="animate-[fadeIn_.25s_ease] space-y-4">
          {step.key === 'basics' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="name" label="Full name" required registration={register('name')} error={errors.name?.message} placeholder="Jane Officer" autoComplete="name" />
                <TextField id="email" label="Work email" required type="email" registration={register('email')} error={errors.email?.message} placeholder="jofficer@unitedmortgage.com" autoComplete="email" />
                <TextField id="phone" label="Phone number" required type="tel" registration={register('phone')} error={errors.phone?.message} placeholder="631-203-7480" autoComplete="tel" />
                <TextField id="nmls" label="NMLS ID" required registration={register('nmls')} error={errors.nmls?.message} placeholder="1234567" inputMode="numeric" />
              </div>
              <TextField id="branch" label="Branch / office" required registration={register('branch')} error={errors.branch?.message} placeholder="e.g., Melville, NY" />
              <SelectField id="requestType" label="Request type" required options={REQUEST_TYPES} registration={register('requestType')} error={errors.requestType?.message} placeholder="What do you need?" />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="dateNeeded" label="Date needed by" required type="date" min={minDate} registration={register('dateNeeded')} error={errors.dateNeeded?.message} />
                <div className="flex items-end">
                  <label htmlFor="rush" className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-navy-200 px-4 py-3">
                    <span className="text-sm font-medium text-navy-700">Rush request<span className="block text-xs font-normal text-navy-400">Needed in under 7 business days</span></span>
                    <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                      <input id="rush" type="checkbox" className="peer sr-only" {...register('rush')} />
                      <span className="h-6 w-11 rounded-full bg-navy-200 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-200" />
                      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {step.key === 'details' && (
            <>
              {showPrint && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-400">Printing</h3>
                  <SelectField id="printingNeeded" label="Printing needed?" required options={YES_NO} registration={register('printingNeeded')} error={errors.printingNeeded?.message} />
                  {printingNeeded === 'Yes' && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <SelectField id="quantity" label="Estimated quantity" required options={QUANTITIES} registration={register('quantity')} error={errors.quantity?.message} />
                      <SelectField id="size" label="Size / format" required options={SIZES} registration={register('size')} error={errors.size?.message} />
                      <SelectField id="finish" label="Finish / paper" required options={FINISHES} registration={register('finish')} error={errors.finish?.message} />
                    </div>
                  )}
                </div>
              )}
              {showCobrand && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-400">Co-branding</h3>
                  <SelectField id="cobrand" label="Co-branding with a partner?" required options={YES_NO} registration={register('cobrand')} error={errors.cobrand?.message} />
                  {cobrand === 'Yes' && (
                    <>
                      <TextField id="partnerName" label="Partner company name" required registration={register('partnerName')} error={errors.partnerName?.message} placeholder="e.g., Capoano Group Realty" />
                      <CheckboxField id="complianceApproved" label="I confirm this co-branded material complies with company and partner guidelines." registration={register('complianceApproved')} error={errors.complianceApproved?.message} />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {step.key === 'creative' && (
            <>
              <TextField id="projectTitle" label="Project title" required registration={register('projectTitle')} error={errors.projectTitle?.message} placeholder="e.g., Q3 Suffolk County Farming Campaign" />
              <TextareaField id="keyMessage" label="Key message / call to action" required registration={register('keyMessage')} error={errors.keyMessage?.message} placeholder="e.g., Call for a free home valuation, mention our 3.99% special…" />
              <TextareaField id="additionalDetails" label="Additional details" registration={register('additionalDetails')} placeholder="Any specific colors, layout preferences, or text to include?" rows={3} />
              <FileDropzone value={files} onChange={(f) => setValue('files', f, { shouldValidate: false })} />
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                action={turnstileAction}
                resetSignal={challengeReset}
                error={turnstileError}
                onToken={setTurnstileToken}
                onExpire={() => setTurnstileToken('')}
              />
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <span className="font-semibold">Do not include borrower information.</span> Marketing requests
                are not a secure channel — never attach or describe Social Security numbers, bank statements,
                tax returns, credit reports, loan files, or any other nonpublic borrower information.
              </p>
            </>
          )}
        </div>
      </fieldset>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between gap-3">
        {clampedIndex > 0 ? (
          <button
            type="button"
            onClick={back}
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
            disabled={submitting || challengePending}
            aria-busy={submitting}
            aria-describedby={challengePending ? 'challenge-pending' : undefined}
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
          <button type="button" onClick={next} className="rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
            Continue →
          </button>
        )}
      </div>

      {/* Status region: announced to assistive tech whether or not it has content. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {submitting ? 'Submitting your request…' : ''}
      </div>

      {challengePending && isLast && (
        <p id="challenge-pending" className="mt-3 text-center text-xs text-navy-400">
          Complete the verification above to enable Submit.
        </p>
      )}

      {status === 'error' && submitError && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 outline-none"
        >
          <p className="font-semibold">Your request wasn’t submitted.</p>
          <p className="mt-1">{submitError.message}</p>
          {submitError.correlationId && (
            <p className="mt-2 text-xs text-red-500">
              Reference ID: <span className="font-mono">{submitError.correlationId}</span> — include this if you
              contact the marketing desk.
            </p>
          )}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-navy-400">
        Goes straight to the United Mortgage marketing desk
      </p>
    </form>
  );
}
