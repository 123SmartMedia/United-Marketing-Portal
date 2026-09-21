# Jira MCP discovery record — Marketing Requests (MKT)

**Method:** read-only Atlassian MCP connector, 2026-09-21. No issue was created,
updated, transitioned, commented on or deleted. No project, field, request type,
workflow, form, queue, automation or permission was modified.

**Scope limit — read this first.** The MCP connector exposes a 299-operation
Atlassian catalog that contains **no `/rest/servicedeskapi/` operations**. Repeated
`discover` queries for service desks, request types, portals, queues, SLAs, approvals
and forms returned only Jira-platform operations (`listJiraProjects`,
`listJiraProjectIssueTypesMetadata`, `getJiraIssueTypeMetaWithFields`,
`listJiraStatuses`, JQL search). Everything below is therefore split into what MCP
positively verified, and what still needs the production service account plus
`npm run jira:discover`.

---

## 1. Verified through MCP

### Site and project

| Fact | Value | Source |
| --- | --- | --- |
| Cloud ID | `638ffe69-6618-4145-b60c-144cfb581ff6` | `getAccessibleAtlassianResources` |
| Site URL | `https://unitedmortgage.atlassian.net` | `getAccessibleAtlassianResources` |
| Project name | Marketing Requests | `listJiraProjects` |
| Project key | `MKT` | `listJiraProjects` |
| Project ID | `10100` | `listJiraProjects`, createmeta `project.allowedValues` |
| Project type | `service_desk` (classic / company-managed) | `listJiraProjects` |
| Project lead | Michael Cabales | `listJiraProjects` |

### Service desk and portal

| Fact | Value | Source |
| --- | --- | --- |
| **Service desk ID** | **`68`** | `Request Type` (`customfield_10010`) payload on MKT-10, MKT-3, MKT-2 |
| **Portal ID** | **`68`** | same payload |

> The long-standing note in `jira-integration.md` §5 — "the 68 in the portal URL is
> the portal ID and is usually not the serviceDeskId" — is correct as general advice
> but **false for this instance**. Jira reports `serviceDeskId: "68"` and
> `portalId: "68"` on every MKT request. `JIRA_SERVICE_DESK_ID=68` is verified.

### Issue types in MKT

| Issue type ID | Name | Subtask |
| --- | --- | --- |
| `10078` | Submit a request or incident | no |
| `10079` | Ask a question | no |
| `10080` | Emailed request | no |
| `10044` | Task | no |
| `10045` | Sub-task | yes |

### Customer request types — PARTIAL

Only request types that appear on an existing MKT issue are visible, because the
request type list itself is a `servicedeskapi` read. Three of an unknown total:

| Request type ID | Name | Issue type ID | Portal group IDs |
| --- | --- | --- | --- |
| `114` | Ask a question | `10079` | *(none)* |
| `115` | MKT – Emailed Request | `10080` | *(none)* |
| `116` | Social Media Post / Graphic | `10078` | `["81"]` |

`116` carries `groupIds: ["81"]`, which proves at least one portal group exists and
therefore that **more request types than these three almost certainly exist**. None
of the six UMC request-type labels (Business Cards, Letterhead / Stationery,
Co-branded Flyer / Folder, Print Order, Digital Asset Creation, Custom / Other)
appeared on any existing issue.

**The request type intended for the UMC form is NOT determined.** Do not set
`JIRA_REQUEST_TYPE_ID` from this document.

What *is* determined: the UMC form's structured targets (`MKT – *`) exist **only on
issue type `10078`**. Createmeta for `10079` returns none of them. So the target
request type must be one whose `issueTypeId` is `10078`. Request type `115` (issue
type `10080`) is explicitly email-intake-only, and its own description warns that
adding any required field beyond Summary and Description silently breaks email
ticket creation — it must not be used by this integration.

### MKT custom fields on issue type 10078

From `getJiraIssueTypeMetaWithFields(projectIdOrKey=MKT, issueTypeId=10078, requiredFieldsOnly=false)`.
Every field below is `required: false` at the **Jira issue** level.

