import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { createServer } from "node:http";
import { io as socketClient } from "socket.io-client";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  User,
  Settings,
  Call,
  Recording,
  Activity,
  Notification,
  ensureIndexes,
} from "../models/index.js";
import { createApp } from "../app.js";
import { setupLive } from "../sockets/live.js";
import {
  connectDatabase,
  databaseReady,
  disconnectDatabase,
} from "../config/database.js";
import { transition, applyCallEvent } from "../services/callState.js";
import { issueToken } from "../middleware/auth.js";

let mongo, app, server, live, admin, a1, a2, other, tokens, lead, call;
const config = {
  jwtSecret: "test-secret-that-is-more-than-thirty-two-characters",
  callMode: "demo",
  origins: [],
};
const password = "Testing-password-123!";
const api = (token) => ({
  get: (p) =>
    request(app)
      .get("/api" + p)
      .auth(token, { type: "bearer" }),
  post: (p, b) =>
    request(app)
      .post("/api" + p)
      .auth(token, { type: "bearer" })
      .send(b),
  put: (p, b) =>
    request(app)
      .put("/api" + p)
      .auth(token, { type: "bearer" })
      .send(b),
  patch: (p, b) =>
    request(app)
      .patch("/api" + p)
      .auth(token, { type: "bearer" })
      .send(b),
});
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 120000, args: process.platform === "win32" ? [] : ["--nounixsocket"] },
  });
  await connectDatabase(mongo.getUri());
  await ensureIndexes();
  const companyId = new mongoose.Types.ObjectId(),
    otherCompany = new mongoose.Types.ObjectId();
  await Settings.create([
    { _id: companyId, companyId, name: "Test Company" },
    { _id: otherCompany, companyId: otherCompany, name: "Other Company" },
  ]);
  const hash = await bcrypt.hash(password, 4);
  [admin, a1, a2, other] = await User.create([
    {
      companyId,
      fullName: "Admin",
      email: "admin@test.local",
      agentCode: "ADMIN",
      role: "admin",
      passwordHash: hash,
    },
    {
      companyId,
      fullName: "Agent One",
      email: "one@test.local",
      agentCode: "A1",
      passwordHash: hash,
    },
    {
      companyId,
      fullName: "Agent Two",
      email: "two@test.local",
      agentCode: "A2",
      passwordHash: hash,
    },
    {
      companyId: otherCompany,
      fullName: "Other Admin",
      email: "other@test.local",
      agentCode: "O",
      role: "admin",
      passwordHash: hash,
    },
  ]);
  tokens = [admin, a1, a2, other].map((u) => issueToken(u, config.jwtSecret));
  app = createApp({ config, isDatabaseReady: databaseReady });
  server = createServer(app);
  live = setupLive(server, config);
  app.locals.live = live;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});
