const fs = require("node:fs");
const path = require("node:path");
const {
  withAppBuildGradle,
  withDangerousMod,
  withAndroidManifest,
  withGradleProperties,
} = require("expo/config-plugins");

module.exports = function withCallTrackTelecom(config) {
  const basePackage = config.android?.package || "com.calltrack.crm";
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:allowBackup"] = "false";
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = (
      process.env.EXPO_PUBLIC_API_URL || ""
    ).startsWith("http:")
      ? "true"
      : "false";
    return mod;
  });
  config = withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (item) => item.key !== "android.minSdkVersion",
    );
    mod.modResults.push({
      type: "property",
      key: "android.minSdkVersion",
      value: "26",
    });
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes("// CallTrack app variants")) {
      mod.modResults.contents += [
        "",
        "// CallTrack app variants: one shared backend and two separately installable apps.",
        "android {",
        '  flavorDimensions "calltrack"',
        "  productFlavors {",
        "    agent {",
        '      dimension "calltrack"',
        '      applicationId "com.calltrack.dialer"',
        "    }",
        "    admin {",
        '      dimension "calltrack"',
        '      applicationId "com.calltrack.crm"',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n");
    }
    if (
      !mod.modResults.contents.includes("// CallTrack private release signing")
    ) {
      mod.modResults.contents += [
        "",
        "// CallTrack private release signing. Never commit passwords or keystores.",
        'def calltrackProduction = System.getenv("CALLTRACK_PRODUCTION_BUILD") == "1"',
        'def calltrackKeyFile = System.getenv("CALLTRACK_KEYSTORE")',
        "if (calltrackProduction) {",
        '  ["CALLTRACK_KEYSTORE", "CALLTRACK_STORE_PASSWORD", "CALLTRACK_KEY_ALIAS", "CALLTRACK_KEY_PASSWORD"].each { name ->',
        '    if (!System.getenv(name)) throw new GradleException("Missing private signing setting: " + name)',
        "  }",
        '  if (!file(calltrackKeyFile).exists()) throw new GradleException("Private signing keystore not found")',
        '  android.signingConfigs.create("calltrackPrivate") {',
        "    storeFile file(calltrackKeyFile)",
        '    storePassword System.getenv("CALLTRACK_STORE_PASSWORD")',
        '    keyAlias System.getenv("CALLTRACK_KEY_ALIAS")',
        '    keyPassword System.getenv("CALLTRACK_KEY_PASSWORD")',
        "  }",
        "  android.buildTypes.release.signingConfig = android.signingConfigs.calltrackPrivate",
        "}",
        'if (System.getenv("CALLTRACK_CXX_DIR")) {',
        '  android.externalNativeBuild.cmake.buildStagingDirectory = file(System.getenv("CALLTRACK_CXX_DIR"))',
        "}",
        "",
      ].join("\n");
    }
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const root = mod.modRequest.platformProjectRoot;
      const res = path.join(root, "app/src/main/res");
      fs.mkdirSync(path.join(res, "drawable"), { recursive: true });
      fs.mkdirSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true });
      fs.mkdirSync(path.join(res, "values"), { recursive: true });
      fs.writeFileSync(
        path.join(res, "values/calltrack_colors.xml"),
        '<resources><color name="calltrack_launcher_background">#151C30</color></resources>',
      );
      fs.writeFileSync(
        path.join(res, "drawable/calltrack_launcher_foreground.xml"),
        '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#39C7A3" android:pathData="M37,27 C33,27 30,30 30,34 C30,57 49,76 72,76 C76,76 79,73 79,69 L79,63 C79,61 77,59 75,59 L66,57 C64,57 62,58 61,60 L58,64 C50,60 44,54 41,46 L45,43 C47,42 48,40 47,38 L45,30 C44,28 42,27 40,27 Z"/></vector>',
      );
      const adaptive =
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/calltrack_launcher_background"/><foreground android:drawable="@drawable/calltrack_launcher_foreground"/></adaptive-icon>';
      for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"])
        fs.writeFileSync(path.join(res, "mipmap-anydpi-v26", name), adaptive);
      const agent = path.join(root, "app/src/agent");
      const admin = path.join(root, "app/src/admin");
      fs.mkdirSync(agent, { recursive: true });
      fs.mkdirSync(admin, { recursive: true });
      const manifest = [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
        '  <uses-permission android:name="android.permission.CALL_PHONE" />',
        '  <uses-permission android:name="android.permission.READ_PHONE_STATE" />',
        '  <uses-permission android:name="android.permission.READ_CALL_LOG" />',
        '  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
        '  <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />',
        '  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
        '  <uses-feature android:name="android.hardware.telephony" android:required="false" />',
        '  <application android:label="CallTrack Dialer" tools:replace="android:label">',
        '    <activity android:name="' +
          basePackage +
          '.MainActivity" android:label="CallTrack Dialer">',
        "      <intent-filter>",
        '        <action android:name="android.intent.action.DIAL" />',
        '        <category android:name="android.intent.category.DEFAULT" />',
        "      </intent-filter>",
        "      <intent-filter>",
        '        <action android:name="android.intent.action.DIAL" />',
        '        <category android:name="android.intent.category.DEFAULT" />',
        '        <data android:scheme="tel" />',
        "      </intent-filter>",
        "    </activity>",
        '    <activity android:name="com.calltrack.telecom.CallTrackCallActivity" android:exported="false" android:excludeFromRecents="true" android:launchMode="singleTop" android:theme="@android:style/Theme.Material.NoActionBar" android:showWhenLocked="true" android:turnScreenOn="true" />',
        '    <service android:name="com.calltrack.telecom.CallTrackInCallService" android:exported="true" android:permission="android.permission.BIND_INCALL_SERVICE">',
        '      <meta-data android:name="android.telecom.IN_CALL_SERVICE_UI" android:value="true" />',
        '      <meta-data android:name="android.telecom.IN_CALL_SERVICE_RINGING" android:value="true" />',
        '      <intent-filter><action android:name="android.telecom.InCallService" /></intent-filter>',
        "    </service>",
        '    <receiver android:name="com.calltrack.telecom.CallTrackCallActionReceiver" android:exported="false" />',
        "  </application>",
        "</manifest>",
      ].join("\n");
      fs.writeFileSync(path.join(agent, "AndroidManifest.xml"), manifest);
      fs.writeFileSync(
        path.join(admin, "AndroidManifest.xml"),
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"><application android:label="CallTrack CRM" tools:replace="android:label" /></manifest>\n',
      );
      return mod;
    },
  ]);
};
