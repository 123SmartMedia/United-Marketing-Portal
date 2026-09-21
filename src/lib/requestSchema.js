import { z } from 'zod';

/**
 * Shared request-form schema + option lists.
 * Used by the multi-step wizard (client validation) and the /api/requests route
 * (server validation), so the two can never drift.
 */

export const REQUEST_TYPES = [
  'Business Cards',
  'Letterhead / Stationery',
  'Co-branded Flyer / Folder',
  'Print Order (Banner, Yard Sign, Door Hanger)',
  'Digital Asset Creation',
  'Custom / Other',
];

// Request types whose Step 2 shows the printing block.
export const PRINT_TYPES = new Set([
  'Business Cards',
  'Letterhead / Stationery',
  'Print Order (Banner, Yard Sign, Door Hanger)',
]);

// Request types whose Step 2 shows the co-branding block.
export const COBRAND_TYPES = new Set(['Co-branded Flyer / Folder', 'Custom / Other']);

export const YES_NO = ['Yes', 'No'];
export const QUANTITIES = ['100', '250', '500', '1000', '2500', 'Custom'];
export const SIZES = [
  'Standard Letter',
  'Tabloid',
  'Business Card',
  'Door Hanger',
  'Yard Sign',
  'Custom',
];
export const FINISHES = [
  'Standard Gloss',
  'Standard Matte',
  'Premium Cardstock',
  'Eco-Friendly',
  'Not Sure - Recommend One',
];

// Upload limits and the accepted-type list live in src/lib/uploadRules.js, which
// the browser, /api/jira/requests/init and /api/jira/requests/finalize all read.
// Re-exported here so existing importers keep working and the two can never drift.
export {
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MAX_FILE_BYTES,
  ACCEPTED_UPLOAD_TYPES,
  ACCEPTED_UPLOAD_EXT,
} from './uploadRules.js';

const nonEmpty = (msg) => z.string().trim().min(1, msg);

// Whether Step 2's print sub-fields are required (print type + "Printing Needed? = Yes").
export function printFieldsRequired(v) {
  return PRINT_TYPES.has(v.requestType) && v.printingNeeded === 'Yes';
}

/**
 * Full schema across all steps. Conditional requirements are enforced in
 * superRefine so a single resolver can validate the whole form, while the
 * wizard validates step-by-step via react-hook-form's `trigger(fieldNames)`.
 */
export const requestSchema = z
  .object({
    // Step 1 — the basics
    name: nonEmpty('Please enter your full name.'),
    email: z.string().trim().email('Please enter a valid work email.'),
    phone: nonEmpty('Please enter a phone number.'),
    nmls: nonEmpty('Please enter your NMLS ID.'),
    branch: nonEmpty('Please enter your branch or office.'),
    requestType: z.enum(REQUEST_TYPES, { message: 'Please choose a request type.' }),
    dateNeeded: nonEmpty('Please choose a date needed by.'),
    rush: z.boolean().optional().default(false),

    // Step 2 — print block
    printingNeeded: z.string().optional().default(''),
    quantity: z.string().optional().default(''),
    size: z.string().optional().default(''),
    finish: z.string().optional().default(''),

    // Step 2 — co-brand block
    cobrand: z.string().optional().default(''),
    partnerName: z.string().optional().default(''),
    complianceApproved: z.boolean().optional().default(false),

    // Step 3 — creative
    projectTitle: nonEmpty('Please give the project a short title.'),
    keyMessage: nonEmpty('Please describe the key message or call to action.'),
    additionalDetails: z.string().optional().default(''),

    // Step 3 — uploads. Metadata only; the bytes never pass through here.
    //
    // The two-stage flow means this array is validated TWICE with a different
    // shape each time. At `/init` the files have not been uploaded yet and carry
    // no `key` — the server mints one per file and returns it. At `/finalize`
    // each file echoes back the key it was uploaded under, and the server checks
    // that key against the signed token before touching the object.
    //
    // `key` is therefore optional here, and its real enforcement lives in
    // finalize (token-permitted set + per-request namespace), never in the
    // schema. No readable URL is ever held client-side.
    files: z
      .array(
        z.object({
          name: z.string(),
          size: z.number(),
          type: z.string(),
          key: z.string().optional(),
          // Browser-only. The live File object the dropzone is holding, kept in
          // form state so the wizard can PUT the bytes once init returns a
          // presigned URL. zodResolver strips unknown keys, so it must be
          // declared here or it would be silently dropped before submit.
          // It is never serialized: the wizard sends name/size/type only.
          file: z.any().optional(),
        })
      )
      .optional()
      .default([]),

    // Honeypot
    company: z.string().optional().default(''),
  })
  .superRefine((v, ctx) => {
    // Date must not be in the past.
    if (v.dateNeeded) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const picked = new Date(v.dateNeeded + 'T00:00:00');
      if (!Number.isNaN(picked.getTime()) && picked < today) {
        ctx.addIssue({ path: ['dateNeeded'], code: 'custom', message: 'Date can’t be in the past.' });
      }
    }

    // Print block validation.
    if (PRINT_TYPES.has(v.requestType)) {
      if (v.printingNeeded !== 'Yes' && v.printingNeeded !== 'No') {
        ctx.addIssue({ path: ['printingNeeded'], code: 'custom', message: 'Please choose Yes or No.' });
      }
      if (v.printingNeeded === 'Yes') {
        if (!v.quantity) ctx.addIssue({ path: ['quantity'], code: 'custom', message: 'Choose an estimated quantity.' });
        if (!v.size) ctx.addIssue({ path: ['size'], code: 'custom', message: 'Choose a size / format.' });
        if (!v.finish) ctx.addIssue({ path: ['finish'], code: 'custom', message: 'Choose a finish / paper type.' });
      }
    }

    // Co-brand block validation.
    if (COBRAND_TYPES.has(v.requestType)) {
      if (v.cobrand !== 'Yes' && v.cobrand !== 'No') {
        ctx.addIssue({ path: ['cobrand'], code: 'custom', message: 'Please choose Yes or No.' });
      }
      if (v.cobrand === 'Yes') {
        if (!v.partnerName?.trim())
          ctx.addIssue({ path: ['partnerName'], code: 'custom', message: 'Enter the partner company name.' });
        if (!v.complianceApproved)
          ctx.addIssue({ path: ['complianceApproved'], code: 'custom', message: 'Compliance confirmation is required for co-branded materials.' });
      }
    }
  });

/**
 * Lenient schema for the simple inline forms (category CTA, Get Started), which
 * collect far fewer fields. Keeps those working while the wizard uses the full
 * schema above. Selected by `source` in the API route.
 */
export const simpleSchema = z.object({
  source: z.string().optional(),
  requestType: z.string().trim().min(1).default('Custom Request'),
  name: nonEmpty('Please enter your full name.'),
  email: z.string().trim().email('Please enter a valid email.'),
  phone: z.string().optional().default(''),
  nmls: z.string().optional().default(''),
  asset: z.string().optional().default(''),
  details: nonEmpty('Please add some details.'),
});

// Field names per step — drives per-step validation and progress.
export const STEP_FIELDS = {
  1: ['name', 'email', 'phone', 'nmls', 'branch', 'requestType', 'dateNeeded', 'rush'],
  2: ['printingNeeded', 'quantity', 'size', 'finish', 'cobrand', 'partnerName', 'complianceApproved'],
  3: ['projectTitle', 'keyMessage', 'additionalDetails', 'files'],
};

// Does this request type show a Step 2 at all?
export function hasStep2(requestType) {
  return PRINT_TYPES.has(requestType) || COBRAND_TYPES.has(requestType);
}
