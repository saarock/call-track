import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import request from "supertest";
import { createApp } from "../app.js";
import { setupLive } from "../sockets/live.js";

const appFor = (config) =>
  createApp({
    config,
    isDatabaseReady: async () => true,
  });
const configFor = (nodeEnv = "development", origins = []) => ({
  nodeEnv,
  origins,
  jwtSecret: "cors-test-secret-with-at-least-thirty-two-characters",
  callMode: "sim",
});

test("login preflight permits JSON and bearer headers from local development origins", async () => {
  const app = appFor(configFor());
  for (const origin of [
    "http://localhost:8082",
    "http://127.0.0.1:19006",
    "http://192.168.1.65:8081",
    "http://10.0.2.2:8081",
    "http://172.16.1.2:8081",
    "http://[::1]:8081",
  ]) {
    const response = await request(app)
      .options("/api/auth/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization")
      .expect(204);
    assert.equal(response.headers["access-control-allow-origin"], origin);
    assert.match(response.headers["access-control-allow-methods"], /POST/);
    assert.match(
      response.headers["access-control-allow-headers"],
      /Content-Type/i,
    );
    assert.match(
      response.headers["access-control-allow-headers"],
      /Authorization/i,
    );
  }
});

test("authentication errors remain readable by an allowed browser origin", async () => {
  const response = await request(appFor(configFor()))
    .get("/api/auth/me")
    .set("Origin", "http://localhost:8081")
    .expect(401);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://localhost:8081",
  );
  assert.equal(typeof response.body.error.message, "string");
});

test("production uses explicit normalized origins and rejects implicit local origins", async () => {
  const app = appFor(
    configFor("production", [" https://crm.example.test/workspace/ "]),
  );
  const allowed = await request(app)
    .get("/api/health")
    .set("Origin", "https://crm.example.test")
    .expect(200);
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "https://crm.example.test",
  );
  for (const origin of [
    "http://localhost:8081",
    "http://192.168.1.65:8081",
    "https://untrusted.example",
  ]) {
    const denied = await request(app)
      .get("/api/health")
      .set("Origin", origin)
      .expect(403);
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
  }
  await request(app).get("/api/health").expect(200);
});

test("production can explicitly permit a local frontend origin", async () => {
  const response = await request(
    appFor(configFor("production", ["http://localhost:8081/"])),
  )
    .get("/api/health")
    .set("Origin", "http://localhost:8081")
    .expect(200);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://localhost:8081",
  );
});

test("Socket.IO polling uses the same development CORS policy", async () => {
  const config = configFor();
  const server = createServer(appFor(config));
  const live = setupLive(server, config);
  try {
    const response = await request(server)
      .get("/socket.io/?EIO=4&transport=polling")
      .set("Origin", "http://192.168.1.65:8082")
      .expect(200);
    assert.equal(
      response.headers["access-control-allow-origin"],
      "http://192.168.1.65:8082",
    );
    assert.ok(response.text.startsWith("0{"));
  } finally {
    live.close();
  }
});

test("Socket.IO production rejects unknown browser origins and accepts native clients", async () => {
  const config = configFor("production", ["https://crm.example.test"]);
  const server = createServer(appFor(config));
  const live = setupLive(server, config);
  try {
    const denied = await request(server)
      .get("/socket.io/?EIO=4&transport=polling")
      .set("Origin", "http://localhost:8081")
      .expect(400);
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
    const allowed = await request(server)
      .get("/socket.io/?EIO=4&transport=polling")
      .set("Origin", "https://crm.example.test")
      .expect(200);
    assert.equal(
      allowed.headers["access-control-allow-origin"],
      "https://crm.example.test",
    );
    await request(server)
      .get("/socket.io/?EIO=4&transport=polling")
      .expect(200);
  } finally {
    live.close();
  }
});
