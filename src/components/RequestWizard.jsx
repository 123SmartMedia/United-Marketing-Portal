'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { requestSchema, PRINT_TYPES, COBRAND_TYPES, hasStep2 } from '@/lib/requestSchema';
import TurnstileWidget from '@/components/wizard/TurnstileWidget';
import { BasicsStep, DetailsStep, CreativeStep } from '@/components/wizard/WizardSteps';
import WizardProgress from '@/components/wizard/WizardProgress';
import ErrorSummary from '@/components/wizard/ErrorSummary';
import SuccessPanel from '@/components/wizard/SuccessPanel';
import { DraftNotice, WizardNav } from '@/components/wizard/WizardNav';
import { useWizardDraft } from '@/components/wizard/useWizardDraft';
import { writeContact } from '@/components/wizard/wizardStorage';
import { isRushDate, localTodayIso } from '@/components/wizard/businessDays';

const DEFAULT_VALUES = {
  name: '', email: '', phone: '', nmls: '', branch: '',
  requestType: '', dateNeeded: '', rush: false,
  printingNeeded: '', quantity: '', size: '', finish: '',
  cobrand: '', partnerName: '', complianceApproved: false,
  projectTitle: '', keyMessage: '', additionalDetails: '', files: [], company: '',
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
  const [submitError, setSubmitError] = useState(null); // { message, correlationId, fields }
  const [result, setResult] = useState(null); // { requestKey, requestUrl, portalUrl, attachments }
  // Single-use Turnstile token. Cleared and re-minted after every attempt.
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [challengeReset, setChallengeReset] = useState(0);
  // Fields that failed "Continue" validation, listed in the error summary.
  const [stepErrors, setStepErrors] = useState([]);
  const [announceStep, setAnnounceStep] = useState(false);
  const minDate = useMemo(() => localTodayIso(), []);

  const submissionIdRef = useRef(null);
  const inFlightRef = useRef(false);
  const errorSummaryRef = useRef(null);
  const successRef = useRef(null);
  const headingRef = useRef(null);
  const pendingFocusRef = useRef(null); // field to focus after a step change
  const focusHeadingRef = useRef(false); // focus the heading after "Submit another"
  const firstRenderRef = useRef(true);
  const autoRushDateRef = useRef('');

  const defaultValues = useMemo(() => ({ ...DEFAULT_VALUES, requestType: defaultType || '' }), [defaultType]);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    reset,
    setValue,
    setError,
    setFocus,
    getFieldState,
    formState: { errors },
  } = useForm({ resolver: zodResolver(requestSchema), mode: 'onTouched', defaultValues });

  const draft = useWizardDraft({ watch, reset, defaultValues });

  const requestType = watch('requestType');
  const printingNeeded = watch('printingNeeded');
  const cobrand = watch('cobrand');
  const files = watch('files');
  const dateNeeded = watch('dateNeeded');
  const rushSuggested = isRushDate(dateNeeded, minDate);

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

  // Auto-check Rush once per newly chosen short-notice date. The user can turn
  // it off again; we only re-check it if they pick a different date.
  useEffect(() => {
    if (rushSuggested && dateNeeded !== autoRushDateRef.current) {
      autoRushDateRef.current = dateNeeded;
      setValue('rush', true);
    }
  }, [rushSuggested, dateNeeded, setValue]);

  // Move focus to the summary when a submission fails, and to the confirmation
  // when it succeeds, so screen-reader and keyboard users land on the outcome.
  useEffect(() => {
    if (status === 'error') errorSummaryRef.current?.focus();
    if (status === 'success') successRef.current?.focus();
    if (status === 'idle' && focusHeadingRef.current) {
      focusHeadingRef.current = false;
      headingRef.current?.focus();
    }
  }, [status]);

  // On a step change, focus the field the user jumped to from the error
  // summary, or else the new step's heading (and announce it). Skipped on the
  // first render so the page doesn't steal focus on load.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (target) {
      focusField(target);
    } else {
      headingRef.current?.focus();
      setAnnounceStep(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedIndex]);

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

  function stepIndexForField(name) {
    const found = steps.findIndex((s) => fieldsForStep(s.key).includes(name));
    return found >= 0 ? found : steps.length - 1; // files, additionalDetails → last step
  }

  function focusField(name) {
    try {
      setFocus(name);
    } catch {
      // Not a registered input (e.g. files) — fall back to the DOM id.
    }
    if (document.activeElement?.id !== name) document.getElementById(name)?.focus();
  }

  /** Error-summary link: go to the step that owns `name`, then focus it. */
  function goToField(name) {
    const target = stepIndexForField(name);
    if (target === clampedIndex) {
      focusField(name);
      return;
    }
    pendingFocusRef.current = name;
    setStepIndex(target);
  }

  async function next() {
    const names = fieldsForStep(step.key);
    const valid = await trigger(names);
    if (valid) {
      setStepErrors([]);
      setStepIndex(clampedIndex + 1);
      return;
    }
    const failed = names
      .map((name) => ({ name, state: getFieldState(name) }))
      .filter(({ state }) => state.invalid)
      .map(({ name, state }) => ({ name, message: state.error?.message }));
    setStepErrors(failed);
    // Focus the summary so the user hears every problem, not just the first.
    requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function back() {
    setStepErrors([]);
    setStepIndex(Math.max(0, clampedIndex - 1));
  }

  function succeed(values, payload) {
    writeContact(values);
    draft.finish();
    setResult(payload);
    setStepErrors([]);
    setStatus('success');
  }

  function submitAnother() {
    reset(draft.freshValues());
    draft.resume();
    submissionIdRef.current = null;
    autoRushDateRef.current = '';
    setResult(null);
    setSubmitError(null);
    setTurnstileToken('');
    setTurnstileError('');
    setChallengeReset((n) => n + 1);
    setAnnounceStep(false);
    firstRenderRef.current = true;
    focusHeadingRef.current = true;
    setStepIndex(0);
    setStatus('idle');
  }

  async function onSubmit(values) {
    // Guard against a second submit slipping through before React re-renders.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (!submissionIdRef.current) submissionIdRef.current = newSubmissionId();

    setStatus('submitting');
    setSubmitError(null);
    setStepErrors([]);
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
        succeed(values, { requestKey: null, portalUrl });
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
          succeed(values, finalizeJson);
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

      // Server-side validation: mark the offending fields inline and list them
      // in the summary, each linking to its field on whichever step owns it.
      const serverFields = Array.isArray(json.fields) ? json.fields.filter((f) => typeof f === 'string') : [];
      for (const field of serverFields) {
        setError(field, { type: 'server', message: 'Please check this field.' });
      }

      setStatus('error');
      setSubmitError({
        message:
          json.message ||
          'We couldn’t submit your request right now. Your details are still here — please try again.',
        correlationId: json.correlationId || null,
        fields: serverFields.map((name) => ({ name })),
      });
    } catch {
      setTurnstileToken('');
      setChallengeReset((n) => n + 1);
      setStatus('error');
      setSubmitError({
        message:
          'We couldn’t reach the marketing desk. Your details are still here — check your connection and try again.',
        correlationId: null,
        fields: [],
      });
    } finally {
      inFlightRef.current = false;
    }
  }

  if (status === 'success') {
    return <SuccessPanel ref={successRef} result={result} portalUrl={portalUrl} onSubmitAnother={submitAnother} />;
  }

  const submitting = status === 'submitting';

  // Submit waits for a token, ALWAYS — including when no site key is configured.
  //
  // This used to read `Boolean(turnstileSiteKey) && !turnstileToken`, which meant
  // a missing TURNSTILE_SITE_KEY disabled the gate instead of the
  // form: the widget rendered nothing, Submit was enabled, and the server
  // rejected the finished submission with "Please complete the Verify you're
  // human challenge". A misconfiguration must block early and visibly, not after
  // the user has filled in three steps.
  //
  // This is a convenience gate only. The server redeems the token against
  // Cloudflare regardless of what the browser did, so bypassing it achieves
  // nothing — see /api/jira/requests/init.
  const challengeUnavailable = !turnstileSiteKey;
  const challengePending = !turnstileToken;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {/* Honeypot */}
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" {...register('company')} />

      {draft.restored && (
        <DraftNotice
          onKeep={draft.dismissRestored}
          onStartOver={() => {
            draft.startOver();
            setStepErrors([]);
            setStepIndex(0);
          }}
        />
      )}

      <WizardProgress ref={headingRef} steps={steps} index={clampedIndex} announce={announceStep} />

      {stepErrors.length > 0 && (
        <div className="mb-6">
          <ErrorSummary
            ref={errorSummaryRef}
            title="Please fix the following before continuing:"
            fields={stepErrors}
            onFieldClick={goToField}
          />
        </div>
      )}

      {/* Steps */}
      <fieldset disabled={submitting} className="contents">
        <div key={step.key} className="animate-[fadeIn_.25s_ease] space-y-4">
          {step.key === 'basics' && (
            <BasicsStep register={register} errors={errors} minDate={minDate} rushSuggested={rushSuggested} />
          )}
          {step.key === 'details' && (
            <DetailsStep
              register={register}
              errors={errors}
              showPrint={showPrint}
              showCobrand={showCobrand}
              printingNeeded={printingNeeded}
              cobrand={cobrand}
            />
          )}
          {step.key === 'creative' && (
            <CreativeStep
              register={register}
              errors={errors}
              files={files}
              onFilesChange={(f) => setValue('files', f, { shouldValidate: false })}
            />
          )}
        </div>
      </fieldset>

      {/* Verification — last step only, directly above Submit so the user sees the
          challenge and the button it controls together. */}
      {isLast && (
        <section aria-labelledby="verification-heading" className="mt-8 rounded-2xl border border-navy-100 bg-navy-50/40 p-5">
          <h2 id="verification-heading" className="mb-3 text-sm font-semibold text-navy-900">
            Verification
          </h2>
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            action={turnstileAction}
            resetSignal={challengeReset}
            error={turnstileError}
            onToken={setTurnstileToken}
            onExpire={() => setTurnstileToken('')}
            onUnavailable={() => setTurnstileToken('')}
          />
        </section>
      )}

      <WizardNav
        showBack={clampedIndex > 0}
        isLast={isLast}
        submitting={submitting}
        challengePending={challengePending}
        challengeUnavailable={challengeUnavailable}
        onBack={back}
        onNext={next}
      />

      {status === 'error' && submitError && (
        <ErrorSummary
          ref={errorSummaryRef}
          title="Your request wasn’t submitted."
          message={submitError.message}
          fields={submitError.fields}
          correlationId={submitError.correlationId}
          onFieldClick={goToField}
        />
      )}

      <p className="mt-4 text-center text-xs text-navy-500">Goes straight to the United Mortgage marketing desk</p>
    </form>
  );
}
