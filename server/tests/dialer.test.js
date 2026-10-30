import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcrypt";

let mongo,
  app,
  live,
  models,
  agent,
  admin,
  other,
  lead,
  customer,
  tokens,
  disconnect;
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 120000, args: process.platform === "win32" ? [] : ["--nounixsocket"] },
  });
  const database = await import("../config/database.js");
  disconnect = database.disconnectDatabase;
  await database.connectDatabase(mongo.getUri("dialer_workflow"));
  models = await import("../models/index.js");
  await models.ensureIndexes();
  const mongoose = (await import("mongoose")).default,
    companyId = new mongoose.Types.ObjectId();
  await models.Settings.create({
    _id: companyId,
    companyId,
    name: "Dialer test",
    agentCanCreateCustomers: false,
  });
  const hash = await bcrypt.hash("Device-testing-password-123", 4);
  [admin, agent, other] = await models.User.create([
    {
      companyId,
      fullName: "Admin",
      email: "admin@dialer.test",
      agentCode: "ADMIN",
      role: "admin",
      passwordHash: hash,
    },
    {
      companyId,
      fullName: "Agent",
      email: "agent@dialer.test",
      agentCode: "A01",
      role: "agent",
      passwordHash: hash,
    },
    {
      companyId: new mongoose.Types.ObjectId(),
      fullName: "Other",
      email: "other@dialer.test",
      agentCode: "B01",
      role: "agent",
      passwordHash: hash,
    },
  ]);
  customer = await models.Customer.create({
    companyId,
    fullName: "Test customer",
    phone: "+9779800000001",
  });
  lead = await models.Lead.create({
    companyId,
    customerId: customer._id,
    assignedAgentId: agent._id,
    assignedAt: new Date(),
    status: "Assigned",
  });
  const config = {
    nodeEnv: "test",
    origins: [],
    jwtSecret: "dialer-test-secret-with-more-than-32-characters",
    callMode: "sim",
  };
  app = (await import("../app.js")).createApp({
    config,
    isDatabaseReady: async () => true,
  });
  live = (await import("../sockets/live.js")).setupLive(
    createServer(app),
    config,
  );
  app.locals.live = live;
  const { issueToken } = await import("../middleware/auth.js");
  tokens = {
    agent: issueToken(agent, config.jwtSecret),
    admin: issueToken(admin, config.jwtSecret),
    other: issueToken(other, config.jwtSecret),
  };
});
after(async () => {
  live?.close();
  await disconnect?.();
  await mongo?.stop();
});
const api = (role = "agent") => ({
  post: (url, body) =>
    request(app)
      .post("/api" + url)
      .auth(tokens[role], { type: "bearer" })
      .send(body),
  get: (url) =>
    request(app)
      .get("/api" + url)
      .auth(tokens[role], { type: "bearer" }),
  delete: (url) =>
    request(app)
      .delete("/api" + url)
      .auth(tokens[role], { type: "bearer" }),
});
function snapshot(overrides = {}) {
  const now = Date.now();
  return {
    deviceId: randomUUID(),
    callId: randomUUID(),
    sequence: 2,
    userId: String(agent._id),
    state: "DISCONNECTED",
    phone: customer.phone,
    normalizedPhone: customer.phone,
    direction: "outgoing",
    startedAt: new Date(now - 60000).toISOString(),
    observedAt: new Date(now).toISOString(),
    connectedAt: new Date(now - 30000).toISOString(),
    endedAt: new Date(now - 5000).toISOString(),
    hadActive: true,
    durationSeconds: 25,
    disconnectCause: "LOCAL",
    leadId: String(lead._id),
    startTimeKnown: true,
    ...overrides,
  };
}
function report(overrides = {}) {
  return {
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    phone: customer.phone,
    leadId: String(lead._id),
    result: "interested",
    notes: "Requested a product overview.",
    ...overrides,
  };
}

