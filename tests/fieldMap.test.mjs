import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRequestFieldValues,
  buildSummary,
  buildDescription,
  parseOptionMap,
  normalizeText,
  FIELD_DEFINITIONS,
  STANDARD_FIELDS,
} from '../src/lib/jira/fieldMap.js';

const fullSubmission = {
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  phone: '631-203-7480',
  nmls: '1234567',
  branch: 'Melville, NY',
  requestType: 'Business Cards',
  dateNeeded: '2026-12-01',
  rush: true,
  printingNeeded: 'Yes',
  quantity: '500',
  size: 'Business Card',
  finish: 'Premium Cardstock',
  cobrand: '',
  partnerName: '',
  complianceApproved: false,
  projectTitle: 'Q3 Suffolk County Farming Campaign',
  keyMessage: 'Call for a free home valuation.',
  additionalDetails: 'Navy and white only.',
  files: [],
};

test('summary combines rush flag, project title and requester', () => {
  assert.equal(
    buildSummary(fullSubmission),
    '[RUSH] Q3 Suffolk County Farming Campaign — Jane Officer'
  );
});

test('summary falls back to the request type when no project title was given', () => {
  assert.equal(buildSummary({ requestType: 'Letterhead / Stationery', name: 'Sam' }), 'Letterhead / Stationery — Sam');
});

test('summary is truncated rather than sent over-length', () => {
  const summary = buildSummary({ ...fullSubmission, projectTitle: 'x'.repeat(400) });
  assert.ok(summary.length <= 240, `summary was ${summary.length} chars`);
  assert.ok(summary.endsWith('…'));
});

test('standard summary and description fields are always present', () => {
  const { requestFieldValues } = buildRequestFieldValues(fullSubmission, { env: {} });
  assert.ok(requestFieldValues[STANDARD_FIELDS.SUMMARY]);
  assert.ok(requestFieldValues[STANDARD_FIELDS.DESCRIPTION]);
});

test('no submitted value is silently dropped when no custom field is mapped', () => {
  const { requestFieldValues, mapped, unmapped } = buildRequestFieldValues(fullSubmission, { env: {} });
  assert.deepEqual(mapped, []);

  const description = requestFieldValues[STANDARD_FIELDS.DESCRIPTION];
  for (const key of unmapped) {
    const def = FIELD_DEFINITIONS.find((d) => d.key === key);
    assert.ok(description.includes(def.label), `description is missing "${def.label}"`);
  }
  // Spot-check the actual values, not just the labels.
  assert.match(description, /1234567/);
  assert.match(description, /Melville, NY/);
  assert.match(description, /Premium Cardstock/);
  assert.match(description, /Call for a free home valuation\./);
});

test('mapped custom fields receive the right shapes per field type', () => {
  const env = {
    JIRA_FIELD_REQUESTER_NAME: 'customfield_10050',
    JIRA_FIELD_DATE_NEEDED: 'customfield_10051',
    JIRA_FIELD_REQUEST_TYPE: 'customfield_10052',
    JIRA_FIELD_RUSH: 'customfield_10053',
    JIRA_FIELD_PRINTING_NEEDED: 'customfield_10054',
  };
  const { requestFieldValues, mapped } = buildRequestFieldValues(fullSubmission, { env });

  assert.equal(requestFieldValues.customfield_10050, 'Jane Officer'); // text
  assert.equal(requestFieldValues.customfield_10051, '2026-12-01'); // date, bare ISO
  assert.deepEqual(requestFieldValues.customfield_10052, { value: 'Business Cards' }); // select by label
  assert.deepEqual(requestFieldValues.customfield_10053, { value: 'Yes' }); // boolean -> Yes
  assert.deepEqual(requestFieldValues.customfield_10054, { value: 'Yes' }); // yes/no
  assert.equal(mapped.length, 5);
});

test('select options use the configured option id when one exists', () => {
  const env = {
    JIRA_FIELD_REQUEST_TYPE: 'customfield_10052',
    JIRA_FIELD_OPTIONS: JSON.stringify({ requestType: { 'Business Cards': '10234' } }),
  };
  const { requestFieldValues } = buildRequestFieldValues(fullSubmission, { env });
  assert.deepEqual(requestFieldValues.customfield_10052, { id: '10234' });
});

