import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../app.js";
import { readEnv } from "../config/env.js";
test("readiness reflects database without exposing secrets", async () => {
  const response = await request(
    createApp({ isDatabaseReady: async () => true }),
  )
    .get("/api/health")
    .expect(200);
  assert.equal(response.body.database, "connected");
  assert.equal(response.headers["x-powered-by"], undefined);
});
test("readiness fails safely when database is disconnected or errors", async () => {
  for (const probe of [
    async () => false,
    async () => {
      throw new Error("secret URI");
    },
  ]) {
    const app = createApp({ isDatabaseReady: probe });
    const response = await request(app).get("/api/health").expect(503);
    assert.equal(response.body.database, "disconnected");
    assert.ok(!response.text.includes("secret"));
    await request(app).get("/api/health/live").expect(200);
  }
});
test("unimplemented API is inaccessible; disallowed browser origins are rejected", async () => {
  const app = createApp({
    origins: ["http://localhost:8081"],
    isDatabaseReady: async () => true,
  });
  await request(app).get("/api/leads").expect(404);
  await request(app)
    .get("/api/health")
    .set("Origin", "https://untrusted.example")
    .expect(403);
  const response = await request(app)
    .get("/api/health")
    .set("Origin", "http://localhost:8081")
    .expect(200);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://localhost:8081",
  );
});
test("configuration rejects missing database, invalid port and incomplete live configuration", () => {
  assert.throws(() => readEnv({}));
  assert.throws(() =>
    readEnv({ MONGODB_URI: "mongodb://localhost/test", PORT: "abc" }),
  );
  assert.throws(() =>
    readEnv({ MONGODB_URI: "mongodb://localhost/test", CALL_MODE: "live" }),
  );
});
