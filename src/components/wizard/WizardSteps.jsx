'use client';

import { REQUEST_TYPES, YES_NO, QUANTITIES, SIZES, FINISHES } from '@/lib/requestSchema';
import { TextField, SelectField, TextareaField, CheckboxField } from '@/components/wizard/fields';
import FileDropzone from '@/components/wizard/FileDropzone';

/** Human labels for the error summary, keyed by form field name. */
export const FIELD_LABELS = Object.freeze({
  name: 'Full name',
  email: 'Work email',
  phone: 'Phone number',
  nmls: 'NMLS ID',
  branch: 'Branch / office',
  requestType: 'Request type',
  dateNeeded: 'Date needed by',
  rush: 'Rush request',
  printingNeeded: 'Printing needed?',
  quantity: 'Estimated quantity',
  size: 'Size / format',
  finish: 'Finish / paper',
  cobrand: 'Co-branding with a partner?',
  partnerName: 'Partner company name',
  complianceApproved: 'Compliance confirmation',
  projectTitle: 'Project title',
  keyMessage: 'Key message / call to action',
  additionalDetails: 'Additional details',
  files: 'Files',
});

export function BasicsStep({ register, errors, minDate, rushSuggested }) {
  return (
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
        <TextField
          id="dateNeeded"
          label="Date needed by"
          required
          type="date"
          min={minDate}
          registration={register('dateNeeded')}
          error={errors.dateNeeded?.message}
        />
        <div className="flex items-end">
          <label htmlFor="rush" className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-navy-200 px-4 py-3">
            <span className="text-sm font-medium text-navy-700">
              Rush request
              <span className="block text-xs font-normal text-navy-500">Needed in under 7 business days</span>
            </span>
            <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
              <input id="rush" type="checkbox" role="switch" className="peer sr-only" {...register('rush')} />
              <span className="h-6 w-11 rounded-full bg-navy-200 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-2" />
              <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        </div>
      </div>
      {rushSuggested && (
        <p id="rush-hint" role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="font-semibold">That’s under 7 business days away,</span> so we’ve marked this as a rush
          request. Turn Rush off if the date is flexible.
        </p>
      )}
    </>
  );
}

export function DetailsStep({ register, errors, showPrint, showCobrand, printingNeeded, cobrand }) {
  return (
    <>
      {showPrint && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-500">Printing</h3>
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
          <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-500">Co-branding</h3>
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
  );
}

export function CreativeStep({ register, errors, files, onFilesChange }) {
  return (
    <>
      <TextField id="projectTitle" label="Project title" required registration={register('projectTitle')} error={errors.projectTitle?.message} placeholder="e.g., Q3 Suffolk County Farming Campaign" />
      <TextareaField id="keyMessage" label="Key message / call to action" required registration={register('keyMessage')} error={errors.keyMessage?.message} placeholder="e.g., Call for a free home valuation, mention our 3.99% special…" />
      <TextareaField id="additionalDetails" label="Additional details" registration={register('additionalDetails')} placeholder="Any specific colors, layout preferences, or text to include?" rows={3} />
      <FileDropzone value={files} onChange={onFilesChange} error={errors.files?.message} />
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <span className="font-semibold">Do not include borrower information.</span> Marketing requests
        are not a secure channel — never attach or describe Social Security numbers, bank statements,
        tax returns, credit reports, loan files, or any other nonpublic borrower information.
      </p>
    </>
  );
}
