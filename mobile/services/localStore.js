import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

const empty = () => ({
  queue: [],
  pending: [],
  leads: [],
  profile: null,
  lastSync: null,
});
let writes = Promise.resolve();
function key(userId) {
  if (!/^[a-f0-9]{24}$/i.test(String(userId)))
    throw new Error("A valid signed-in account is required");
  return "calltrack-offline-" + userId;
}
function file(userId) {
  if (!FileSystem.documentDirectory)
    throw new Error("Device storage is unavailable");
  return FileSystem.documentDirectory + key(userId) + ".json";
}
async function rawRead(userId, backup = false) {
  if (Platform.OS === "web") {
    return window.localStorage.getItem(
      key(userId) + (backup ? "-backup" : "")
    );
  }

  const path =
    file(userId) +
    (backup === "temp" ? ".tmp" : backup ? ".backup" : "");

  const info = await FileSystem.getInfoAsync(path);

  if (!info.exists) {
    return null;
  }

  try {
    return await FileSystem.readAsStringAsync(path);
  } catch (error) {
    const message = String(error?.message || error);

    if (/FileNotFoundException|ENOENT|no such file/i.test(message)) {
      console.warn("Storage file disappeared:", path);
      return null;
    }

    throw error;
  }
}

async function readOwnerStoreInternal(userId) {
  let corrupt = false;
  for (const backup of Platform.OS === "web"
    ? [false, true]
    : [false, "temp", true]) {
    const raw = await rawRead(userId, backup);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (
        !value ||
        !Array.isArray(value.queue) ||
        !Array.isArray(value.pending)
      )
        throw new Error();
      return { ...empty(), ...value };
    } catch {
      corrupt = true;
    }
  }
  if (corrupt)
    throw new Error(
      "Saved call results could not be read. Keep your app data and retry before saving more results.",
    );
  return empty();
}
export async function readOwnerStore(userId) {
  await writes.catch(() => {});
  return readOwnerStoreInternal(userId);
}

async function writeOwnerStore(userId, value, previous) {
  const json = JSON.stringify(value);
  if (Platform.OS === "web") {
    window.localStorage.setItem(
      key(userId) + "-backup",
      JSON.stringify(previous),
    );
    window.localStorage.setItem(key(userId), json);
    return;
  }
  const target = file(userId),
    temp = target + ".tmp";
  await FileSystem.writeAsStringAsync(temp, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const info = await FileSystem.getInfoAsync(target);
  if (info.exists) {
    await FileSystem.writeAsStringAsync(
      target + ".backup",
      JSON.stringify(previous),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
    await FileSystem.deleteAsync(target, { idempotent: true });
  }
  await FileSystem.moveAsync({ from: temp, to: target });
}
export function updateOwnerStore(userId, updater) {
  const work = writes
    .catch(() => {})
    .then(async () => {
      const current = await readOwnerStoreInternal(userId);
      const next = updater(current) || current;
      if (next !== current) await writeOwnerStore(userId, next, current);
      return next;
    });
  writes = work;
  return work;
}
export function cacheProfile(userId, profile) {
  return updateOwnerStore(userId, (current) => ({
    ...current,
    profile: { ...profile, cachedAt: new Date().toISOString() },
  }));
}
export function tokenClaims(token) {
  try {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const input = token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/=+$/, "");
    let bits = 0,
      value = 0,
      plain = "";
    for (const char of input) {
      const index = alphabet.indexOf(char);
      if (index < 0) return null;
      value = (value << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        plain += String.fromCharCode((value >> bits) & 255);
      }
    }
    return JSON.parse(plain);
  } catch {
    return null;
  }
}
export async function cachedSession(token) {
  const claims = tokenClaims(token);
  if (
    !claims ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now() ||
    !/^[a-f0-9]{24}$/i.test(claims.sub || "")
  )
    return null;
  const cached = (await readOwnerStore(claims.sub)).profile;
  return cached?.user?._id === claims.sub ? cached : null;
}
