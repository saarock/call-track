# Android builds and device verification

CallTrack upgrades this repository. The two APK variants use the same backend:
- `com.calltrack.dialer`: agent application and optional Android default phone.
- `com.calltrack.crm`: admin/supervisor CRM; its manifest does not request call-log, phone-call or default-phone access.

The project requires Node 22.13+ (Node 24 recommended), Java 17, Android SDK platform 36/build-tools 36, NDK 27.1.12297006 and CMake 3.22.1. Minimum Android version is 8.0 (API26). The build installs JavaScript and fonts inside the APK; the release APK does not need Expo Go or a running Metro server.

## Local development

From the repository root:

```powershell
cd server
npm ci
npm run dev
```

In a second terminal:

```powershell
cd mobile
npm ci
$env:EXPO_PUBLIC_API_URL='http://YOUR-COMPUTER-LAN-IP:5000/api'
npm run android:agent
# Or: npm run android:admin
```

Use the actual API port in server/.env. A physical phone cannot use your computer's localhost. Phone and computer must be reachable on the same private network for a LAN preview. Production builds require HTTPS. Never put a database URI, JWT secret, mail password or signing password in EXPO_PUBLIC_* variables.

## Self-contained preview APKs

```powershell
cd mobile
$env:ANDROID_HOME='D:\CallTrackBuild\android-sdk'
$env:GRADLE_USER_HOME='D:\CallTrackBuild\gradle'
$env:TEMP='D:\CallTrackBuild\temp'
$env:TMP=$env:TEMP
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot'
node scripts/build-private-android.cjs --api-url http://YOUR-LAN-IP:5000/api --architectures arm64-v8a
```

Adjust SDK and Java locations on another machine. The example D: folders also keep native CMake paths short on Windows. Omit --architectures for ARM64 and ARM32. Outputs are in mobile/builds/preview or mobile/builds/production, each with release.json and SHA-256 checksums. The build verifies signatures, package/version, embedded JavaScript/fonts, agent-only phone permissions and absence of microphone recording permission. Recheck with node scripts/verify-private-apks.cjs builds/preview from mobile/. Preview APKs use a development signing certificate for private testing.

Install only on an authorized test device:

```powershell
adb devices -l
adb install -r builds/preview/CallTrack-Dialer-preview.apk
adb install -r builds/preview/CallTrack-CRM-preview.apk
```

An installation signed with a different key cannot update an existing package. Do not uninstall an installation with unsynchronized results: uninstalling clears private app data.

## Company production signing

Keep one private signing key for future updates. Generate it outside the repository, using Java keytool's interactive password prompts:

```powershell
keytool -genkeypair -v -keystore D:\CompanySecrets\calltrack-release.jks -alias calltrack -keyalg RSA -keysize 3072 -validity 10000
```

Set these in a private CI secret store or current process environment, never in source control:
- CALLTRACK_KEYSTORE: absolute keystore path.
- CALLTRACK_STORE_PASSWORD.
- CALLTRACK_KEY_ALIAS.
- CALLTRACK_KEY_PASSWORD.

Then build:

```powershell
node scripts/build-private-android.cjs --production --api-url https://crm.YOUR-COMPANY-DOMAIN/api
```

The script refuses production mode without all signing settings and a reachable-format HTTPS API URL. It does not create a company key or publish to Google Play. Back up the signing key/passwords securely; losing the key prevents ordinary APK updates.

## Phone setup

1. Install the agent Dialer APK, sign in as an agent, and open Profile.
2. Tap Set up phone permissions and explicitly choose CallTrack as the default Phone application.
3. Return and tap setup again to authorize Phone, Phone state, Recent call history and Notifications.
4. On Android versions that separately restrict full-screen incoming-call notifications, allow that capability in system app settings if needed.
5. Verify that the expected SIM/eSIM is active. When multiple SIM accounts exist, select the SIM for each new call.

The public keypad remains usable for phone intents without a CRM login. Emergency numbers go through Android Telecom rather than a CRM queue; do not use emergency numbers for testing. Business calling queues require an authenticated online reservation. Saved results and captured events can synchronize later. CallTrack does not start hidden background SIM calls.

## Required physical-device checks

No real call or recording test has been performed in this workspace: the user will test calls later. Automated snapshots and compilation are not evidence of carrier behavior.

Use a normal test number whose owner has authorized the call. Record phone model, Android version, SIM/carrier, app version, and each result:
- Outgoing answered, unanswered, busy, rejected, canceled and network failure.
- Incoming answered, missed and declined, with app foreground, background and screen locked.
- Dual-SIM selection and no-SIM behavior.
- Actual caller number/name, state transitions and duration after Android supplies connection timestamps.
- Mute, earpiece/speaker, hold/resume, DTMF keypad, second call/call waiting.
- End call, return to after-call result, required outcome/notes, callback date and customer history.
- Pause/stop during the SIM-selection dialog: no later dial after cancellation.
- Network loss after reservation and call: result persists, no new number starts until previous result synchronizes.
- Process restart/reopen and login/logout across different agent accounts.
- Denied permissions, removed default-phone role, notification restrictions and battery restrictions.
- Same-key APK update retains account and unsynchronized results.
- Another agent cannot claim a reserved number.

Only Android-observed call state and supplied/observed connection timestamps are labeled as device evidence. Server receipt does not independently attest handset integrity. Missing duration remains unavailable. Business outcomes are agent reports and cannot manufacture an answered call.

## Recording and live listening

There is no general public two-sided SIM audio source for ordinary installed apps. Android's VOICE_CALL capture requires a system-reserved permission; default-phone access does not grant it. This repository therefore does not record the microphone and label it a two-sided call, create fake audio, or expose a nonworking record/listen button. A vendor-specific enterprise agreement may provide a supported recorder, but it needs a documented SDK, tested device/version, consent and upload contract before integration.

See [Android Telecom phone requirements](https://developer.android.com/develop/connectivity/telecom/dialer-app) and [Android audio-source restrictions](https://developer.android.com/reference/android/media/MediaRecorder.AudioSource#VOICE_CALL). Private APK distribution does not remove OS restrictions.

For provider/PBX recordings and live listening, see TELEPHONY.md. iOS CRM screens remain compatible; Apple's ordinary cellular calling does not expose Android's default-phone/InCallService integration. iOS cellular calls require the system phone flow and manually reported outcomes; a separate authorized VoIP service is required for integrated audio/monitoring.