| Field ID | Name | Type | Option IDs → labels |
| --- | --- | --- | --- |
| `customfield_10297` | MKT – Branch / Team | option | `10152` Other / Not Listed **(only option returned — see note)** |
| `customfield_10298` | MKT – Requester Role | option | `10153` Loan Officer · `10154` Branch Manager · `10155` Sales Manager · `10156` Executive · `10157` Other |
| `customfield_10299` | MKT – Urgency | option | `10158` Critical · `10159` High · `10160` Medium · `10161` Low |
| `customfield_10300` | MKT – Impact | option | `10162` Company-wide · `10163` Branch · `10164` Individual |
| `customfield_10301` | MKT – Requested Due Date | date | — |
| `customfield_10302` | MKT – Rush Justification | string | — |
| `customfield_10303` | MKT – Compliance Review Needed | option | `10165` Yes · `10166` No |
| `customfield_10304` | MKT – Deliverable Format | array of option (multi-select) | `10167` PNG · `10168` PDF · `10169` Print · `10170` Video · `10171` HTML · `10172` Other |

> **`customfield_10297` anomaly.** Createmeta returns exactly one allowed value
> (`10152` Other / Not Listed) for this project + issue type context, yet the field
> is named "Branch / Team". Both MKT-1 and MKT-10 carry that same single value. The
> MCP catalog has no field-context or field-options operation, so this cannot be
> resolved here. **Confirm the option set before mapping `branch` to it.**

### MKT fields present on issues but NOT on the 10078 create screen

These appeared with values on real issues but are absent from createmeta, so they are
post-create / automation-populated and cannot be assumed settable at creation time:

| Field ID | Name | Type | Verified option IDs |
| --- | --- | --- | --- |
| `customfield_10305` | MKT – Intake Channel | option | `10173` Portal · `10175` Email *(set not proven complete)* |
| `customfield_10306` | MKT – Work Started | datetime | — |
| `customfield_10307` | MKT – Delivered | datetime | — |
| `customfield_10308` | MKT – Revision Count | number | — |

### JSM platform fields on 10078

`customfield_10010` Request Type (`sd-customerrequesttype`) · `customfield_10002`
Organizations · `customfield_10039` Request participants · `customfield_10042`
Request language · `customfield_10040` Satisfaction · `customfield_10003` Approvers ·
`customfield_10046` Approver groups · `customfield_10001` Team.

### Standard fields

- **Required to create:** `project` and `summary` only. Everything else is optional
  at the Jira issue level.
- **`attachment` is present** on issue types `10078` and `10079` — attachments exist
  on the underlying issue type. *(Whether the portal request type exposes an
  attachment field is a JSM setting MCP cannot read — see §2.)*
- `description`, `duedate`, `priority`, `reporter`, `assignee`, `labels`,
  `issuelinks`, `parent`, `timetracking` all available.

### Priorities (MKT scheme)

`10000` MKT – P1 Rush · `10001` MKT – P2 High · `10002` MKT – P3 Standard ·
`10003` MKT – P4 Low.

### Workflow statuses for issue type 10078

`10126` MKT – Open (new) · `10127` MKT – Triaged (new) · `10125` To Do (new) ·
`10129` MKT – In Progress · `10131` MKT – Proof Sent · `10130` MKT – Compliance
Review · `10128` MKT – Waiting for Requester · `10038` Pending · `3` In Progress ·
`10132` MKT – Done (done) · `10133` MKT – Canceled (done) · `10053` Done (done).

A dedicated MKT workflow is in place; generic `To Do` / `In Progress` / `Done` are
also mapped to this issue type, so they are reachable and should not be treated as
unused.

### SLA

`customfield_10060` **Time to resolution**, SLA id `14`. Observed goal durations vary
by priority: 8h 30m (P1 Rush), 42h 30m (P3 Standard, email intake), 80h. It runs on a
working calendar (`withinCalendarHours: true`) and **pauses** on some statuses
(MKT-10 shows `paused: true` while in *MKT – Proof Sent*). The clock starts at issue
creation, so a request created by this integration is on the SLA immediately.

### Reporter observations

Existing MKT issues carry distinct human reporters (Mark Rosenbloom, Scott
Sferrazza), so the project does record per-request reporters. `Organizations` and
`Request participants` are empty on every issue.

---

## 2. NOT verifiable through MCP — needs the service account + `npm run jira:discover`

The MCP catalog has no `servicedeskapi` operations, so **none** of the following was
checked. Each is a REST discovery item.

