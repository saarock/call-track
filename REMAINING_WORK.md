# CallTrack handoff: remaining work

Saved 29 October 2026, 18:09 UTC. The user requested this report before the session ends. Do not restart the implementation or repeat completed tests without a reason.

## Completed and checked

- Agent **Add customer** is available on Leads, enabled for the existing company, self-assigns to the signed-in agent, rejects normalized duplicate phones and respects live administrator permission changes.
- Shared professional UI, Inter fonts, desktop sidebar, responsive layouts and light/dark/system themes.
- Local API/CORS fixes, role scopes, customer/campaign workflows, number locks, offline results, callbacks, reporting and exports.
- Existing audio-file attachment, private encrypted storage, authorized playback/download and retries. Automatic SIM audio capture is not universally available.
- Database backup and additive migration completed; all 104 original documents were retained with no unexpected business-field changes.
- 55/55 backend tests, 5/5 mobile call-association tests and 37 browser workflow checks passed. Mobile syntax and Expo dependency checks passed. Production web and iOS JavaScript exports passed; these are not production deployment or a signed IPA.
- Local static web preview passed login-screen, light/dark and mobile-layout checks with no page/asset errors.

Full evidence and limitations: [UPGRADE_STATUS.md](UPGRADE_STATUS.md).

## Immediate work left: finish the local APKs

**The fresh APKs are NOT ready or verified yet.** An Android preview build is running. Leave it running and inspect its log before starting another build.

- Running exec session: `16169`, launched by `.history/telecom-implementation/final-builds.cjs`.
- Log: `D:/CallTrackBuild/final-preview.log`.
- Status command from repository root: `node .history/telecom-implementation/build-status.cjs`.
- Latest state: native C++ tasks finished; Android resource/library tasks continuing. No failure in this retry. Autolinking correctly reports `com.calltrack.crm`.
- First attempt failed because generated React Native autolinking retained `com.helloworld`. The build script now checks the real namespace and invalidates mismatching generated autolinking data.
- Expo regenerated the native project during retry. The script now provides `--resume-native` for compile-only retries when native configuration/dependencies have not changed. Windows Gradle concurrency is limited to two workers.
- Current target: ARM64 Android 8+, local API `http://192.168.1.65:5000/api`, internal preview signing.
- Expected outputs: `mobile/builds/preview/CallTrack-Dialer-preview.apk`, `CallTrack-CRM-preview.apk`, `release.json`.
- Old APKs directly under `mobile/builds/` are stale. Do not present them as this upgrade.

After BOTH fresh outputs and their manifest exist:

1. Run `node .history/telecom-implementation/verify-local-preview.cjs` from the repository root. It checks checksums, signatures, packages, phone-permission separation, absence of microphone permission, bundled Inter, current customer/audio UI, embedded LAN API and native audio module.
2. Inspect `mobile/builds/preview/verification.json`. Fix any actual failure before claiming the files are ready.
3. Append the actual build/verification result to `UPGRADE_STATUS.md`, then give the user links to both APKs and [LOCAL_DEMO.md](LOCAL_DEMO.md).

Use `cmd.exe` with `login:false` for tool shell commands; PowerShell/WMI and `rg` startup have been unusually slow. Keep commands and waits short. Build SDK/Gradle/temp paths are under `D:/CallTrackBuild`; Java is Eclipse Adoptium JDK 17. The build wrapper already supplies these settings. No production build is requested now.

## User will test on the phone

The user will copy the APK through USB and install it manually. No physical call has been placed or verified here. Test default-phone setup, permissions, SIM selection, incoming/outgoing calls, controls, actual timing, saved results and offline synchronization on a handset. USB file transfer does not provide API networking: keep phone and computer on the same Wi-Fi for the current LAN APK.

## Deferred or dependent on outside configuration

- Production hosting at `erp.royalcleaning.com.np`, production APKs and deployment archive: explicitly deferred by the user. Do not ask for SSH access again for this local scope.
- Universal two-sided SIM recording/live supervisor audio: requires a supported OEM/carrier/PBX integration. Existing-file attachments are implemented; company attachments remain disabled until an administrator enables them.
- Actual SMTP delivery and automated messaging delivery require company/provider configuration; no real email/SMS/WhatsApp delivery verified.
- Signed iOS IPA requires Apple signing/macOS tooling. The JavaScript export alone is not an installable iOS app.

## Keep available

- Backend: `http://192.168.1.65:5000/api`, health endpoint `/health`; exec session `13501`, node PID `21224` when last checked.
- Web demo: `http://localhost:8081`, static `mobile/dist-local`; exec session `2138`.
- Restart instructions and USB steps: [LOCAL_DEMO.md](LOCAL_DEMO.md).
- Do not expose environment files, signing passwords, private keys or database records. Private company backups/configuration are outside the repository under `D:/CompanySecrets/RoyalCleaning`.
