# Complete source file map

The current upgrade file map and verification status are in [UPGRADE_STATUS.md](UPGRADE_STATUS.md). The original inventory below is retained for historical reference; the current application also includes Android Telecom, power queues, campaign/report operations, and encrypted audio attachments.

Paths are relative to the extracted `CallTrack-CRM/` directory. All listed source files contain implementation code, not pseudocode. Native directories are generated through Expo prebuild.

```text
CallTrack-CRM/
  .gitignore
  FILE-MAP.md
  PLAN.md
  README.md
  VALIDATION.md
  mobile/.env.example
  mobile/App.js
  mobile/app.config.js
  mobile/app.json
  mobile/assets/.gitkeep
  mobile/components/AgentFilter.js
  mobile/components/Card.js
  mobile/components/Screen.js
  mobile/components/UI.js
  mobile/context/AuthContext.js
  mobile/hooks/useData.js
  mobile/index.js
  mobile/navigation/RootNavigator.js
  mobile/package-lock.json
  mobile/package.json
  mobile/screens/AgentScreens.js
  mobile/screens/CallScreens.js
  mobile/screens/CustomerScreens.js
  mobile/screens/DashboardScreen.js
  mobile/screens/FollowUpScreens.js
  mobile/screens/LeadScreens.js
  mobile/screens/LoginScreen.js
  mobile/screens/MonitorScreen.js
  mobile/screens/ReportScreen.js
  mobile/screens/SettingsScreen.js
  mobile/services/api.js
  mobile/services/sessionStore.js
  mobile/services/phone.js
  mobile/utils/theme.js
  sample-leads.csv
  server/.env.example
  server/app.js
  server/config/cors.js
  server/config/database.js
  server/config/env.js
  server/controllers/healthController.js
  server/index.js
  server/middleware/auth.js
  server/middleware/errors.js
  server/models/index.js
  server/package-lock.json
  server/package.json
  server/routes/authRoutes.js
  server/routes/callRoutes.js
  server/routes/crmRoutes.js
  server/routes/healthRoutes.js
  server/routes/reportRoutes.js
  server/routes/userRoutes.js
  server/scripts/checkDatabase.js
  server/scripts/seed.js
  server/services/callState.js
  server/services/events.js
  server/services/jobs.js
  server/sockets/live.js
  server/tests/cors.test.js
  server/tests/database.integration.js
  server/tests/health.test.js
  server/tests/workflows.test.js
  server/utils/http.js
```

| Folder | Responsibility |
| --- | --- |
| mobile/screens | Role workspaces and detail/action screens |
| mobile/components | Shared forms, states, charts, timers, cards and agent selector |
| mobile/navigation | Authenticated native stack and role tabs |
| mobile/context | Secure sessions and real-time CRM refresh |
| mobile/services | Axios and normal phone dialer linking |
| mobile/hooks | Focus-aware loading with stale-response protection |
| mobile/utils | Visual theme |
| mobile/assets | Reserved local visual assets |
| server/config | Environment validation and database connection lifecycle |
| server/models | Nine Mongoose schemas and database indexes |
| server/controllers | Health response |
| server/routes | Validated, authorized CRM and manual call-report routes |
| server/middleware | JWT/current-user checks, role gate and safe errors |
| server/services | Audits, demo transition rules and follow-up reminders |
| server/sockets | Authenticated presence and authorized snapshots |
| server/utils | Validation, tenant scopes, pagination and date filters |
| server/scripts | Admin bootstrap and database check |
| server/tests | Isolated real-database workflows and focused security/state checks |
