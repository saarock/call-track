import { Router } from "express";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fail } from "../utils/http.js";

// The directory must be private, outside a static web root, and read-only to the service account.
export function appUpdateRoutes(options = {}) {
  const router = Router();
  const directory = () =>
    options.directory ?? process.env.CALLTRACK_RELEASE_DIR;
  const production = () =>
    (options.nodeEnv ?? process.env.NODE_ENV) === "production";
  const cache = new Map();
  async function release(req, variant) {
    if (!req.user) throw fail(401, "Sign in to download company applications.");
    if (!["agent", "admin"].includes(variant))
      throw fail(400, "Choose the agent or admin application.");
    if (!["admin", "supervisor"].includes(req.user.role) && variant !== "agent")
      throw fail(403, "Administrator access required.");
    if (!directory()) return null;
    let base, data;
    try {
      base = await realpath(directory());
      data = JSON.parse(
        await readFile(path.join(base, "release.json"), "utf8"),
      );
    } catch {
      throw fail(503, "The private release manifest is unavailable.");
    }
    const app = data.apps?.[variant];
    if (!app) return null;
    if (
      !/^[A-Za-z0-9._-]+\.apk$/.test(app.filename || "") ||
      !/^[a-f0-9]{64}$/.test(app.sha256 || "") ||
      !Number.isSafeInteger(app.versionCode) ||
      app.versionCode < 1 ||
      typeof app.version !== "string"
    )
      throw fail(503, "The private release manifest is invalid.");
    if (production() && app.signing !== "company")
      throw fail(503, "A company-signed release has not been configured.");
    const expectedPackage =
      variant === "agent" ? "com.calltrack.dialer" : "com.calltrack.crm";
    if (app.packageName !== expectedPackage)
      throw fail(503, "The release package does not match this application.");
    let file, info;
    try {
      file = await realpath(path.join(base, app.filename));
      if (path.dirname(file) !== base)
        throw new Error("Release outside private directory");
      info = await stat(file);
      if (!info.isFile() || info.size > 500 * 1024 * 1024)
        throw new Error("Invalid release file");
      const key =
        file + ":" + info.mtimeMs + ":" + info.size + ":" + app.sha256;
      if (!cache.has(key)) {
        const digest = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
        if (digest !== app.sha256) throw new Error("Release checksum mismatch");
        cache.clear();
        cache.set(key, true);
      }
    } catch {
      throw fail(
        503,
        "The private APK is unavailable or failed integrity verification.",
      );
    }
    return {
      file,
      metadata: {
        variant,
        version: app.version,
        versionCode: app.versionCode,
        packageName: app.packageName,
        signing: app.signing,
        sha256: app.sha256,
        bytes: info.size,
        notes: String(app.notes || "").slice(0, 2000),
        downloadPath: "/app-updates/" + variant + "/download",
      },
    };
  }
  router.get("/app-updates", async (req, res, next) => {
    try {
      const variant =
        req.query.variant ||
        (["admin", "supervisor"].includes(req.user?.role) ? "admin" : "agent");
      const current = Number(req.query.versionCode || 0);
      if (!Number.isSafeInteger(current) || current < 0)
        throw fail(400, "Invalid version code.");
      const item = await release(req, variant);
      res
        .set("Cache-Control", "no-store")
        .json(
          item
            ? {
                configured: true,
                updateAvailable: current < item.metadata.versionCode,
                ...item.metadata,
              }
            : { configured: false, updateAvailable: false },
        );
    } catch (error) {
      next(error);
    }
  });
  router.get("/app-updates/:variant/download", async (req, res, next) => {
    try {
      const item = await release(req, req.params.variant);
      if (!item) throw fail(404, "No private release has been configured.");
      res.set({
        "Cache-Control": "private, no-store",
        "Content-Type": "application/vnd.android.package-archive",
        "X-Content-Type-Options": "nosniff",
      });
      res.download(item.file, path.basename(item.file));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
