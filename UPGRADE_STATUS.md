# Royal Cleaning Services ? CallTrack upgrade audit

Updated 29 October 2026 (Asia/Kathmandu). Existing CRM records have been retained.

The owner subsequently deferred production hosting and requested local Android preview APKs for USB transfer. See [LOCAL_DEMO.md](LOCAL_DEMO.md). No further SSH access is needed for this local scope. Company production signing and cPanel preparation remain available for a later deployment.

## Customer creation fixed

Agents now have **Add customer** on their primary Leads page. The shared contact form creates a customer and lead, opens its details and refreshes the list. The server assigns it to the signed-in agent regardless of any supplied assignment ID. Company-wide normalized phone duplicates return a clear conflict without disclosing another agent's customer. Administrators retain **Allow agents to add customers**; live changes refresh client permissions.

The existing company's preference was enabled at the user's request. Previous values are backed up privately at D:\CompanySecrets\RoyalCleaning\customer-permission-before-20261029.json. New workspaces allow this by default. Supervisors cannot create customers by impersonating agents.

Files: mobile/screens/AgentWorkflowScreens.js, LeadScreens.js, context/AuthContext.js, server/routes/crmRoutes.js, models/index.js, scripts/enable-agent-customers.js and tests/workflows.test.js.

## Other gaps fixed during verification

- Added actual existing-file audio attachment, encrypted storage and authorized playback/download flows where the previous recording route returned 404.
- Corrected the audio player's initial empty-source state, which exposed Play before loading an authorized file; the browser now verifies actual playback and byte-exact download.
- Added real upload progress and a separate processing state to CSV/XLSX import.
- Included the public API target in Metro's cache version after detecting that an environment-only target change reused a production bundle. The local export now verifies its embedded LAN address.
- Corrected Windows generated-directory exclusions for both slash forms and pinned standalone workspace discovery.
- Added a native-build namespace check and targeted autolinking-cache invalidation after the generated entry point retained the Expo template's `com.helloworld` package. Windows builds use two Gradle workers to limit memory pressure; matching API bundles can be retained during retries.
- Added private logical backups and cPanel cron maintenance tooling. Production execution is deferred; the local database migration was backed up and verified.

## Feature classifications

IMPLEMENTED identifies an exercised automated contract; physical-device and production acceptance are separate.