after(async () => {
  live?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  await mongo?.stop();
});
test("login succeeds, rejects incorrect password, never leaks hashes", async () => {
  await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.local", password: "bad" })
    .expect(401);
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.local", password })
    .expect(200);
  assert.ok(login.body.token);
  assert.equal(login.body.user.passwordHash, undefined);
  assert.equal(login.body.user.tokenVersion, undefined);
  const response = await api(tokens[0]).get("/users").expect(200);
  assert.ok(
    response.body.items.every(
      (u) => !u.passwordHash && u.tokenVersion === undefined,
    ),
  );
  await request(app).get("/api/leads").expect(401);
});
test("admin creates agent; ordinary agents and other company cannot edit", async () => {
  const response = await api(tokens[0])
    .post("/users", {
      fullName: "New Agent",
      email: "new@test.local",
      agentCode: "A3",
      password,
    })
    .expect(201);
  await api(tokens[1]).post("/users", { fullName: "Forbidden" }).expect(403);
  await api(tokens[3])
    .put("/users/" + response.body._id, { fullName: "Hacked" })
    .expect(404);
  await api(tokens[0])
    .post("/users", {
      fullName: "Duplicate",
      email: "new@test.local",
      agentCode: "A4",
      password,
    })
    .expect(409);
});
test("create, deduplicate and scope leads by assignment and company", async () => {
  const response = await api(tokens[0])
    .post("/leads", {
      fullName: "Customer",
      phone: "+9779800000000",
      assignedAgentId: String(a1._id),
    })
    .expect(201);
  lead = response.body;
  await api(tokens[0])
    .post("/leads", { fullName: "Customer", phone: "+9779800000000" })
    .expect(409);
  await api(tokens[1])
    .get("/leads/" + lead._id)
    .expect(200);
  await api(tokens[2])
    .get("/leads/" + lead._id)
    .expect(404);
  await api(tokens[3])
    .get("/leads/" + lead._id)
    .expect(404);
  const created = await api(tokens[1])
    .post("/leads", { fullName: "Agent customer", phone: "9800000001", assignedAgentId: String(a2._id) })
    .expect(201);
  assert.equal(created.body.assignedAgentId, String(a1._id));
  await api(tokens[2]).get("/leads/" + created.body._id).expect(404);
  await api(tokens[1]).post("/leads", { fullName: "Duplicate", phone: "+9779800000001" }).expect(409);
  await api(tokens[0]).put("/settings", { agentCanCreateCustomers: false }).expect(200);
  await api(tokens[1]).post("/leads", { fullName: "Disabled", phone: "9800000099" }).expect(403);
  await api(tokens[0]).put("/settings", { agentCanCreateCustomers: true }).expect(200);
  const list = await api(tokens[2]).get("/leads").expect(200);
  assert.equal(list.body.total, 0);
  await api(tokens[0])
    .patch("/leads/" + lead._id + "/assign", { agentId: String(other._id) })
    .expect(400);
});
test("notes, status, follow-ups and customer records have ownership checks", async () => {
  await api(tokens[1])
    .post(`/leads/${lead._id}/notes`, { note: "Needs a follow-up" })
    .expect(201);
  await api(tokens[1])
    .put(`/leads/${lead._id}`, { status: "Interested" })
    .expect(200);
  await api(tokens[1])
    .put(`/leads/${lead._id}`, { status: "Not a status" })
    .expect(400);
  const follow = await api(tokens[1])
    .post("/follow-ups", {
      leadId: lead._id,
      dueAt: new Date(Date.now() + 60000).toISOString(),
      notes: "Call tomorrow",
    })
    .expect(201);
  await api(tokens[2])
    .patch(`/follow-ups/${follow.body._id}/complete`, {})
    .expect(404);
  await api(tokens[1])
    .patch(`/follow-ups/${follow.body._id}/complete`, {})
    .expect(200);
  await api(tokens[2]).get(`/customers/${lead.customerId}`).expect(404);
  await api(tokens[1]).get(`/customers/${lead.customerId}/history`).expect(200);
});
test("CSV import returns row-level duplicate and validation results", async () => {
  const result = await api(tokens[0])
    .post("/leads/import", {
      csv: "fullName,phone\nDuplicate,+9779800000000\nImported,+9779800000002\nBad,nope",
    })
    .expect(200);
  assert.deepEqual(
    result.body.results.map((r) => r.status),
    ["duplicate", "created", "invalid"],
  );
});
test("simulated call lifecycle is idempotent and limits agents to one active call", async () => {
  const response = await api(tokens[1])
    .post("/calls/start", { leadId: lead._id })
    .expect(201);
  call = response.body;
  assert.equal(call.isDemo, true);
  await api(tokens[1]).post("/calls/start", { leadId: lead._id }).expect(409);
  await api(tokens[2]).get(`/calls/${call._id}`).expect(404);
  await api(tokens[0])
    .patch(`/leads/${lead._id}/assign`, { agentId: String(a2._id) })
    .expect(409);
  await api(tokens[1])
    .post(`/demo/calls/${call._id}/events`, { status: "ringing" })
    .expect(200);
  await api(tokens[1])
    .post(`/demo/calls/${call._id}/events`, { status: "in-progress" })
    .expect(200);
  await api(tokens[1])
    .post(`/demo/calls/${call._id}/events`, { status: "completed" })
    .expect(200);
  await api(tokens[1])
    .post(`/demo/calls/${call._id}/events`, { status: "ringing" })
    .expect(200);
  const current = await Call.findById(call._id);
  assert.equal(current.status, "completed");
  assert.equal(current.active, false);
  assert.ok(current.answeredAt);
  assert.equal(await Call.countDocuments({ _id: call._id }), 1);
  assert.equal(
    await Activity.countDocuments({ callId: call._id, type: "call.ended" }),
    1,
  );
  await api(tokens[1])
    .patch(`/calls/${call._id}/result`, {
      result: "Interested",
      notes: "=formula attack",
    })
    .expect(200);
});
test("reports derive totals, separate permissions and export CSV safely", async () => {
  const dashboard = await api(tokens[0])
    .get("/reports/dashboard?period=today")
    .expect(200);
  assert.equal(dashboard.body.totalCalls, 1);
  assert.equal(dashboard.body.answered, 1);
  const own = await api(tokens[2])
    .get("/reports/dashboard?period=today")
    .expect(200);
  assert.equal(own.body.totalCalls, 0);
  const csv = await api(tokens[0])
    .get("/reports/export?period=today")
    .expect(200);
  assert.ok(csv.text.includes("'=formula attack"));
  await api(tokens[1]).get("/reports/export").expect(403);
  await api(tokens[0])
    .get("/reports/dashboard?period=custom&from=bad&to=bad")
    .expect(400);
});
test("reassignment revokes lead access but preserves agent-owned call history", async () => {
  await api(tokens[0])
    .patch(`/leads/${lead._id}/assign`, { agentId: String(a2._id) })
    .expect(200);
  await api(tokens[1]).get(`/leads/${lead._id}`).expect(404);
  await api(tokens[2]).get(`/leads/${lead._id}`).expect(200);
  await api(tokens[1]).get(`/calls/${call._id}`).expect(200);
  await api(tokens[2]).get(`/calls/${call._id}`).expect(404);
});
test("Socket.IO rejects forged identity and tracks multiple devices independently", async () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  async function connect(token) {
    const socket = socketClient(url, {
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  await assert.rejects(connect("forged"));
  const first = await connect(tokens[1]),
    second = await connect(tokens[1]);
  assert.equal(live.online(a1._id), true);
  first.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(live.online(a1._id), true);
  second.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(live.online(a1._id), false);
});
test("deactivation and logout invalidate existing tokens", async () => {
  await api(tokens[0])
    .patch("/users/" + a2._id + "/status", { active: false })
    .expect(200);
  await api(tokens[2]).get("/auth/me").expect(401);
  await request(app)
    .post("/api/auth/login")
    .send({ email: a2.email, password })
    .expect(401);
  await api(tokens[1]).post("/auth/logout", {}).expect(200);
  await api(tokens[1]).get("/auth/me").expect(401);
});
test("state transitions reject stale sequence and reconstruct missed answer from final duration", () => {
  const base = {
    active: true,
    status: "ringing",
    sequence: 2,
    initiatedAt: new Date("2026-10-01T10:00:00Z"),
  };
  assert.equal(transition(base, { status: "initiated", sequence: 1 }), null);
  const done = transition(base, {
    status: "completed",
    at: new Date("2026-10-01T10:01:00Z"),
    duration: 40,
    sequence: 3,
  });
  assert.equal(done.talkSeconds, 40);
  assert.equal(done.ringSeconds, 20);
  assert.equal(done.answeredAt.toISOString(), "2026-10-01T10:00:20.000Z");
});

test("SIM mode creates unverified tasks and accepts only explicit manual reports", async () => {
  const simConfig = { ...config, callMode: "sim" };
  const simApp = createApp({
    config: simConfig,
    isDatabaseReady: databaseReady,
  });
  const simServer = createServer(simApp);
  const simLive = setupLive(simServer, simConfig);
  simApp.locals.live = simLive;
  const user = await User.findById(a1._id).select("+tokenVersion");
  const token = issueToken(user, config.jwtSecret);
  const make = (method, path, body) =>
    request(simApp)
      [method]("/api" + path)
      .auth(token, { type: "bearer" })
      .send(body);
  try {
    await api(tokens[0])
      .patch(`/leads/${lead._id}/assign`, { agentId: String(a1._id) })
      .expect(200);
    const started = await make("post", "/calls/start", {
      leadId: lead._id,
    }).expect(201);
    const id = started.body._id;
    assert.equal(started.body.status, "unconfirmed");
    assert.equal(started.body.source, "sim");
    assert.equal(started.body.isDemo, false);
    assert.equal(started.body.answeredAt, undefined);
    const snapshot = await simLive.snapshot(admin);
    assert.equal(
      snapshot.items.find((u) => String(u._id) === String(a1._id)).status,
      "Awaiting report (unverified)",
    );
    await make("post", `/demo/calls/${id}/events`, {
      status: "in-progress",
    }).expect(404);
    await make("post", `/calls/${id}/hangup`, {}).expect(409);
    await make("post", "/voice/token", { platform: "android" }).expect(404);
    const files = await make("get", "/recordings").expect(200);
    assert.equal(files.body.total, 0);
    const capture = await make("get", "/recordings/config").expect(200);
    assert.equal(capture.body.automaticSimRecording, false);
    await request(simApp)
      .post(`/api/calls/${id}/report`)
      .auth(tokens[3], { type: "bearer" })
      .send({ status: "completed" })
      .expect(404);
    await make("post", `/calls/${id}/report`, {
      status: "completed",
      talkSeconds: -1,
    }).expect(400);
    await make("post", `/calls/${id}/report`, {
      status: "no-answer",
      talkSeconds: 10,
    }).expect(400);
    const report = await make("post", `/calls/${id}/report`, {
      status: "completed",
      notes: "Customer answered; duration not known",
    }).expect(200);
    assert.equal(report.body.reportedAnswered, true);
    assert.equal(report.body.durationKnown, false);
    assert.equal(report.body.answeredAt, undefined);
    assert.equal(report.body.endedAt, undefined);
    assert.ok(report.body.reportedAt);
    await make("post", `/calls/${id}/report`, { status: "failed" }).expect(409);
    const second = await make("post", "/calls/start", {
      leadId: lead._id,
    }).expect(201);
    await make("post", `/calls/${second.body._id}/report`, {
      status: "completed",
      talkSeconds: 120,
    }).expect(200);
    const stats = await make("get", "/reports/dashboard?period=today").expect(
      200,
    );
    assert.equal(stats.body.totalCalls, 2);
    assert.equal(stats.body.answered, 2);
    assert.equal(stats.body.averageSeconds, 120);
    assert.equal(stats.body.unknownDurations, 1);
    const third = await make("post", "/calls/start", {
      leadId: lead._id,
    }).expect(201);
    await make("post", `/calls/${third.body._id}/report`, {
      status: "unconfirmed",
      notes: "Did not verify",
    }).expect(200);
    const record = await Call.findById(third.body._id);
    assert.equal(record.reportedAnswered, false);
    assert.equal(record.active, false);
    assert.equal(record.status, "unconfirmed");
  } finally {
    simLive.close();
  }
});