| # | Item | Why MCP cannot answer | Where to look |
| --- | --- | --- | --- |
| 1 | Full customer request type list | no operation | `GET /rest/servicedeskapi/servicedesk/68/requesttype` |
| 2 | Which request type the UMC form should use | depends on #1 | — |
| 3 | `JIRA_REQUEST_TYPE_ID` | depends on #1 | — |
| 4 | Per-request-type field config — which fields the **portal** exposes and which the **request type** marks required | request-type field config is not Jira createmeta | `GET /rest/servicedeskapi/servicedesk/68/requesttype/{id}/field` |
| 5 | Whether the request type uses a **Jira Form** (ProForma) | no Forms operation; an issue-property probe on MKT-10 returned nothing | Forms API |
| 6 | Jira Form field IDs, choice IDs, conditional/branching fields | depends on #5 | Forms API |
| 7 | Whether **attachments are enabled on the request type** | portal setting, not issue-type metadata | `.../requesttype/{id}/field` |
| 8 | Whether the request type is **customer-portal visible** (vs. hidden / agent-only) | no operation; hidden types are simply omitted from the portal list | `GET /rest/servicedeskapi/servicedesk/68/requesttype` |
| 9 | `raiseOnBehalfOf` permission for the service account | no operation | `.../requesttype/{id}/field` → `canRaiseOnBehalfOf` |
| 10 | Whether a matching Jira **customer** exists for a submitter email | no operation | `GET /rest/servicedeskapi/servicedesk/68/customer` |
| 11 | Notification scheme / customer notification rules | no operation | admin UI |
| 12 | Automation rules (priority calculation, Intake Channel stamping) | no operation | admin UI |
| 13 | Queues | no operation | `GET /rest/servicedeskapi/servicedesk/68/queue` |
| 14 | Full SLA goal / calendar definitions | issue values only show observed goals | admin UI |
| 15 | Complete option set for `customfield_10297` and `customfield_10305` | no field-context/options operation | `GET /rest/api/3/field/{id}/context/{ctx}/option` |

MKT-10's description mentions "priority calculation", strongly implying an automation
rule derives `priority` from `MKT – Urgency` × `MKT – Impact`. **Unconfirmed** — if it
exists, the integration should send Urgency and Impact and let automation set
priority rather than setting `priority` directly.

---

## 3. UMC → Jira field mapping

**UMC form value** columns use the exact option labels from
`src/lib/requestSchema.js`. **Jira option ID** is filled only where MCP verified both
the field and the option.

Status legend — **MAPPED**: verified 1:1 target · **NO TARGET**: no suitable
structured Jira field exists · **NEEDS DECISION**: a near-match exists but semantics
differ · **BLOCKED**: target depends on a §2 item.

