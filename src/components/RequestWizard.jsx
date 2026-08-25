'use client';

import { useMemo, useState } from 'react';
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

const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export default function RequestWizard({ defaultType = '' }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [submitError, setSubmitError] = useState('');
  const minDate = useMemo(() => todayISO(), []);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    setValue,
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
    setStatus('submitting');
    setSubmitError('');
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, source: 'wizard' }),
      });
      const json = await res.json();
      if (res.ok && json.ok) setStatus('success');
      else {
        setStatus('error');
        setSubmitError('We couldn’t send your request. Please try again, or email marketing@unitedmortgage.com.');
      }
    } catch {
      setStatus('error');
      setSubmitError('Something went wrong. Please email marketing@unitedmortgage.com directly.');
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-xl text-white">✓</div>
        <h3 className="text-lg font-semibold text-navy-900">Request received</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-navy-600">
          Thanks — the marketing desk has your request{files?.length ? ` and ${files.length} file${files.length > 1 ? 's' : ''}` : ''} and
          will follow up by email at the address you provided.
        </p>
      </div>
    );
  }

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
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between gap-3">
        {clampedIndex > 0 ? (
          <button type="button" onClick={back} className="rounded-full px-5 py-2.5 text-sm font-semibold text-navy-600 transition hover:text-navy-900">
            ← Back
          </button>
        ) : (
          <span />
        )}

        {isLast ? (
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {status === 'submitting' && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {status === 'submitting' ? 'Sending…' : 'Submit request'}
          </button>
        ) : (
          <button type="button" onClick={next} className="rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
            Continue →
          </button>
        )}
      </div>

      {status === 'error' && <p role="alert" className="mt-4 text-center text-sm text-red-600">{submitError}</p>}
      <p className="mt-4 text-center text-xs text-navy-400">Goes straight to marketing@unitedmortgage.com</p>
    </form>
  );
}
