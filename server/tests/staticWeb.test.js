import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { createApp } from "../app.js";
test("cPanel static export serves routes while protecting API and private files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calltrack-static-"));
  try {
    fs.writeFileSync(
      path.join(directory, "index.html"),
      "<html>CallTrack browser app</html>",
    );
    fs.writeFileSync(
      path.join(directory, "bundle.js"),
      "console.log('static asset')",
    );
    fs.writeFileSync(path.join(directory, ".env"), "SECRET=not-public");
    const app = createApp({
      config: {
        nodeEnv: "test",
        jwtSecret: "static-test-secret-at-least-32-characters",
        callMode: "sim",
        webDirectory: directory,
      },
      isDatabaseReady: () => false,
    });
    const home = await request(app).get("/").set("Accept", "text/html");
    assert.equal(home.status, 200);
    assert.match(home.text, /CallTrack browser app/);
    assert.equal(home.headers["cache-control"], "no-store");
    assert.equal(
      (await request(app).get("/leads").set("Accept", "text/html")).status,
      200,
    );
    assert.equal((await request(app).get("/bundle.js")).status, 200);
    const missing = await request(app)
      .get("/api/not-an-endpoint")
      .set("Accept", "text/html");
    assert.notEqual(missing.status, 200);
    assert(!missing.text.includes("browser app"));
    const hidden = await request(app).get("/.env");
    assert.notEqual(hidden.status, 200);
    assert(!hidden.text.includes("not-public"));
  } finally {
    if (
      !path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)
    )
      throw new Error("Invalid test cleanup path");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("cPanel static configuration rejects a missing export", () => {
  assert.throws(
    () =>
      createApp({
        config: {
          webDirectory: path.join(os.tmpdir(), "calltrack-missing-export"),
        },
        isDatabaseReady: () => false,
      }),
    /WEB_DIRECTORY/,
  );
});