test('an unknown option label falls back to sending the label by value', () => {
  const env = {
    JIRA_FIELD_QUANTITY: 'customfield_10060',
    JIRA_FIELD_OPTIONS: JSON.stringify({ quantity: { '100': '1' } }),
  };
  const { requestFieldValues } = buildRequestFieldValues(fullSubmission, { env });
  assert.deepEqual(requestFieldValues.customfield_10060, { value: '500' });
});

test('a malformed option map degrades to labels instead of throwing', () => {
  assert.deepEqual(parseOptionMap('{not json'), {});
  assert.deepEqual(parseOptionMap('[1,2]'), {});
  const { requestFieldValues } = buildRequestFieldValues(fullSubmission, {
    env: { JIRA_FIELD_REQUEST_TYPE: 'customfield_1', JIRA_FIELD_OPTIONS: '{not json' },
  });
  assert.deepEqual(requestFieldValues.customfield_1, { value: 'Business Cards' });
});

test('a malformed date is kept in the description instead of sent as a Jira date', () => {
  const { requestFieldValues, unmapped } = buildRequestFieldValues(
    { ...fullSubmission, dateNeeded: '12/01/2026' },
    { env: { JIRA_FIELD_DATE_NEEDED: 'customfield_10051' } }
  );
  assert.equal(requestFieldValues.customfield_10051, undefined);
  assert.ok(unmapped.includes('dateNeeded'));
  assert.match(requestFieldValues[STANDARD_FIELDS.DESCRIPTION], /12\/01\/2026/);
});

test('empty and false values produce no structured field and no description row', () => {
  const { requestFieldValues, mapped } = buildRequestFieldValues(
    { ...fullSubmission, partnerName: '   ', complianceApproved: false },
    { env: { JIRA_FIELD_PARTNER_NAME: 'customfield_1', JIRA_FIELD_COMPLIANCE_APPROVED: 'customfield_2' } }
  );
  assert.equal(requestFieldValues.customfield_1, undefined);
  assert.equal(requestFieldValues.customfield_2, undefined);
  assert.deepEqual(mapped, []);
  assert.ok(!requestFieldValues[STANDARD_FIELDS.DESCRIPTION].includes('Partner company'));
});

test('attachment filenames and the correlation id are written into the description', () => {
  const description = buildDescription(fullSubmission, {
    attachments: [
      { name: 'headshot.png', size: 2048, key: 'requests/2026-09-21/2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png' },
    ],
    correlationId: 'abc-123',
    submittedFrom: 'marketing.unitedmortgage.com',
  });
  assert.match(description, /Attachments \(1\)/);
  assert.match(description, /headshot\.png \(2 KB\)/);
  assert.match(description, /Correlation ID: abc-123/);
});

test('no object key, URL or storage host ever appears in the description', () => {
  const description = buildDescription(fullSubmission, {
    attachments: [
      { name: 'headshot.png', size: 2048, key: 'requests/2026-09-21/2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png' },
      { name: 'flyer.pdf', size: 4096, key: 'requests/2026-09-21/11112222-3333-4444-5555-666677778888.pdf' },
    ],
    correlationId: 'abc-123',
  });
  // The description is read by more people than the submitter, and a pointer to
  // the raw object would outlive the short retention window it is meant to have.
  assert.ok(!description.includes('requests/'), 'an object key prefix leaked');
  assert.ok(!description.includes('2b3a1c4d'), 'an object id leaked');
  assert.ok(!description.includes('http'), 'a URL leaked');
  assert.ok(!description.includes('r2.cloudflarestorage.com'));
  // The filenames are still there, so the desk knows what was meant to arrive.
  assert.match(description, /headshot\.png/);
  assert.match(description, /flyer\.pdf/);
});

test('the lightweight inline-form fields are mapped too', () => {
  const { requestFieldValues } = buildRequestFieldValues(
    { name: 'Sam', requestType: 'Custom Request', asset: 'Business Cards', details: 'Need 500 cards.' },
    { env: {} }
  );
  const description = requestFieldValues[STANDARD_FIELDS.DESCRIPTION];
  assert.match(description, /Related asset: Business Cards/);
  assert.match(description, /Need 500 cards\./);
});

