# CallTrack — Royal Cleaning Services, Nepal

The existing React Native/Expo, Express, MongoDB and Socket.IO application now has two Android variants and a responsive browser CRM. The same backend serves both.

- Agent: Leads, Recents, Dialer, Follow-ups, Profile.
- Admin/supervisor: Dashboard, Leads, Agents, Calls, Settings, with campaign, report, callback and audit views.
- Inter typography, light/dark/system appearance, compact cards/lists, dropdown filters and a minimal login.

## Run locally

Use Node22.13+ and the existing lockfiles.

```powershell
cd server
npm ci
# Configure the existing private .env; this workstation uses PORT=5000.
npm run check:db
npm run dev
```

In another terminal:

```powershell
cd mobile
npm ci
# Browser: EXPO_PUBLIC_API_URL=http://localhost:5000/api
npm run web
```

The browser uses port8081. A physical phone needs a reachable LAN address or HTTPS API, not localhost. Full Android Telecom integration requires the compiled Dialer APK; Expo Go does not include this native module. Existing authentication and company data are retained. Only use npm run seed for a new empty installation.

## Calling workflow

Import/preview CSV or Excel, assign contacts or a campaign, then select the campaign in Dialer and press Start Calling. The server atomically reserves one normalized phone number. Call Next initiates the supported Android SIM flow after explicit user action. Pause/stop prevent further attempts; a dialed number remains protected until its outcome is saved or an administrator performs an audited idle-handset review.

Android default-phone callbacks provide available actual call states/timestamps/duration. Outcomes and notes remain agent reports. Manual/iOS results never establish an answered call or a measured duration. Saved results and device events synchronize with stable identities. Business queues require an online server reservation; saved after-call results can wait offline.

## Checks

```powershell
cd server
npm test
npm run migrate:check
cd ../mobile
npm run lint
npm test
npm run check
```

Backend tests use isolated MongoMemoryServer databases, including10-agent races, scoped access, imports, callbacks, synchronization, reporting and exports. They do not place carrier calls.

## Android and private hosting

- [Android build/setup and phone checklist](ANDROID_SETUP.md)
- [cPanel + SSH deployment](deployment/cpanel/README.md)
- [Optional Docker/VPS deployment](deployment/README.md)
- [Backend APIs, roles, reservations and additive migrations](BACKEND_UPGRADE.md)
- [Telephony and optional PBX limitations](TELEPHONY.md)
- [Implementation status and validation](UPGRADE_STATUS.md)

Current scope: a local demo with Android preview APKs transferred by USB. See [LOCAL_DEMO.md](LOCAL_DEMO.md). Production deployment is deferred by the owner. The future target remains https://erp.royalcleaning.com.np on cPanel with SSH.

The private Android signing key is stored outside the repository at D:\CompanySecrets\RoyalCleaning\calltrack-release.jks, with its local signing environment in that same private directory. Preserve both securely for future app updates. No passwords, database URI or signing key are included in APK/web artifacts.

Current preview APKs use the local LAN API; company-signed private builds target the production domain. See mobile/builds/preview and mobile/builds/production after a successful final build. These are private company artifacts; nothing is published to Google Play.

## External requirements

Physical-device verification is still required for SIM selection, incoming/locked-screen calls, carrier timestamps, speaker/hold/DTMF and OEM behavior. The user elected to test real calls later.

Authorized existing audio files can be explicitly attached, encrypted in private storage, played and downloaded under call/team permissions when an administrator enables attachments. Automatic two-sided SIM capture, supervisor audio listening and browser telephony require a supported OEM/PBX/carrier integration. SMTP and authorized messaging providers require real configuration; tests do not claim actual delivery.

Migrations are additive and include a collision audit. Back up the existing database before applying them. The configured database was inspected with migrate:check; no destructive migration or test seeding was performed there.

