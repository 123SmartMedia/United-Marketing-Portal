#!/usr/bin/env node
/**
 * Jira Service Management configuration discovery.
 * ------------------------------------------------
 *   npm run jira:discover
 *   npm run jira:discover -- --project "Marketing Requests"
 *   npm run jira:discover -- --service-desk 42 --request-type 118
 *
 * Read-only. Retrieves and prints everything the integration needs:
 *   - service desk IDs, project keys and names
 *   - request types, their IDs and their underlying issue type IDs
 *   - portal visibility per request type (portal group membership)
 *   - required and optional field IDs, with COMPLETE valid option sets
 *   - Jira Form (ProForma) associations and form question IDs, when readable
 *   - whether the request type accepts attachments
 *   - whether the integration account may raise requests, and whether it may
 *     raise them on behalf of a customer
 *   - a closing summary naming any general-purpose marketing request type
 *
 * It authenticates through the same config module as the production route, so
 * whatever JIRA_AUTH_MODE is set to is what gets exercised here. It never prints
 * the API token or an Authorization header.
 *
 * Run it locally or in a trusted shell only — the field listing is internal
 * configuration detail.
 */

import {
  loadEnvFile,
  resolveScriptConfig,
  describeConfig,
  apiFetch,
  explainStatus,
  fail,
} from './lib/jira-script-auth.mjs';
import { AUTH_MODES } from '../src/lib/jira/config.js';

loadEnvFile();

const { config, authorization } = resolveScriptConfig();

// --- args ------------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
/** The only MKT issue type carrying the MKT custom fields (verified 2026-09-21). */
const TARGET_ISSUE_TYPE_ID = arg('issue-type') || '10078';

const projectFilter = arg('project') || (process.env.JIRA_PROJECT_NAME || '').trim();
const serviceDeskArg = arg('service-desk') || config.serviceDeskId;
const requestTypeArg = arg('request-type') || config.requestTypeId;

// --- output helpers --------------------------------------------------------

const log = (...args) => console.log(...args);
const heading = (text) => log(`\n${text}\n${'-'.repeat(text.length)}`);

const api = (path) => apiFetch(path, { authorization, config });

/**
 * Jira Forms (ProForma) lives on its own host, not on the Jira API base, so it
 * cannot go through `api()`. Only reachable in scoped_token mode, and only when
 * the token carries a forms read scope — every failure is reported, never thrown.
 */