| Feature | Status | Evidence / boundary |
|---|---|---|
| Login, revocation, tenant isolation | IMPLEMENTED | Auth routes/middleware; native SecureStore/browser session storage; offline cached profile requires unexpired token. Auth/ownership tests. |
| Admin, supervisor and agent scopes | IMPLEMENTED | Company, self and assigned-team checks enforced server-side. User, campaign, report and recording authorization tests. |
| API and Socket.IO CORS | IMPLEMENTED | Shared explicit production origins and local LAN development policy. Preflight and polling tests. |
| Agent customer creation | IMPLEMENTED | Primary-page button, company toggle, self-assignment and duplicate regression assertions. Final suite result below. |
| Leads, contacts, notes, statuses, history | IMPLEMENTED | Shared forms, scoped APIs, soft deletion preserving call history. |
| Campaigns and bulk assignment | IMPLEMENTED | Campaign eligibility, ownership checks and atomic unassigned-pool claims. |
| CSV/XLSX imports | IMPLEMENTED | Preview, row results, aliases, format/size limits and duplicate validation tested. Actual upload percentage, server-processing state and row results are exposed. |
| Sequential power queue and number locks | IMPLEMENTED | Unique active company/number reservation, retry delay, heartbeat, recovery and audited stale-attempt release. Ten-agent concurrency/callback-race tests. |
| Android default dialer/outgoing calls | PARTIAL | Kotlin Telecom implementation and earlier compilation passed. Fresh APK and physical handset results are separate below. No real call placed here. |
| Incoming/ongoing controls, SIM choice, DTMF | PARTIAL | InCallService, native controls, notifications and SIM selection implemented. Actual OEM/carrier/handset verification deferred by user. |
| Call timing, ringing and disconnect cause | PARTIAL | Native sequence/idempotency and actual connection evidence validated in backend tests. Physical event availability remains device-dependent; unavailable remote ringing is not invented. |
| After-call outcomes and offline retry | IMPLEMENTED | Durable owner-scoped queue, Android background events, recovery, notes, DNC, callback and save/pause/next. Business results remain separate from telephone state. |
| Personal device history import | PARTIAL | Local history stays local until explicit Save as business call. Native permission/import verification needs a handset. |
| Callbacks and Kathmandu dates | IMPLEMENTED | Due/overdue/upcoming filters, rescheduling, callback uniqueness and strict dates/timezone. |
| Reports, performance and exports | IMPLEMENTED | Observed Android totals separate from manual reports; scoped filters, conversion metrics, CSV/XLSX and persisted daily summaries tested. |
| Daily email delivery | REQUIRES EXTERNAL SERVICE | SMTP transport and idempotent jobs implemented/tested with test transport. Actual account/inbox unverified; cPanel cron supplied. |
| Existing audio file attachments | IMPLEMENTED | Consent, private staging, retries, real media validation, AES-256-GCM storage, authorized playback/download/audit/retention. Five backend tests use a real OS audio fixture in isolated DB. Browser playback result below. |
| Automatic two-sided cellular recording | PLATFORM LIMITED | Default-phone permission provides no universal SIM audio stream. Requires supported OEM/provider adapter; no microphone-only recording is misrepresented. |
| Live supervisor audio/browser softphone | REQUIRES EXTERNAL SERVICE | Live business metadata exists. Authorized PBX/carrier media bridge and actual endpoints still required. No fake live stream. |
| WhatsApp/SMS | PARTIAL | Explicit external composer and audited request implemented. No delivery claim; automated delivery requires provider configuration. |
| Minimal UI, Inter, light/dark/system, sidebar | IMPLEMENTED | Shared themed components, five primary sections per role, secondary screens and retained desktop sidebar. Fresh browser acceptance below. |
| Private Android distribution | PARTIAL | Build, signing, APK verification and authenticated update routes implemented. Fresh artifact results below. No Play publication. |
| iOS | PLATFORM LIMITED | Shared CRM can export; Android Telecom does not run on iOS. Signed IPA requires Apple signing/macOS tooling. |
| cPanel production hosting | PARTIAL | Passenger entry point, same-origin web/API, package script and runbook supplied. Remote install requires SSH access; domain alone is insufficient. |

## Source and API map

- Native: mobile/modules/calltrack-telecom/android, mobile/plugins/withCallTrackTelecom.js and services/telecom.js.
- Client state: DialerContext.js, PowerDialerContext.js, RecordingContext.js, AuthContext.js and services/localStore.js.
- UI: navigation/RootNavigator.js; screens/AgentWorkflowScreens.js, AdminWorkspaceScreens.js, LeadScreens.js, CampaignScreens.js, RecordingScreens.js, AgentScreens.js.
- Queue/events: server/services/powerDialer.js, deviceCalls.js; models/power.js; routes/powerRoutes.js and dialerRoutes.js.
- Reports: services/performance.js, dailyReports.js, jobs.js and routes/operationsRoutes.js.
- Audio: routes/recordingRoutes.js and metadata in models/index.js.
- Hosting: deployment/cpanel/README.md, app.js, package-release.cjs; existing Docker/Caddy alternatives retained.

Existing /api/auth, /users, /leads, /customers, /follow-ups, /calls, /settings and /notifications remain. Extended groups include /campaigns, /power, /device, /call-results, /operations, /reports, /communications/compose, /recordings and authenticated /app-updates. Exact schemas are in server/routes and BACKEND_UPGRADE.md.

Recording APIs: GET/PUT /recordings/config; GET /recordings; POST /recordings/attachments; GET /recordings/:id/media; DELETE /recordings/:id. An attachment never changes answered state or telephone duration.

## Data, migration and private configuration

Additive collections support campaigns, reservations, sessions, daily reports and operations. Calls retain source, device IDs, observed timestamps/cause and separate business outcomes. Recording encryption material is excluded from ordinary JSON.

A private canonical-EJSON logical backup completed before migration: 13 collections, 104 documents, at D:\CompanySecrets\RoyalCleaning\database-before-upgrade-20261029. The final migration inspected five current customers with zero canonical collisions and zero normalization changes. It appended system statuses, backfilled missing soft-delete markers and checked indexes. Post-migration comparison verified all 104 original documents remain and zero business fields changed beyond the allowed additive migration fields. Future upgrades still require a fresh backup; do not automatically merge historical customers.