| UMC field | UMC form value | Jira field name | Jira field ID | Jira option ID | Req/Opt | Mapping status | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `projectTitle` | free text | Summary | `summary` | — | **Required** (Jira) | **MAPPED** | Already sent. No change. |
| *(all fields)* | — | Description | `description` | — | Optional | **MAPPED** | Already sent. Remains the safety net for every unmapped value. |
| `dateNeeded` | `YYYY-MM-DD` | MKT – Requested Due Date | `customfield_10301` | — (date) | Optional (Jira) | **MAPPED** | Set `JIRA_FIELD_DATE_NEEDED=customfield_10301`. Confirm the request type exposes it (§2 #4) before enabling in production. |
| `files` | up to 5 files, 10 MB total | Attachment | `attachment` | — | Optional | **BLOCKED** | Field exists on issue type `10078`. Confirm attachments are enabled on the request type (§2 #7), then keep `JIRA_ATTACHMENTS_ENABLED=true`. |
| `requestType` | Business Cards · Letterhead / Stationery · Co-branded Flyer / Folder · Print Order (Banner, Yard Sign, Door Hanger) · Digital Asset Creation · Custom / Other | *(none)* | — | — | — | **NO TARGET** | No MKT field holds the collateral type. Either (a) create an option field with these six options, or (b) map each UMC label to its own JSM **request type** ID once §2 #1 is known. `customfield_10010` is the request type itself, set by `requestTypeId` — never as a field value. |
| `rush` | boolean | MKT – Rush Justification / Priority | `customfield_10302` / `priority` | `10000` = MKT – P1 Rush | Optional | **NEEDS DECISION** | `rush` is a boolean; `10302` is free text and `priority` is a priority object. If the priority automation in §2 #12 exists, send `MKT – Urgency` and let it derive priority. UMC collects no rush justification text. |
| `name` | free text | *(none)* | — | — | — | **NO TARGET** | Stays in the description, or becomes the reporter via `raiseOnBehalfOf` (§2 #9). |
| `email` | free text | *(none)* | — | — | — | **NO TARGET** | Same as `name`. Jira's reporter / customer record is the structured home for this. |
| `phone` | free text | *(none)* | — | — | — | **NO TARGET** | Description only, or create a text field. |
| `nmls` | free text | *(none)* | — | — | — | **NO TARGET** | Description only. Compliance-relevant — worth a real "NMLS ID" text field. |
| `branch` | free text | MKT – Branch / Team | `customfield_10297` | `10152` Other / Not Listed *(only option returned)* | Optional | **NEEDS DECISION** | Type mismatch: UMC collects free text, Jira is a single-select whose context returned one option. Resolve the option set (§2 #15) first. Do **not** map yet — an unmatched label would be rejected. |
| `printingNeeded` | Yes · No | *(none)* | — | — | — | **NO TARGET** | Description only. Closest existing concept is `MKT – Deliverable Format` = `Print` (`10169`). |
| `quantity` | 100 · 250 · 500 · 1000 · 2500 · Custom | *(none)* | — | — | — | **NO TARGET** | Create a field, or accept description-only. |
| `size` | Standard Letter · Tabloid · Business Card · Door Hanger · Yard Sign · Custom | *(none)* | — | — | — | **NO TARGET** | Same. |
| `finish` | Standard Gloss · Standard Matte · Premium Cardstock · Eco-Friendly · Not Sure - Recommend One | *(none)* | — | — | — | **NO TARGET** | Same. |
| `cobrand` | Yes · No | *(none)* | — | — | — | **NO TARGET** | Same. |
| `partnerName` | free text | *(none)* | — | — | — | **NO TARGET** | Same. |
| `complianceApproved` | boolean | MKT – Compliance Review Needed | `customfield_10303` | `10165` Yes · `10166` No | Optional | **NEEDS DECISION** | **Semantics are inverted.** UMC asks the submitter to confirm compliance *has already approved* the co-branded material; Jira asks whether the request *needs* compliance review. Mapping `true → Yes` would route already-approved work into the review queue. Do not map without a decision from the marketing desk. |
| `keyMessage` | free text | *(none)* | — | — | — | **NO TARGET** | Description. A dedicated textarea field would be reasonable. |
| `additionalDetails` | free text | *(none)* | — | — | — | **NO TARGET** | Description. |
| `asset` * | free text | *(none)* | — | — | — | **NO TARGET** | Description. |
| `details` * | free text | *(none)* | — | — | — | **NO TARGET** | Description. |
| `company` | honeypot | — | — | — | — | **NEVER SENT** | Correct as-is. |

\* `asset` and `details` are only sent by the lightweight inline forms.

### Jira fields the UMC form does not collect

None is required at the Jira issue level, so none blocks creation *today* — but the
**request type** may mark some required (§2 #4), and that is exactly what produces a
400 on `POST /rest/servicedeskapi/request`.

| Jira field | Field ID | Why it matters |
| --- | --- | --- |
| MKT – Requester Role | `customfield_10298` | UMC collects NMLS and branch but not role. The options map cleanly to mortgage roles; worth adding a Step 1 select. |
| MKT – Urgency | `customfield_10299` | UMC only has a boolean `rush`. If priority automation exists (§2 #12), this is the field that drives it. Consider replacing `rush` with a four-option urgency select. |
| MKT – Impact | `customfield_10300` | Not collected at all. Likely the second automation input. |
| MKT – Deliverable Format | `customfield_10304` | Multi-select (PNG/PDF/Print/Video/HTML/Other). UMC's `size` / `finish` / `printingNeeded` partially overlap but do not map. |
| MKT – Rush Justification | `customfield_10302` | UMC's `rush` checkbox carries no justification text. |
| MKT – Intake Channel | `customfield_10305` | Should be `Portal` (`10173`) for UMC submissions — but the field is **not on the 10078 create screen**, so it is probably stamped by automation. Verify before attempting to set it. |

### Required fields Jira needs that UMC does not collect

**At the Jira issue level: none.** Only `project` and `summary` are required, and both
are always sent. Whether the *request type* adds required fields is §2 #4 and is the
single most likely cause of a first-submission 400.

---

## 4. What changed in the repo as a result

- `JIRA_CLOUD_ID` and `JIRA_SERVICE_DESK_ID=68` filled in `.env.example` — both
  verified, neither is a secret.
- The invented placeholder field IDs in `.env.example` were replaced with the real
  verified MKT inventory. The old placeholders were actively misleading: for example
  `JIRA_FIELD_SIZE=customfield_10060` names a field that on this instance is the
  **Time to resolution SLA**.
- `JIRA_REQUEST_TYPE_ID` deliberately left empty — see §1 and §2 #3.
- `tests/fieldMap.test.mjs` gained a regression test pinning the one verified mapping
  and guarding the near-miss fields against accidental mapping.
- No secret was entered. No smoke test was run. No Jira ticket was created.