async function formsApi(path) {
  if (config.authMode !== AUTH_MODES.SCOPED_TOKEN || !config.cloudId) {
    throw new Error('forms API needs scoped_token mode and a cloud id');
  }
  const response = await fetch(`https://api.atlassian.com/jira/forms/cloud/${config.cloudId}${path}`, {
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      'X-ExperimentalApi': 'opt-in',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Collected across every request type so main() can summarize at the end. */
const inventory = [];

// --- discovery steps -------------------------------------------------------

async function listServiceDesks() {
  const all = [];
  let start = 0;
  for (;;) {
    const page = await api(`/rest/servicedeskapi/servicedesk?start=${start}&limit=50`);
    all.push(...(page.values || []));
    if (page.isLastPage !== false) break;
    start += 50;
  }
  return all;
}

async function projectName(projectId) {
  try {
    const project = await api(`/rest/api/3/project/${encodeURIComponent(projectId)}`);
    return { key: project.key, name: project.name };
  } catch {
    return { key: '(no permission)', name: '(no permission)' };
  }
}

/**
 * Jira Forms attached to a request type, with each question's id.
 * Returns a printable status string rather than throwing: a missing forms scope
 * is a normal outcome, not a discovery failure.
 */
async function describeForms(serviceDeskId, requestTypeId, indent = '  ') {
  let forms;
  try {
    forms = await formsApi(`/servicedesk/${serviceDeskId}/requesttype/${requestTypeId}/form`);
  } catch (err) {
    const why = err.status
      ? `HTTP ${err.status}${err.status === 403 ? ' — token is missing a Jira Forms read scope' : ''}`
      : err.message;
    log(`${indent}jira form            : NOT READABLE (${why})`);
    return null;
  }

  const list = Array.isArray(forms) ? forms : forms?.values || [];
  if (!list.length) {
    log(`${indent}jira form            : none attached`);
    return [];
  }

  log(`${indent}jira form            : YES — ${list.length} attached`);
  for (const form of list) {
    log(`${indent}  form id ${form.id} "${form.name || form.formTemplate?.name || '(unnamed)'}"`);
    // Question ids are what a form submission is keyed by, so they matter as much
    // as customfield ids do for the plain request payload.
    const questions = form.design?.questions || form.formTemplate?.design?.questions || {};
    for (const [questionId, question] of Object.entries(questions)) {
      const required = question.validation?.rq ? 'REQUIRED' : 'optional';
      log(`${indent}    q${questionId}  [${required}]  ${question.label || '(no label)'}  (type: ${question.type || '?'})`);
      for (const choice of question.choices || []) {
        log(`${indent}      choice id ${choice.id} = "${choice.label}"`);
      }
    }
  }
  return list;
}

async function describeRequestType(serviceDeskId, requestType, groupNames) {
  heading(`Request type ${requestType.id} — ${requestType.name}`);
  log(`  description          : ${requestType.description || '(none)'}`);
  // The underlying issue type decides which custom fields exist at all, so it is
  // the first thing to check against the field inventory.
  log(`  issue type id        : ${requestType.issueTypeId ?? '(not reported)'}`);
  log(`  portal id            : ${requestType.portalId ?? '(not reported)'}`);

  // A request type that belongs to no portal group is not browsable in the
  // customer portal, even though it may still be reachable by direct link.
  const groupIds = requestType.groupIds || [];
  const groupLabels = groupIds.map((id) => `${id}${groupNames.has(id) ? ` (${groupNames.get(id)})` : ''}`);
  log(
    `  portal visibility    : ${
      groupIds.length
        ? `VISIBLE — portal group(s) ${groupLabels.join(', ')}`
        : 'HIDDEN from portal browse — belongs to no portal group'
    }`
  );

  let fields;
  try {
    fields = await api(
      `/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype/${requestType.id}/field`
    );
  } catch (err) {
    log(`  fields               : unavailable — ${explainStatus(err.status, config)}`);
    inventory.push({ requestType, groupIds, fields: null, forms: null });
    return;
  }

  log(`  can raise on behalf of : ${fields.canRaiseOnBehalfOf === true ? 'YES' : 'no'}`);
  log(`  can add participants   : ${fields.canAddRequestParticipants === true ? 'YES' : 'no'}`);

  const list = fields.requestTypeFields || [];
  const attachmentField = list.find((f) => f.jiraSchema?.system === 'attachment' || f.fieldId === 'attachment');
  log(`  attachments enabled    : ${attachmentField ? 'YES (attachment field present)' : 'not exposed on this request type'}`);

  const required = list.filter((f) => f.required);
  log(`  required field count   : ${required.length}${required.length ? ` (${required.map((f) => f.fieldId).join(', ')})` : ''}`);

  const forms = await describeForms(serviceDeskId, requestType.id);

  log('\n  Fields:');
  for (const field of list) {
    const flag = field.required ? 'REQUIRED' : 'optional';
    const type = field.jiraSchema?.type || 'unknown';
    log(`    - ${field.fieldId}  [${flag}]  ${field.name}  (type: ${type})`);
    // Print the COMPLETE option set. A truncated list is worse than none: it
    // invites a mapping built on options that were never seen.
    for (const value of field.validValues || []) {
      log(`        option id ${value.value} = "${value.label}"`);
    }
  }

  inventory.push({ requestType, groupIds, fields: list, forms, attachments: Boolean(attachmentField) });

  log('\n  Suggested env for this request type:');
  log(`    JIRA_SERVICE_DESK_ID=${serviceDeskId}`);
  log(`    JIRA_REQUEST_TYPE_ID=${requestType.id}`);
  log('    # Map UMC fields onto the field IDs listed above. Only map a field whose');
  log('    # semantics and option set you have actually confirmed — see');
  log('    # docs/jira-mcp-discovery.md for the mappings deliberately left open.');
}

// --- main ------------------------------------------------------------------

async function main() {
  log(describeConfig(config));

  let desks;
  try {
    desks = await listServiceDesks();
  } catch (err) {
    fail(`Could not list service desks. ${explainStatus(err.status, config)}`);
  }

  heading(`Service desks (${desks.length})`);
  const rows = [];
  for (const desk of desks) {
    const project = await projectName(desk.projectId);
    rows.push({ ...desk, projectKey: project.key, projectName: project.name });
    log(
      `  serviceDeskId ${String(desk.id).padEnd(5)} projectId ${String(desk.projectId).padEnd(6)} ` +
        `${project.key.padEnd(10)} ${project.name}`
    );
  }

  log(
    '\nNote: the number in the portal URL (/servicedesk/customer/portal/68) is the PORTAL id,' +
      '\nwhich is usually NOT the serviceDeskId above. Match on project name/key instead.' +
      '\nOn the United Mortgage instance they happen to coincide — both are 68.'
  );

  // Pick the desk(s) to describe.
  let targets = rows;
  if (serviceDeskArg) {
    targets = rows.filter((d) => String(d.id) === String(serviceDeskArg));
    if (!targets.length) fail(`No service desk with id ${serviceDeskArg} is visible to this account.`);
  } else if (projectFilter) {
    const needle = projectFilter.toLowerCase();
    targets = rows.filter(
      (d) => d.projectName.toLowerCase().includes(needle) || d.projectKey.toLowerCase() === needle
    );
    if (!targets.length) fail(`No service desk matched project "${projectFilter}".`);
  } else {
    log('\nTip: re-run with --project "Marketing Requests" (or --service-desk <id>) to inspect one desk.');
    return;
  }

  for (const desk of targets) {
    heading(`Service desk ${desk.id} — ${desk.projectName} (${desk.projectKey})`);

    let requestTypes;
    try {
      requestTypes = await api(`/rest/servicedeskapi/servicedesk/${desk.id}/requesttype?limit=100`);
    } catch (err) {
      log(`  request types unavailable — ${explainStatus(err.status, config)}`);
      continue;
    }

    // Portal group names turn the bare groupIds on each request type into
    // something a human can act on.
    const groupNames = new Map();
    try {
      const groups = await api(`/rest/servicedeskapi/servicedesk/${desk.id}/requesttypegroup?limit=100`);
      for (const group of groups.values || []) groupNames.set(String(group.id), group.name);
      log(`\n  Portal groups: ${[...groupNames].map(([id, name]) => `${id} (${name})`).join(', ') || '(none)'}`);
    } catch (err) {
      log(`\n  Portal groups unavailable — ${explainStatus(err.status, config)}`);
    }

    const values = requestTypes.values || [];
    log(`\n  ${values.length} request type(s):`);
    for (const rt of values) {
      const groups = (rt.groupIds || []).length ? `groups ${rt.groupIds.join(',')}` : 'NO PORTAL GROUP';
      log(`    id ${String(rt.id).padEnd(6)} issueType ${String(rt.issueTypeId ?? '?').padEnd(6)} ${String(rt.name).padEnd(38)} ${groups}`);
    }

    // --request-type narrows to one; otherwise describe every request type built
    // on issue type 10078, which is the only one carrying the MKT custom fields.
    let chosen;
    if (requestTypeArg) {
      chosen = values.filter((rt) => String(rt.id) === String(requestTypeArg));
      if (!chosen.length) fail(`No request type with id ${requestTypeArg} on service desk ${desk.id}.`);
    } else {
      chosen = values.filter((rt) => String(rt.issueTypeId) === String(TARGET_ISSUE_TYPE_ID));
      log(
        `\n  Describing the ${chosen.length} request type(s) on issue type ${TARGET_ISSUE_TYPE_ID}.` +
          '\n  Pass --request-type <id> to inspect a different one, or --all-issue-types for every type.'
      );
      if (process.argv.includes('--all-issue-types')) chosen = values;
    }

    for (const rt of chosen) {
      await describeRequestType(desk.id, rt, groupNames);
    }

    summarize(desk);
  }
}

/**
 * Closing verdict: is there already a request type the UMC form can target?
 * "General-purpose" means it is built on the right issue type, is reachable from
 * the portal, and is not one of the narrow single-purpose intakes.
 */
function summarize(desk) {
  heading(`Summary — service desk ${desk.id} (${desk.projectKey})`);

  const usable = inventory.filter(
    (entry) =>
      String(entry.requestType.issueTypeId) === String(TARGET_ISSUE_TYPE_ID) &&
      entry.groupIds.length > 0 &&
      entry.fields !== null
  );

  if (!usable.length) {
    log(`  NO general-purpose request type found on issue type ${TARGET_ISSUE_TYPE_ID}.`);
    log('  Action: create one ("Submit a Marketing Request") — see the admin plan in');
    log('  docs/jira-request-type-plan.md. Leave JIRA_REQUEST_TYPE_ID unset until it exists.');
    return;
  }

  log(`  ${usable.length} candidate request type(s) on issue type ${TARGET_ISSUE_TYPE_ID}:\n`);
  for (const entry of usable) {
    const req = entry.fields.filter((f) => f.required).map((f) => f.fieldId);
    log(`    id ${entry.requestType.id}  "${entry.requestType.name}"`);
    log(`       attachments: ${entry.attachments ? 'yes' : 'NO'}   required fields: ${req.length ? req.join(', ') : 'none beyond summary'}`);
    log(`       jira form  : ${entry.forms === null ? 'not readable' : entry.forms.length ? `${entry.forms.length} attached` : 'none'}`);
  }
  log('\n  Prefer the candidate with attachments enabled and no required field the UMC');
  log('  form cannot supply. Do not set JIRA_REQUEST_TYPE_ID from this summary alone —');
  log('  confirm the choice with the marketing desk first.');
}

main().catch((err) => {
  fail(`Discovery failed: ${err?.message || 'unknown error'}`);
});