// --- Verified Marketing Requests (MKT) instance mapping -----------------------
// IDs below were read through the read-only Atlassian MCP connector on 2026-09-21
// (getJiraIssueTypeMetaWithFields on project MKT, issue type 10078). They are the
// real field IDs on unitedmortgage.atlassian.net. Full record and the reasoning for
// every mapping decision: docs/jira-mcp-discovery.md

// The single mapping that is both verified and semantically exact.
const MKT_REQUESTED_DUE_DATE = 'customfield_10301';
// Verified field IDs deliberately NOT mapped — see the tests below for why.
const MKT_BRANCH_TEAM = 'customfield_10297';
const MKT_COMPLIANCE_REVIEW_NEEDED = 'customfield_10303';

test('dateNeeded maps to the verified MKT – Requested Due Date field as a bare ISO date', () => {
  const { requestFieldValues, mapped, unmapped } = buildRequestFieldValues(fullSubmission, {
    env: { JIRA_FIELD_DATE_NEEDED: MKT_REQUESTED_DUE_DATE },
  });
  // A Jira date field takes 'YYYY-MM-DD', never an object and never a Date.
  assert.equal(requestFieldValues[MKT_REQUESTED_DUE_DATE], '2026-12-01');
  assert.deepEqual(mapped, [{ key: 'dateNeeded', fieldId: MKT_REQUESTED_DUE_DATE }]);
  assert.ok(!unmapped.includes('dateNeeded'));
});

test('the verified MKT option fields stay unmapped until their semantics are resolved', () => {
  // Guards two real hazards found during MCP discovery:
  //  - customfield_10297 (MKT – Branch / Team) is a single-select whose context
  //    exposes only option 10152 "Other / Not Listed", while UMC collects `branch`
  //    as free text — an arbitrary branch name has no option to land on.
  //  - customfield_10303 (MKT – Compliance Review Needed) is the INVERSE of UMC's
  //    `complianceApproved`: mapping true -> Yes would push already-approved
  //    co-branded work into the compliance review queue.
  // This test fails the moment either is wired into the default env, which is the
  // point: enabling them must be a deliberate decision, not a drive-by edit.
  const { requestFieldValues, unmapped } = buildRequestFieldValues(fullSubmission, { env: {} });
  assert.equal(requestFieldValues[MKT_BRANCH_TEAM], undefined);
  assert.equal(requestFieldValues[MKT_COMPLIANCE_REVIEW_NEEDED], undefined);
  // Nothing is lost: both values still reach the desk in the description.
  assert.ok(unmapped.includes('branch'));
  assert.match(requestFieldValues[STANDARD_FIELDS.DESCRIPTION], /Branch \/ office: Melville, NY/);
});

test('an unverified field id is never invented for a UMC field that has no Jira target', () => {
  // requestType, nmls, phone, quantity, size, finish, cobrand, partnerName and
  // keyMessage have NO structured field on the MKT instance. They must ride in the
  // description rather than be guessed onto some customfield_*.
  const noTarget = ['requestType', 'nmls', 'phone', 'quantity', 'size', 'finish', 'keyMessage'];
  const { requestFieldValues, unmapped } = buildRequestFieldValues(fullSubmission, { env: {} });
  const description = requestFieldValues[STANDARD_FIELDS.DESCRIPTION];

  for (const key of noTarget) {
    assert.ok(unmapped.includes(key), `${key} should be reported as unmapped`);
    const def = FIELD_DEFINITIONS.find((d) => d.key === key);
    assert.match(description, new RegExp(def.label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  }
  // Only summary and description are sent when nothing is mapped.
  assert.deepEqual(Object.keys(requestFieldValues).sort(), ['description', 'summary']);
});

test('every UMC field definition that carries an envVar uses the JIRA_FIELD_ prefix', () => {
  // The env var name is the whole contract between .env.example and this module;
  // a typo here silently unmaps a field instead of failing loudly.
  for (const def of FIELD_DEFINITIONS) {
    assert.match(def.envVar, /^JIRA_FIELD_[A-Z_]+$/, `${def.key} has envVar "${def.envVar}"`);
  }
});

test('normalizeText collapses whitespace but keeps paragraphs in multiline values', () => {
  assert.equal(normalizeText('  a   b \n c '), 'a b c');
  assert.equal(normalizeText('a\n\n\n\nb', { multiline: true }), 'a\n\nb');
  assert.equal(normalizeText(undefined), '');
});
