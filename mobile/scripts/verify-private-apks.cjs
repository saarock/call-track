const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inflateRawSync } = require("node:zlib");
const root = path.resolve(__dirname, "..");
function command(command, args) {
  const windows = process.platform === "win32" && command.endsWith(".bat");
  const r = windows
    ? spawnSync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/c", command, ...args],
        { encoding: "utf8", shell: false },
      )
    : spawnSync(command, args, { encoding: "utf8", shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(
      (r.stderr || r.stdout || "APK verification failed").slice(0, 3000),
    );
  return r.stdout;
}
function entries(buffer) {
  const floor = Math.max(0, buffer.length - 65557);
  let end = -1;
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("APK ZIP directory missing");
  const count = buffer.readUInt16LE(end + 10),
    start = buffer.readUInt32LE(end + 16);
  let offset = start;
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid APK directory");
    const n = buffer.readUInt16LE(offset + 28),
      e = buffer.readUInt16LE(offset + 30),
      c = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString("utf8", offset + 46, offset + 46 + n));
    offset += 46 + n + e + c;
  }
  return names;
}
function readEntry(buffer, target) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("APK directory missing");
  let at = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    const n = buffer.readUInt16LE(at + 28), e = buffer.readUInt16LE(at + 30), c = buffer.readUInt16LE(at + 32);
    if (buffer.toString("utf8", at + 46, at + 46 + n) === target) {
      const local = buffer.readUInt32LE(at + 42), size = buffer.readUInt32LE(at + 20), method = buffer.readUInt16LE(at + 10);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 }) : null;
    }
    at += 46 + n + e + c;
  }
  return null;
}
function verifyApk(file, variant, expected) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("Set ANDROID_HOME to verify APKs");
  const tools = path.join(sdk, "build-tools", "36.0.0"),
    suffix = process.platform === "win32" ? ".exe" : "";
  const aapt = path.join(tools, "aapt" + suffix);
  const java = process.env.JAVA_HOME
    ? path.join(
        process.env.JAVA_HOME,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      )
    : "java";
  const signerJar = path.join(tools, "lib", "apksigner.jar");
  const badging = command(aapt, ["dump", "badging", file]);
  const packageName =
    variant === "agent" ? "com.calltrack.dialer" : "com.calltrack.crm";
  if (
    !badging.includes("package: name='" + packageName + "'") ||
    !badging.includes("versionCode='" + expected.versionCode + "'")
  )
    throw new Error("APK package/version mismatch");
  const permissions = command(aapt, ["dump", "permissions", file]);
  if (permissions.includes("android.permission.RECORD_AUDIO"))
    throw new Error(
      "SIM APK unexpectedly requests microphone recording access",
    );
  const phone = ["CALL_PHONE", "READ_PHONE_STATE", "READ_CALL_LOG"];
  for (const permission of phone) {
    if (
      permissions.includes("android.permission." + permission) !==
      (variant === "agent")
    )
      throw new Error(
        "Unexpected " + permission + " permission for " + variant,
      );
  }
  const xml = command(aapt, ["dump", "xmltree", file, "AndroidManifest.xml"]);
  const inCall = xml.includes("com.calltrack.telecom.CallTrackInCallService");
  if (inCall !== (variant === "agent"))
    throw new Error("Incorrect phone service exposure in " + variant);
  const signatures = command(java, [
    "-jar",
    signerJar,
    "verify",
    "--verbose",
    "--print-certs",
    file,
  ]);
  if (expected.signing === "company" && /Android Debug/i.test(signatures))
    throw new Error("Production APK is signed with a debug certificate");
  const apk = fs.readFileSync(file);
  const contents = entries(apk);
  if (!contents.includes("assets/index.android.bundle"))
    throw new Error("APK has no embedded JavaScript bundle");
  if (!contents.some((name) => name.includes("Inter_400Regular.ttf")))
    throw new Error("APK has no bundled native Inter font");
  if (expected.apiUrl) {
    const bundle = readEntry(apk, "assets/index.android.bundle");
    if (!bundle?.includes(Buffer.from(expected.apiUrl)))
      throw new Error("Embedded APK API address does not match the intended build target");
    if (!bundle.includes(Buffer.from("System matches your device. Your preference is saved.")))
      throw new Error("APK is missing the current header and theme controls");
    if (!bundle.includes(Buffer.from("Add customer")) || !bundle.includes(Buffer.from("Load audio")))
      throw new Error("APK is missing the current customer/audio UI");
    if (!contents.filter((name) => /^classes\d*\.dex$/.test(name)).some((name) => readEntry(apk, name)?.includes(Buffer.from("expo/modules/audio/AudioModule"))))
      throw new Error("APK is missing the native audio playback module");
  }
  return {
    variant,
    packageName,
    versionCode: expected.versionCode,
    embeddedBundle: true,
    phonePermissions: variant === "agent",
    signatureVerified: true,
    ...(expected.apiUrl ? { embeddedApiVerified: true, apiUrl: expected.apiUrl } : {}),
    bytes: fs.statSync(file).size,
  };
}
module.exports = { verifyApk };
if (require.main === module) {
  const folder = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(
        root,
        "builds",
        fs.existsSync(path.join(root, "builds", "production", "release.json"))
          ? "production"
          : "preview",
      );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(folder, "release.json"), "utf8"),
  );
  for (const [variant, metadata] of Object.entries(manifest.apps))
    console.log(
      JSON.stringify(
        verifyApk(path.join(folder, metadata.filename), variant, { ...metadata, apiUrl: metadata.apiUrl || process.argv[3] }),
      ),
    );
}
