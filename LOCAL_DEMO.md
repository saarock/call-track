# Local Android preview

Production deployment is deferred at the owner's request. The preview connects to the computer's existing backend; Android calls use the phone's SIM.

## Transfer and install

After the fresh build completes, copy these files to the phone's Downloads folder through USB:

- `mobile/builds/preview/CallTrack-Dialer-preview.apk` — agent accounts and Android phone features.
- `mobile/builds/preview/CallTrack-CRM-preview.apk` — admin/supervisor accounts.

Open the APK in the phone's Files app and permit installation from that app if Android asks. USB debugging is unnecessary for file transfer. These preview builds target ARM64 Android 8 or newer.

## Connect to the computer

Keep the computer and phone on the same Wi-Fi and start the backend:

```powershell
cd server
npm start
```

The current preview API is `http://192.168.1.65:5000/api`. Open `http://192.168.1.65:5000/api/health` in the phone's browser first; it should report ready. USB copying installs the APK; it does not create a network connection to the backend. If the computer's LAN address changes, rebuild with the new address. Allow the Node server on the Windows private network if the firewall blocks access.

The computer's web interface is `http://localhost:8081`. Administrators can create agent accounts there. Use an agent account in CallTrack Dialer and an admin/supervisor account in CallTrack CRM. The static local web preview can be restarted with `node scripts/serve-local-web.cjs` from `mobile` after `node scripts/export-local-web.cjs --api-url http://192.168.1.65:5000/api` has completed.

## Verify on the phone

1. Sign in. In the agent app's Profile, complete default-phone and phone-permission setup.
2. On Leads, choose **Add customer**. Save a valid name and phone; the customer should appear assigned to that agent.
3. Use a number you authorize for testing. Verify SIM choice, outgoing/incoming calls, connection timing, hangup and the saved business result. No physical call was placed during development.
4. Test an offline business result, reopen the app, reconnect and confirm it synchronizes once.
5. Light/dark/system appearance is in Profile or Settings. Authorized existing audio attachments require administrator-enabled private storage; automatic SIM audio capture is device/provider dependent.

Synchronize pending results before uninstalling an existing app. Android will reject an update signed with a different certificate.

## Optional USB-only networking

For a phone connected through USB debugging without shared Wi-Fi, build against device loopback instead:

Set the SDK/Java environment described in `ANDROID_SETUP.md` first.

```powershell
cd mobile
node scripts/build-private-android.cjs --api-url http://127.0.0.1:5000/api --architectures arm64-v8a
adb reverse tcp:5000 tcp:5000
adb install -r builds/preview/CallTrack-Dialer-preview.apk
```

This creates a different preview target and replaces the preview files. Keep USB connected and the backend running. The LAN preview does not use this loopback tunnel.

For a failed native compilation, `--resume-native` can retry the existing Android project without running Expo prebuild again. Use it only when app configuration, native plugins and native dependencies have not changed since the last prebuild.
