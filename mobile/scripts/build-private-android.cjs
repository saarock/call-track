const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { verifyApk } = require("./verify-private-apks.cjs");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const production = args.includes("--production");
const value = (name) => args[args.indexOf(name) + 1];
const apiUrl = args.includes("--api-url")
  ? value("--api-url")
  : process.env.EXPO_PUBLIC_API_URL;
if (!apiUrl)
  throw new Error(
    "Supply --api-url https://your-private-domain/api (or an explicit LAN URL for a preview build).",
  );
const url = new URL(apiUrl);
if (
  !["http:", "https:"].includes(url.protocol) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error(
    "Use a plain HTTP(S) API URL without credentials, query, or fragment.",
  );
if (
  production &&
  (url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "10.0.2.2", "::1"].includes(url.hostname))
)
  throw new Error("A production APK requires a reachable HTTPS API.");
const required = [
  "CALLTRACK_KEYSTORE",
  "CALLTRACK_STORE_PASSWORD",
  "CALLTRACK_KEY_ALIAS",
  "CALLTRACK_KEY_PASSWORD",
];
if (production)
  for (const name of required)
    if (!process.env[name]) throw new Error("Missing signing setting: " + name);
if (production && !fs.existsSync(process.env.CALLTRACK_KEYSTORE))
  throw new Error("Private keystore file does not exist.");
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: apiUrl.replace(/\/$/, ""),
  CALLTRACK_PRODUCTION_BUILD: production ? "1" : "0",
  CI: "1",
  EXPO_NO_METRO_WORKSPACE_ROOT: "1",
};
if(process.platform==="win32"&&!env.CALLTRACK_CXX_DIR)env.CALLTRACK_CXX_DIR=path.join(path.parse(root).root,"CallTrackBuild","cxx");

const run = (command, params, cwd = root) => {
  const result =
    process.platform === "win32" && command.endsWith(".bat")
      ? spawnSync(
          process.env.ComSpec || "cmd.exe",
          ["/d", "/c", command, ...params],
          { cwd, env, stdio: "inherit", shell: false },
        )
      : spawnSync(command, params, {
          cwd,
          env,
          stdio: "inherit",
          shell: false,
        });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
if (!args.includes("--resume-native")) {
  run(process.execPath, [
    require.resolve("expo/bin/cli"),
    "prebuild",
    "--platform",
    "android",
    "--no-install",
  ]);
} else if (!fs.existsSync(path.join(root, "android/app/build.gradle"))) {
  throw new Error("Cannot resume: generate the Android project first.");
}
// Expo prebuild can leave React Native's cached template namespace behind.
// Invalidate that one generated cache when the application namespace changes.
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo;
const gradleSource = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
const namespace = gradleSource.match(/namespace\s*=?\s*["']([^"']+)["']/)?.[1];
if (!namespace || namespace !== app.android.package)
  throw new Error("Android namespace does not match the configured application package.");
const autolinkingFile = path.join(root, "android/build/generated/autolinking/autolinking.json");
if (fs.existsSync(autolinkingFile)) {
  let linkedPackage;
  try { linkedPackage = JSON.parse(fs.readFileSync(autolinkingFile, "utf8")).project?.android?.packageName; } catch {}
  if (linkedPackage !== namespace) {
    fs.unlinkSync(autolinkingFile);
    console.log("Invalidated stale Android autolinking namespace: " + (linkedPackage || "invalid"));
  }
}
const abi = args.includes("--architectures")
  ? value("--architectures")
  : "arm64-v8a,armeabi-v7a";
if (
  !/^(arm64-v8a|armeabi-v7a|x86|x86_64)(,(arm64-v8a|armeabi-v7a|x86|x86_64))*$/.test(
    abi,
  )
)
  throw new Error("Invalid architectures");
// Gradle tracks source changes but not public environment variables. Invalidate
// bundles whose embedded API differs, while preserving a matching retry bundle.
for (const variant of ["agentRelease", "adminRelease"]) {
  const bundle = path.join(root, "android", "app", "build", "generated", "assets", "react", variant, "index.android.bundle");
  if (fs.existsSync(bundle) && !fs.readFileSync(bundle).includes(Buffer.from(env.EXPO_PUBLIC_API_URL))) fs.unlinkSync(bundle);
}
run(
  process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  [
    ":app:assembleAgentRelease",
    ":app:assembleAdminRelease",
    "-PreactNativeArchitectures=" + abi,
    "--console=plain",
    ...(process.platform === "win32" ? ["--max-workers=2"] : []),
  ],
  path.join(root, "android"),
);
const folder = path.join(root, "builds", production ? "production" : "preview");
fs.mkdirSync(folder, { recursive: true });
const manifest = { generatedAt: new Date().toISOString(), apps: {} };
for (const variant of ["agent", "admin"]) {
  const filename =
    "CallTrack-" +
    (variant === "agent" ? "Dialer" : "CRM") +
    "-" +
    (production ? "private" : "preview") +
    ".apk";
  const from = path.join(
    root,
    "android/app/build/outputs/apk",
    variant,
    "release/app-" + variant + "-release.apk",
  );
  const to = path.join(folder, filename);
  fs.copyFileSync(from, to);
  console.log(
    JSON.stringify(
      verifyApk(to, variant, {
        versionCode: app.android.versionCode,
        signing: production ? "company" : "preview",
        apiUrl: env.EXPO_PUBLIC_API_URL,
      }),
    ),
  );
  const bytes = fs.readFileSync(to);
  manifest.apps[variant] = {
    filename,
    version: app.version,
    versionCode: app.android.versionCode,
    packageName:
      variant === "agent" ? "com.calltrack.dialer" : "com.calltrack.crm",
    signing: production ? "company" : "preview",
    apiUrl: env.EXPO_PUBLIC_API_URL,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    notes: "Private Royal Cleaning Services distribution",
  };
}
fs.writeFileSync(
  path.join(folder, "release.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "APKs and checksums saved under mobile/builds. Signing: " +
    (production
      ? "configured company key"
      : "Android debug key: internal testing only"),
);
