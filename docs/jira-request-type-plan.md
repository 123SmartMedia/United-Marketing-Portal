# Jira administrator configuration plan — "Submit a Marketing Request"

**Status: CONTINGENT.** This plan applies only if `npm run jira:discover -- --service-desk 68`
confirms that **no** general-purpose request type on issue type `10078` exists. Run
discovery first. If a suitable request type already exists, use it and set
`JIRA_REQUEST_TYPE_ID` to its ID instead of building anything.

What is already known from read-only MCP discovery (see
[`jira-mcp-discovery.md`](jira-mcp-discovery.md)): the only issue-type-`10078`
request type observable was `116` *Social Media Post / Graphic*, which is a narrow
single-purpose intake, not a general marketing request. That is suggestive, not
conclusive — the request type list itself was unreadable over MCP.

---

## 1. Recommendation: one request type, one category field

Create **one** request type, `Submit a Marketing Request`, on issue type `10078`,
with a single structured **Marketing Request Category** select field carrying the six
UMC categories. Do **not** create six request types.

**Why one:**

- All six UMC categories run the same workflow. MKT already has one workflow with
  `MKT – Open → Triaged → In Progress → Proof Sent → Compliance Review → Done`
  (statuses verified via MCP), and nothing in the UMC form implies a second path.
- A category is a *value*, not a *process*. Six request types would mean six field
  configurations, six SLA associations and six sets of portal copy to keep in sync,
  all to express one dropdown.
- The integration stays simple: one `JIRA_REQUEST_TYPE_ID`, one field map. Six types
  would force a label→request-type-ID lookup table in `fieldMap.js` and a second
  discovery pass whenever marketing renames a category.
- Queues and reporting can filter on the category field just as well as on request
  type, and adding a seventh category later becomes an option edit rather than a new
  request type plus portal layout change.

**Separate request types would only be justified if discovery shows** one of:

1. A category needs **different required fields** (e.g. print orders must capture
   quantity/size/finish but digital assets must not) *and* the portal cannot express
   that with conditional form logic.
2. A category needs a **different workflow or approval step** — e.g. co-branded
   material must route through a compliance approval the others skip.
3. A category needs a **different SLA goal**. Note the MKT SLA currently varies by
   *priority*, not by request type, so this is unlikely.
4. A category must be **visible to a different customer audience** in the portal.

If (1) is the only trigger, prefer a Jira Form with conditional questions on the
single request type before splitting.

---

## 2. Request type configuration

| Setting | Value |
| --- | --- |
| Name | `Submit a Marketing Request` |
| Description | Request marketing collateral, print, digital assets or co-branded material. |
| Issue type | **`10078` — Submit a request or incident** *(mandatory: the MKT custom fields exist on no other issue type)* |
| Portal group | An existing group, e.g. `81`. **It must belong to at least one group or it will not be browsable in the portal.** |
| Portal visibility | Visible to customers |
| Attachments | **Enabled** — the UMC wizard sends up to 5 files / 10 MB |

---

## 3. Field plan

### 3a. Create this field

| Field | Type | Options |
| --- | --- | --- |
| **Marketing Request Category** | Select list (single choice) | Business Cards · Letterhead / Stationery · Co-branded Flyer / Folder · Print Order (Banner, Yard Sign, Door Hanger) · Digital Asset Creation · Custom / Other |

The six labels must match `REQUEST_TYPES` in `src/lib/requestSchema.js` **exactly**,
including spacing and punctuation. The integration sends `{ value: "<label>" }` when
no option ID is configured, and Jira resolves it by name — a mismatched label fails.
After creation, record the field ID and its option IDs via discovery and set
`JIRA_FIELD_REQUEST_TYPE` plus a `JIRA_FIELD_OPTIONS` entry.

### 3b. Add these existing MKT fields to the request type

All verified present on issue type `10078`. Add them so the desk can triage, but
**mark them optional** unless noted — a required field the UMC form does not collect
produces a 400 on every submission.

| Field | Field ID | Required? | Note |
| --- | --- | --- | --- |
| Summary | `summary` | **Required** | Jira requires it; UMC always sends it |
| Description | `description` | Optional | UMC always sends it; carries every unmapped value |
| Attachment | `attachment` | Optional | Must be exposed for uploads to work |
| MKT – Requested Due Date | `customfield_10301` | Optional | Already mapped from UMC `dateNeeded` |
| MKT – Requester Role | `customfield_10298` | Optional | UMC does not collect it yet — see §5 |
| MKT – Urgency | `customfield_10299` | Optional | UMC does not collect it yet — see §5 |
| MKT – Impact | `customfield_10300` | Optional | UMC does not collect it yet — see §5 |
| MKT – Deliverable Format | `customfield_10304` | Optional | UMC does not collect it yet |
| MKT – Rush Justification | `customfield_10302` | Optional | UMC does not collect it yet |

### 3c. Do NOT add these as required, and do not map them yet

| Field | Field ID | Why it is on hold |
| --- | --- | --- |
| MKT – Branch / Team | `customfield_10297` | Its field context returns exactly one option (`10152` "Other / Not Listed") while UMC collects `branch` as free text. Resolve the option set first. |
| MKT – Compliance Review Needed | `customfield_10303` | **Semantics are inverted** against UMC's `complianceApproved`. UMC means "compliance already approved this"; the Jira field means "this needs compliance review". |
| Priority | `priority` | `rush` must not be written straight to priority. MKT-10 implies an automation derives priority from Urgency × Impact; writing priority directly would fight it. |
| MKT – Intake Channel | `customfield_10305` | Not on the `10078` create screen — almost certainly automation-stamped. Confirm before sending. |

---

## 4. Optional new fields

Only if the marketing desk wants these structured rather than description-only. Every
one of them reaches Jira today inside the description, so none is blocking.

`NMLS ID` (text) · `Requester Phone` (text) · `Print Quantity` (select: 100 / 250 /
500 / 1000 / 2500 / Custom) · `Print Size` (select: Standard Letter / Tabloid /
Business Card / Door Hanger / Yard Sign / Custom) · `Print Finish` (select: Standard
Gloss / Standard Matte / Premium Cardstock / Eco-Friendly / Not Sure - Recommend One)
· `Co-branding Partner` (text) · `Key Message / CTA` (paragraph).

Create the field, then add a matching `JIRA_FIELD_*` line to `.env.local` — no code
change is needed, because `fieldMap.js` reads every target from the environment.

---

## 5. Open questions for the marketing desk

1. **Does an automation derive priority from Urgency × Impact?** If yes, the UMC form
   should collect Urgency and Impact and stop sending `rush` as a priority signal.
2. **Should `rush` become a 4-option Urgency select?** `MKT – Urgency`
   (Critical/High/Medium/Low) is richer than a checkbox and already exists.
3. **What is the real option set for `customfield_10297`?** Until it is known,
   `branch` stays free text in the description.
4. **What should `complianceApproved` actually drive?** If the answer is "co-branded
   work must still be reviewed", then the correct mapping is the opposite of the
   obvious one, and it should probably be a separate field.

---

## 6. After the request type exists

1. Re-run `npm run jira:discover -- --service-desk 68 --request-type <new id>`.
2. Confirm in the output: portal visibility `VISIBLE`, attachments `YES`,
   `can raise on behalf of` as expected, and that **no field is REQUIRED that the UMC
   form does not collect**.
3. Record the request type ID and the Marketing Request Category field ID + option IDs
   in `.env.local`, and the non-secret ones in `.env.example` and
   [`jira-mcp-discovery.md`](jira-mcp-discovery.md).
4. Only then run the smoke test, against Preview first.
