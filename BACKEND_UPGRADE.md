# Backend calling queue, roles and campaigns

These changes extend the existing Express/Mongoose application. Existing customers, leads, calls, activities, user passwords and demo endpoints remain. No migration has been run against the company's configured database as part of automated testing.

## Roles and data boundaries

- Admin: company-wide management.
- Supervisor: supervisedAgentIds identifies the permitted agent team; assignedCampaignIds and Campaign.supervisorIds identify permitted campaigns. Calls, reports, monitoring and customers are filtered server-side. A supervisor may assign an accessible campaign contact only to their supervised agents. A supervisor cannot create accounts, import company-wide contacts or reset passwords.
- Agent: their assigned contacts and own telephone/call-result records. A campaign member may atomically claim an unassigned contact within an explicitly selected campaign. This creates one durable assignment; another agent cannot receive it concurrently.

Supervisor team changes increment tokenVersion and disconnect old sessions. New sign-in is required after permissions change. Password resets also revoke sessions. Deleting users is a soft removal; active-call/lead checks preserve customer access and history.

## APIs

All URLs below begin with /api and require a Bearer token.

| Method | URL | Purpose |
|---|---|---|
| GET | /campaigns | Accessible campaigns with contact/call counts; normal pagination |
| POST | /campaigns | Admin creates name, description, serviceType, agentIds, supervisorIds |
| PUT | /campaigns/:id | Accessible manager updates fields/status; supervisor membership edits preserve agents outside their team |
| POST | /campaigns/:id/assign | Set campaign agentIds; supervisor may only change their own team's membership |
| GET | /campaigns/:id/queue | Numbered accessible campaign contacts, including eligible unclaimed contacts |
| POST | /leads/import | Admin CSV/xlsxBase64 import; preview:true validates without writes |
| POST | /leads/bulk-assign | leadIds, agentId, optional campaignId; per-row result, locked-number protection |
| POST | /leads/bulk-update | Admin leadIds and values (source, priority, status, campaignId); per-row outcomes |
| PATCH | /leads/:id/assign | Assign within permitted scope; preserves customer activities/history |
| GET | /follow-ups?scope=today, upcoming, or overdue | Kathmandu callback views; scope values are separate requests |
| GET | /power/session | Session, reservation, progress, numbered queue and callDelaySeconds |
| POST | /power/start | sessionId UUID and optional campaignId; explicit calling session |
| POST | /power/next | sessionId and requestId UUID; reserve next eligible assigned/unclaimed campaign contact |
| POST | /power/reserve | requestId and leadId or phone/customerName; one-off business call reservation |
| POST | /power/attempt | reservationId and attemptId UUID; dialAuthorized true only on the first atomic transition |
| POST | /power/control | sessionId and action pause, resume, stop or skip |
| POST | /power/heartbeat | sessionId and optional reservationId; extends only an unexpired unused lease |
| POST | /power/attempt-failed | reservationId and attemptId; requires a reported outcome before safe release |
| GET | /power/reservations | Admin active locks or supervisor team's locks |
| POST | /power/review-release | Admin reservationId, confirmPhoneIdle:true and reason; audited abandoned-attempt reconciliation |
| POST | /device/calls | Android event snapshots; device identity/sequence deduplication |
| POST | /call-results | Durable business outcome; reportId UUID and optional sessionId/reservationId/attemptId |
| PUT | /users/:id/team | Admin assigns supervisor agentIds/campaignIds; revokes prior permissions/session |
| PATCH | /users/:id/password | Admin resets agent/supervisor password, minimum12/maximum72 characters; token revocation |
| GET | /audit-logs | Company admin or scoped supervisor activity records |

The power session response is:
session {sessionId,campaignId,status,mode,startedAt,lastHeartbeatAt},
reservation {_id,sessionId,leadId,phone,customerName,state,attemptId},
progress {called,remaining,interested,followUps},
queue [{position,leadId,phone,customerName,status,attempts,callbackAt}],
queueTotal, callDelaySeconds and timezone.

After-call result keys: new-lead, interested, not-interested, call-later, already-customer, wrong-number, no-answer, busy, unreachable, converted, do-not-call. The earlier follow-up key remains compatible. Call Later requires followUpAt. optOut or do-not-call blocks future company queues. Unknown opted-out numbers are retained as do-not-call customers even when the agent does not add a lead. Manual business choices never establish an answered telephone call or a duration.

## Atomic locking and retries

Phone numbers are normalized before validation and writes. Local Nepal mobile, +977, 977 and 00977 representations resolve to the same canonical phone. Nepal mobile and landline formats are validated; other countries require explicit international codes. Customer phone uniqueness is company-wide and independent of campaigns or uploaded files.

Partial unique MongoDB indexes enforce one active reservation per company/phone and one active business reservation per agent. An idempotent request index prevents a retry from silently advancing the queue. The attempt transition is atomic: repeated authorizations return dialAuthorized:false.

Unused reservations expire after two minutes. Heartbeats cannot revive an expired lease. Dialed attempts do not expire automatically because a disconnected phone could still be on a carrier call. They release after an idempotent outcome is synchronized, or after an administrator confirms handset idle and records an audited reason. Pause/Stop immediately prevents further authorization and releases only unused reservations. These controls do not hang up a current real telephone call.

Due callbacks take priority. Busy/No Answer/Unreachable use configurable retry delays and maximum attempts; future callbacks remain out of the queue. callDelaySeconds is enforced on the backend after the previous saved result. The client continues with an explicit foreground Call Next confirmation. There is no hidden background dialing.

Contact reassignment, archive/delete and phone edits acquire the same phone lock, preventing a queue reservation from racing a management edit. Claiming an unassigned campaign contact reserves its canonical phone first, then atomically assigns the lead to the winning campaign agent.

## Database additions and safe migration

New collections: campaigns, dialersessions, dialerreservations.
Existing models gain supervisor/team fields, campaign references, service requirements, canonical opt-out fields, business outcomes, after-call sync identity, retry settings and native Android metadata. Existing activity records continue to serve customer history and audit logs.

From the server directory:

```powershell
npm ci
npm run migrate:check
# Back up MongoDB first, review the dry-run, then:
npm run migrate
npm test
```

The dry-run inventories existing collections, checks canonical phone collisions and reports required normalization. Collision detection aborts before any migration writes. The applied migration normalizes collision-free numbers, appends system lead statuses and creates additive indexes. It does not delete contacts or rewrite call history. Resolve canonical collisions manually with an audited customer-history merge before retrying.

## Verification

server/tests/power.test.js runs isolated MongoDB fixtures. It exercises ten concurrent logins, ten agents racing for one canonical phone (one winner), ten replayed attempt authorizations (one dialing authorization), expired leases, protected abandoned attempts, DNC persistence, Excel preview/import duplicates, guarded bulk ownership, supervisor isolation, and ten agents claiming distinct contacts from a shared campaign pool. It also verifies configured next-call delay enforcement.

These are database/API concurrency simulations. They do not verify SIM calls, recordings or carrier audio. Android calling still requires the separately built native app and a supported physical phone/default-dialer permission setup.

