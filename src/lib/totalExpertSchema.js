import { z } from './zod.js';
import { TOTAL_EXPERT_REQUEST_TYPE } from './jira/requestTypeRouting.js';

/**
 * Total Expert account sign-up — shared schema + option lists.
 * Used by the /total-expert form (client validation) and /api/total-expert
 * (server validation), so the two can never drift.
 *
 * The form has its own fields, but the Jira and email pipelines already know how
 * to deliver a marketing request, so `toJiraSubmission()` reshapes a sign-up into
 * that familiar submission rather than teaching either pipeline a new shape.
 */

export const TE_ROLES = [
  'Loan Officer',
  'Branch Manager',
  'Loan Officer Assistant',
  'Processor',
  'Other',
];

export const TE_ACCOUNT_TYPES = [
  'New account',
  'Reactivate a previous account',
  'Transfer from another company',
];

// Fields remembered in the browser to prefill the next form.
export const TE_REMEMBERED_FIELDS = ['name', 'email', 'phone', 'nmls', 'branch'];

const SHORT = 120;
const MEDIUM = 300;
const NOTES_MAX = 2000;

const required = (msg, max = SHORT) =>
  z.string().trim().min(1, msg).max(max, `Please keep this under ${max} characters.`);
const optional = (max) =>
  z.string().trim().max(max, `Please keep this under ${max} characters.`).optional().default('');

export const totalExpertSchema = z.object({
  name: required('Please enter your full name.'),
  email: z.string().trim().max(SHORT).email('Please enter a valid work email.'),
  phone: required('Please enter a phone number.', 40),
  nmls: required('Please enter your NMLS ID.', 40),
  branch: required('Please enter your branch or office.'),
  role: z.enum(TE_ROLES, { message: 'Please choose your role.' }),
  manager: required('Please enter your manager’s name.'),
  accountType: z.enum(TE_ACCOUNT_TYPES, { message: 'Please choose what you need.' }),
  startDate: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Please use a valid date.')
    .optional()
    .default(''),
  licensedStates: optional(MEDIUM),
  notes: optional(NOTES_MAX),

  // Honeypot
  company: z.string().optional().default(''),
});

/**
 * Reshape a validated sign-up into the submission shape `submitJiraRequest`
 * (via fieldMap.js) and `deliverSubmission` (email) both render. Pure.
 */
export function toJiraSubmission(data) {
  const details = [
    ['Role', data.role],
    ['Manager', data.manager],
    ['Account request', data.accountType],
    ['Start date', data.startDate],
    ['Licensed states', data.licensedStates],
    ['Notes', data.notes],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');

  return {
    requestType: TOTAL_EXPERT_REQUEST_TYPE,
    name: data.name,
    email: data.email,
    phone: data.phone,
    nmls: data.nmls,
    branch: data.branch,
    projectTitle: `Total Expert account — ${data.accountType}`,
    keyMessage: `${data.accountType} for ${data.name} (${data.role}, NMLS ${data.nmls}).`,
    additionalDetails: details,
    rush: false,
    files: [],
  };
}