test("Android call evidence is scoped, validates answer evidence, and ignores stale state", async () => {
  const event = snapshot();
  await api("admin")
    .post("/device/calls", { events: [event] })
    .expect(403);
  await api("other")
    .post("/device/calls", { events: [event] })
    .expect(403);
  await api()
    .post("/device/calls", { events: [{ ...event, connectedAt: null }] })
    .expect(400);
  const saved = (
    await api()
      .post("/device/calls", { events: [event] })
      .expect(200)
  ).body.items[0];
  const call = await models.Call.findById(saved.id);
  assert.equal(call.status, "completed");
  assert.equal(call.durationKnown, true);
  assert.equal(call.talkSeconds, 25);
  assert.equal(call.reportedAnswered, false);
  assert.equal(call.verification.method, "android-telecom");
  assert.ok(call.answeredAt);
  await api()
    .post("/device/calls", {
      events: [{ ...event, sequence: 1, state: "ACTIVE", endedAt: null }],
    })
    .expect(200);
  assert.equal(
    (await models.Call.findById(saved.id)).deviceState,
    "DISCONNECTED",
  );
  assert.equal(
    await models.Call.countDocuments({ deviceCallId: event.callId }),
    1,
  );
  const listed = await api("admin").get("/calls").expect(200);
  assert.ok(listed.body.items.some((item) => item._id === saved.id));
});
test("after-call save updates status, history and follow-up exactly once on retry", async () => {
  const event = snapshot(),
    input = report({
      result: "follow-up",
      followUpAt: new Date(Date.now() + 86400000).toISOString(),
      device: event,
    });
  const first = (await api().post("/call-results", input).expect(200)).body;
  const second = (await api().post("/call-results", input).expect(200)).body;
  assert.equal(first._id, second._id);
  assert.equal(second.businessSyncComplete, true);
  assert.equal(
    (await models.Lead.findById(lead._id)).status,
    "Follow-up Required",
  );
  assert.equal(
    await models.Activity.countDocuments({
      callId: first._id,
      type: "call.result",
    }),
    1,
  );
  assert.equal(
    await models.FollowUp.countDocuments({ sourceCallId: first._id }),
    1,
  );
  const history = (
    await api()
      .get("/customers/" + customer._id + "/history")
      .expect(200)
  ).body;
  assert.ok(history.calls.some((call) => call._id === first._id));
  await api()
    .post("/call-results", { ...input, reportId: randomUUID() })
    .expect(409);
});
test("business results never fabricate an answered call or duration without Telecom evidence", async () => {
  const saved = (
    await api()
      .post("/call-results", report({ result: "interested", talkSeconds: 120 }))
      .expect(200)
  ).body;
  assert.equal(saved.status, "unconfirmed");
  assert.equal(saved.reportedAnswered, false);
  assert.equal(saved.durationKnown, false);
  assert.ok(!saved.answeredAt);
  assert.ok(!saved.endedAt);
  assert.equal(saved.verification.method, "unverified");
});
test("no-answer Android evidence remains unconnected even with an Interested business result", async () => {
  const event = snapshot({
    hadActive: false,
    connectedAt: null,
    durationSeconds: null,
    disconnectCause: "MISSED",
  });
  const saved = (
    await api()
      .post("/call-results", report({ device: event }))
      .expect(200)
  ).body;
  assert.equal(saved.status, "no-answer");
  assert.ok(!saved.answeredAt);
  assert.equal(saved.durationKnown, false);
});
test("unknown numbers can become assigned leads from after-call results", async () => {
  const number = "+9779800000002";
  const saved = (
    await api()
      .post(
        "/call-results",
        report({
          phone: number,
          leadId: null,
          createLead: true,
          customerName: "New caller",
          result: "converted",
        }),
      )
      .expect(200)
  ).body;
  const created = await models.Lead.findById(saved.leadId);
  assert.equal(String(created.assignedAgentId), String(agent._id));
  assert.equal(created.status, "Converted");
  assert.equal(
    (await models.Customer.findById(created.customerId)).phone,
    number,
  );
  await api()
    .post(
      "/call-results",
      report({
        phone: "+9779800000003",
        leadId: null,
        result: "follow-up",
        followUpAt: new Date().toISOString(),
      }),
    )
    .expect(400);
});
test("live phone state distinguishes fresh Android evidence from unverified tasks", async () => {
  const event = snapshot({ state: "ACTIVE", endedAt: null, sequence: 1 });
  await api()
    .post("/device/calls", { events: [event] })
    .expect(200);
  const snapshotResponse = (await api("admin").get("/monitor").expect(200))
    .body;
  const row = snapshotResponse.items.find(
    (item) => item._id === String(agent._id),
  );
  assert.equal(row.phoneStateVerified, true);
  assert.match(row.status, /On call/);
  await api()
    .post("/device/calls", {
      events: [
        {
          ...event,
          state: "DISCONNECTED",
          endedAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          sequence: 2,
        },
      ],
    })
    .expect(200);
});
test("admins can remove leads while retaining call history and canceling pending follow-ups", async () => {
  const fresh = await models.Lead.create({
    companyId: agent.companyId,
    customerId: (
      await models.Customer.create({
        companyId: agent.companyId,
        fullName: "Deletion test",
        phone: "+9779800000004",
      })
    )._id,
    assignedAgentId: agent._id,
    status: "New",
  });
  await models.FollowUp.create({
    companyId: agent.companyId,
    leadId: fresh._id,
    customerId: fresh.customerId,
    assignedAgentId: agent._id,
    dueAt: new Date(),
  });
  await api()
    .delete("/leads/" + fresh._id)
    .expect(403);
  await api("admin")
    .delete("/leads/" + fresh._id)
    .expect(200);
  await api("admin")
    .get("/leads/" + fresh._id)
    .expect(404);
  assert.equal(
    (await models.FollowUp.findOne({ leadId: fresh._id })).status,
    "canceled",
  );
  assert.ok(await models.Lead.findById(fresh._id));
});

test("incoming ringing observation and explicit rejection retain Android evidence",async()=>{
 const incoming=snapshot({sequence:1,state:"RINGING",direction:"incoming",hadActive:false,connectedAt:null,endedAt:null,durationSeconds:null,disconnectCause:null});
 const first=await api().post("/device/calls",{events:[incoming]}).expect(200);
 const ended={...incoming,sequence:2,state:"DISCONNECTED",observedAt:new Date().toISOString(),endedAt:new Date().toISOString(),disconnectCause:"REJECTED"};
 await api().post("/device/calls",{events:[ended]}).expect(200);
 const saved=await models.Call.findById(first.body.items[0].id);
 assert.equal(saved.status,"canceled");assert.equal(saved.disconnectCause,"REJECTED");assert.equal(saved.ringingObservedAt.toISOString(),incoming.observedAt);assert.equal(saved.durationKnown,false);assert.equal(saved.answeredAt,null);
});
test("manual reports preserve a reported direction without asserting a telephone connection",async()=>{
 const response=await api().post("/call-results",report({direction:"incoming",result:"no-answer"})).expect(200);
 assert.equal(response.body.direction,"incoming");assert.equal(response.body.source,"sim");assert.equal(response.body.durationKnown,false);assert.equal(response.body.answeredAt,undefined);
});