Private signing key: D:\CompanySecrets\RoyalCleaning\calltrack-release.jks, with adjacent private signing.env. Recording configuration: private recording-storage.env; encrypted files are outside the web root. Secrets are excluded from deployment archives. Back up keys and data securely. Recording attachments remain disabled until an administrator enables them.

## Verification log

- Final mobile source syntax/bindings: passed, including the player load/account-switch guards and import upload-progress changes.
- Mobile call-association tests: 5/5 passed.
- Expo dependency compatibility passed, including expo-audio.
- Final complete backend suite: **55/55 passed**. Includes agent self-assignment even with a forged target ID, normalized duplicate rejection, company toggle enforcement, ten-agent number/campaign races, role scopes, reports and recordings. Isolated Mongo startup allowance increased to 120 seconds for the slow Windows host; test assertions were retained.
- Latest targeted Android event tests: 9/9 passed before customer change.
- Recording tests: 5/5 passed, covering real encrypted audio, byte-exact retrieval, scopes, consent/type rejection, retry, hash conflicts, report availability and retention.
- Static web/SPA routes: 2/2 passed.
- **37 browser checks passed** in total: 13 primary/offline/customer/dark-mode/keypad checks; 13 management/secondary-page/CSV preview-import/responsive checks; six actual-file upload/offline-reload/playback/download/responsive checks; five live-permission/customer/supervisor checks. Latest management, permissions and audio checks ran against the production web export with the isolated test API. Audio download matched the actual OS fixture byte-for-byte; playback was muted during automation. No page exceptions or raw-text rendering errors in the production checks. Actual company records were never used as browser-test fixtures.
- No physical SIM call, actual SMTP delivery, WhatsApp/SMS send, signed IPA or remote deployment verified.

- Final production web export: passed, 802 modules, including Inter, customer creation, file playback guard and import progress. Bundle: mobile/dist-production/_expo/static/js/web/index-1eb6a8afdc0e7aebfef8c3e4de6618de.js.
- iOS Hermes JavaScript export: passed, 1,019 modules, mobile/dist-ios-check. This is not a signed IPA or physical iOS test.
- The standalone Metro configuration now ignores unrelated drive-root workspace discovery and generated native/build directories.
- Local API on port 5000 reports ready/database connected. The static local web preview on port 8081 passed login-screen, light/dark appearance and mobile-layout checks with no page or asset errors. Its compiled bundle was verified to target the computer's LAN API.

Fresh local Android APK results will be appended after the running native builds finish. Production APKs and the private deployment archive are deferred by the owner's subsequent local-demo instruction.

## External requirements

1. Authorized Android real-call/device testing deferred by user; no phone/test number supplied.
2. cPanel SSH hostname/user/port/key-file or authenticated terminal, Node/WebSocket support and existing document-root backup needed to deploy erp.royalcleaning.com.np.
3. Actual SMTP and optional approved messaging/PBX/OEM integrations remain company configuration. No paid resources purchased.

See ANDROID_SETUP.md, TELEPHONY.md and deployment/cpanel/README.md for physical/external acceptance. A signed build or existing route alone does not establish production readiness.

## Header refresh — 30 October 2026

The top navigation now uses a shared theme-aware header across desktop, mobile tabs and detail pages. Desktop provides a Light / Dark / System segmented control; mobile and login provide an appearance sheet with theme previews. Updated branding, compact notification/profile actions, saved device preference, safe-area spacing and improved light-mode secondary text contrast are included. No native dependency or plugin changes were required.

Final mobile source syntax/bindings passed. The refreshed LAN web export passed (803 modules), with its actual API target verified. Nine focused browser checks passed using mocked UI data: desktop light/dark, reload persistence, live system appearance changes, 1024/768/390/320px layouts, and notification/back navigation. No page exceptions. Screenshots and results are under `.history/header-refresh-20261030/`. The local web preview is running on port 8081 and the backend health endpoint reports ready on `192.168.1.65:5000`.

Fresh preview APK compilation is still running; do not use older APKs as evidence for this header update. Production hosting remains deferred.
