import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcrypt";
import ExcelJS from "exceljs";
let mongo,
  models,
  power,
  app,
  companyId,
  admin,
  agents,
  supervisor,
  tokens,
  disconnect;
const auth = (user) => ({
  Authorization: "Bearer " + tokens.get(String(user._id)),
});
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 120000, args: process.platform === "win32" ? [] : ["--nounixsocket"] },
  });
  const database = await import("../config/database.js");
  disconnect = database.disconnectDatabase;
  await database.connectDatabase(mongo.getUri("power_concurrency"));
  models = await import("../models/index.js");
  power = await import("../models/power.js");
  await models.ensureIndexes();
  const mongoose = (await import("mongoose")).default;
  companyId = new mongoose.Types.ObjectId();
  await models.Settings.create({
    _id: companyId,
    companyId,
    name: "Power tests",
    powerDialer: { callDelaySeconds: 0 },
  });
  const passwordHash = await bcrypt.hash("Concurrent-test-password-2026", 4);
  admin = await models.User.create({
    companyId,
    fullName: "Administrator",
    email: "admin@power.test",
    agentCode: "ADMIN",
    role: "admin",
    passwordHash,
  });
  agents = await models.User.create(
    Array.from({ length: 10 }, (_, i) => ({
      companyId,
      fullName: "Agent " + i,
      email: "agent" + i + "@power.test",
      agentCode: "AG" + i,
      role: "agent",
      passwordHash,
    })),
  );
  supervisor = await models.User.create({
    companyId,
    fullName: "Supervisor",
    email: "supervisor@power.test",
    agentCode: "SUP",
    role: "supervisor",
    supervisedAgentIds: agents.slice(0, 2).map((a) => a._id),
    passwordHash,
  });
  const config = {
    nodeEnv: "test",
    origins: [],
    jwtSecret: "power-tests-secret-longer-than-32-characters",
    callMode: "sim",
  };
  app = (await import("../app.js")).createApp({
    config,
    isDatabaseReady: async () => true,
  });
  const { issueToken } = await import("../middleware/auth.js");
  tokens = new Map(
    [admin, ...agents, supervisor].map((u) => [
      String(u._id),
      issueToken(u, config.jwtSecret),
    ]),
  );
});
after(async () => {
  await disconnect?.();
  await mongo?.stop();
});
test("ten agents authenticate concurrently with company-scoped sessions", async () => {
  const results = await Promise.all(
    agents.map((user) =>
      request(app)
        .post("/api/auth/login")
        .send({ email: user.email, password: "Concurrent-test-password-2026" }),
    ),
  );
  assert.equal(
    results.filter(
      (r) => r.status === 200 && r.body.token && r.body.user.role === "agent",
    ).length,
    10,
  );
  const leaked = await request(app)
    .post("/api/users")
    .set(auth(agents[0]))
    .send({});
  assert.equal(leaked.status, 403);
});
test("ten simultaneous agents cannot reserve the same normalized number", async () => {
  const numbers = [
    "9851239227",
    "+9779851239227",
    "9779851239227",
    "009779851239227",
    "985 123 9227",
  ];
  const results = await Promise.all(
    agents.map((user, i) =>
      request(app)
        .post("/api/power/reserve")
        .set(auth(user))
        .send({ phone: numbers[i % numbers.length], requestId: randomUUID() }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  assert.equal(
    await power.DialerReservation.countDocuments({
      companyId,
      phone: "+9779851239227",
      active: true,
    }),
    1,
  );
  const winner = results.findIndex((r) => r.status === 200),
    reservation = results[winner].body.reservation,
    attemptId = randomUUID();
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app)
        .post("/api/power/attempt")
        .set(auth(agents[winner]))
        .send({ reservationId: reservation._id, attemptId }),
    ),
  );
  assert.equal(
    attempts.filter((r) => r.body.dialAuthorized === true).length,
    1,
  );
  assert.equal(
    attempts.every((r) => r.status === 200),
    true,
  );
  const paused = await request(app)
    .post("/api/power/control")
    .set(auth(agents[winner]))
    .send({ sessionId: reservation.sessionId, action: "stop" });
  assert.equal(paused.status, 200);
  assert.equal(
    await power.DialerReservation.countDocuments({
      _id: reservation._id,
      active: true,
    }),
    1,
  );
  const report = {
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    phone: "+9779851239227",
    result: "do-not-call",
    notes: "Customer asked us to stop calling",
    reservationId: reservation._id,
    sessionId: reservation.sessionId,
    attemptId,
  };
  const saved = await request(app)
    .post("/api/call-results")
    .set(auth(agents[winner]))
    .send(report);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.status, "unconfirmed");
  assert.equal(saved.body.durationKnown, false);
  assert.equal(saved.body.answeredAt, undefined);
  assert.equal(
    (
      await request(app)
        .post("/api/call-results")
        .set(auth(agents[winner]))
        .send(report)
    ).status,
    200,
  );
  assert.equal(
    await models.Call.countDocuments({ reportKey: report.reportId }),
    1,
  );
  assert.equal(
    await power.DialerReservation.countDocuments({
      _id: reservation._id,
      active: true,
    }),
    0,
  );
  const blocked = await request(app)
    .post("/api/power/reserve")
    .set(auth(agents[(winner + 1) % 10]))
    .send({ phone: "9851239227", requestId: randomUUID() });
  assert.equal(blocked.status, 409);
});
test("unused leases expire; attempted leases remain protected for explicit reconciliation", async () => {
  const number = "+9779841239001";
  let response = await request(app)
    .post("/api/power/reserve")
    .set(auth(agents[0]))
    .send({ phone: number, requestId: randomUUID() });
  // An earlier race may have left this agent with no active reservation; all completed winner cases are safe.
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const first = response.body.reservation;
  await power.DialerReservation.updateOne(
    { _id: first._id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  response = await request(app)
    .post("/api/power/reserve")
    .set(auth(agents[1]))
    .send({ phone: number, requestId: randomUUID() });
  assert.equal(response.status, 200);
  assert.notEqual(response.body.reservation._id, first._id);
  const second = response.body.reservation,
    attemptId = randomUUID();
  assert.equal(
    (
      await request(app)
        .post("/api/power/attempt")
        .set(auth(agents[1]))
        .send({ reservationId: second._id, attemptId })
    ).status,
    200,
  );
  await power.DialerReservation.updateOne(
    { _id: second._id },
    {
      $set: {
        expiresAt: new Date(Date.now() - 86400000),
        lastHeartbeatAt: new Date(0),
      },
    },
  );
  await request(app).get("/api/power/session").set(auth(agents[2]));
  assert.equal(
    await power.DialerReservation.countDocuments({
      _id: second._id,
      active: true,
    }),
    1,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/power/review-release")
        .set(auth(admin))
        .send({
          reservationId: second._id,
          confirmPhoneIdle: true,
          reason: "Physical phone checked idle by supervisor",
        })
    ).status,
    200,
  );
});
test("campaigns, normalized Excel import preview, duplicate detection and bulk ownership work", async () => {
  const campaign = await request(app)
    .post("/api/campaigns")
    .set(auth(admin))
    .send({
      name: "Cleaning renewals",
      agentIds: [String(agents[3]._id)],
      supervisorIds: [String(supervisor._id)],
    });
  assert.equal(campaign.status, 201, JSON.stringify(campaign.body));
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Contacts");
  sheet.addRow(["Full Name", "Phone", "Service Type", "Service Notes"]);
  sheet.addRow(["Office cleaning", "9841239002", "Office", "Weekday cleaning"]);
  sheet.addRow(["Duplicate office", "+9779841239002", "Office", "Duplicate"]);
  const xlsxBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
    "base64",
  );
  const body = {
    xlsxBase64,
    preview: true,
    campaignId: campaign.body._id,
    assignedAgentId: String(agents[3]._id),
  };
  const preview = await request(app)
    .post("/api/leads/import")
    .set(auth(admin))
    .send(body);
  assert.equal(preview.status, 200);
  assert.deepEqual(
    preview.body.results.map((x) => x.status),
    ["ready", "duplicate"],
  );
  assert.equal(
    await models.Customer.countDocuments({ phone: "+9779841239002" }),
    0,
  );
  const csvPreview = await request(app)
    .post("/api/leads/import")
    .set(auth(admin))
    .send({
      preview: true,
      csv: "Full Name,Phone,Assigned Agent Id,Campaign Id\nCSV New,9841239333,,\nInvalid Nepal,+9771234567,,",
    });
  assert.equal(csvPreview.status, 200);
  assert.deepEqual(
    csvPreview.body.results.map((item) => item.status),
    ["ready", "invalid"],
  );
  const imported = await request(app)
    .post("/api/leads/import")
    .set(auth(admin))
    .send({ ...body, preview: false });
  assert.equal(imported.status, 200);
  assert.deepEqual(
    imported.body.results.map((x) => x.status),
    ["created", "duplicate"],
  );
  const lead = await models.Lead.findById(imported.body.results[0].id).populate(
    "customerId",
  );
  assert.equal(lead.customerId.serviceType, "Office");
  assert.equal(String(lead.campaignId), campaign.body._id);
  const again = await request(app)
    .post("/api/leads/import")
    .set(auth(admin))
    .send({ ...body, preview: false });
  assert.equal(
    again.body.results.every((x) => x.status === "duplicate"),
    true,
  );
  const started = await request(app)
    .post("/api/power/start")
    .set(auth(agents[3]))
    .send({ sessionId: randomUUID(), campaignId: campaign.body._id });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.queue[0].leadId, String(lead._id));
  const next = await request(app)
    .post("/api/power/next")
    .set(auth(agents[3]))
    .send({
      sessionId: started.body.session.sessionId,
      requestId: randomUUID(),
    });
  assert.equal(next.status, 200);
  const refused = await request(app)
    .post("/api/leads/bulk-assign")
    .set(auth(admin))
    .send({ leadIds: [String(lead._id)], agentId: String(agents[4]._id) });
  assert.equal(refused.body.results[0].status, "failed");
  assert.match(refused.body.results[0].message, /reserved|called/);
  await request(app)
    .post("/api/power/control")
    .set(auth(agents[3]))
    .send({ sessionId: started.body.session.sessionId, action: "stop" });
  const reassigned = await request(app)
    .post("/api/leads/bulk-assign")
    .set(auth(admin))
    .send({ leadIds: [String(lead._id)], agentId: String(agents[4]._id) });
  assert.equal(reassigned.body.results[0].status, "assigned");
});
test("ten agents atomically claim distinct contacts from a shared campaign pool and respect delay", async () => {
  const campaign = await request(app)
    .post("/api/campaigns")
    .set(auth(admin))
    .send({
      name: "Shared campaign pool",
      agentIds: agents.map((a) => String(a._id)),
      supervisorIds: [String(supervisor._id)],
    });
  assert.equal(campaign.status, 201);
  const customers = await models.Customer.create(
    Array.from({ length: 10 }, (_, i) => ({
      companyId,
      fullName: "Pool " + i,
      phone: "+97798412392" + String(i).padStart(2, "0"),
    })),
  );
  const leads = await models.Lead.create(
    customers.map((c) => ({
      companyId,
      customerId: c._id,
      campaignId: campaign.body._id,
      status: "New",
    })),
  );
  const sessions = await Promise.all(
    agents.map((a) =>
      request(app)
        .post("/api/power/start")
        .set(auth(a))
        .send({ sessionId: randomUUID(), campaignId: campaign.body._id }),
    ),
  );
  assert.equal(
    sessions.every(
      (r) =>
        r.status === 200 && r.body.session.campaignId === campaign.body._id,
    ),
    true,
    JSON.stringify(sessions.map((r) => ({ status: r.status, body: r.body }))),
  );
  const reserved = await Promise.all(
    agents.map((a, i) =>
      request(app).post("/api/power/next").set(auth(a)).send({
        sessionId: sessions[i].body.session.sessionId,
        requestId: randomUUID(),
      }),
    ),
  );
  assert.equal(
    reserved.every((r) => r.status === 200 && r.body.reservation),
    true,
  );
  assert.equal(new Set(reserved.map((r) => r.body.reservation.phone)).size, 10);
  assert.equal(
    await models.Lead.countDocuments({
      _id: { $in: leads.map((l) => l._id) },
      assignedAgentId: { $in: agents.map((a) => a._id) },
    }),
    10,
  );
  await models.Settings.updateOne(
    { companyId },
    { $set: { "powerDialer.callDelaySeconds": 120 } },
  );
  // A real saved result from this agent is the only delay anchor; no call metadata is fabricated.
  const actor = agents[0],
    session = sessions[0].body.session;
  await power.DialerReservation.create({
    companyId,
    agentId: actor._id,
    sessionId: randomUUID(),
    requestId: randomUUID(),
    phone: "+9779841239999",
    state: "completed",
    active: false,
    releasedAt: new Date(),
    result: "busy",
  });
  const blocked = await request(app)
    .post("/api/power/attempt")
    .set(auth(actor))
    .send({
      reservationId: reserved[0].body.reservation._id,
      attemptId: randomUUID(),
    });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error?.message || blocked.body.message, /Wait/);
  await models.Settings.updateOne(
    { companyId },
    { $set: { "powerDialer.callDelaySeconds": 0 } },
  );
  await Promise.all(
    agents.map((a, i) =>
      request(app).post("/api/power/control").set(auth(a)).send({
        sessionId: sessions[i].body.session.sessionId,
        action: "stop",
      }),
    ),
  );
  const outside = await request(app)
    .post("/api/leads/bulk-assign")
    .set(auth(supervisor))
    .send({ leadIds: [String(leads[0]._id)], agentId: String(agents[5]._id) });
  assert.equal(outside.status, 200);
  assert.equal(outside.body.results[0].status, "failed");
});
test("supervisor sees only assigned team customers, calls and campaigns; backend rejects management escalation", async () => {
  const customers = await models.Customer.create(
    [0, 5].map((i) => ({
      companyId,
      fullName: "Team customer " + i,
      phone: "+97798412391" + String(i).padStart(2, "0"),
    })),
  );
  const leads = await models.Lead.create(
    customers.map((c, i) => ({
      companyId,
      customerId: c._id,
      assignedAgentId: agents[i === 0 ? 0 : 5]._id,
      status: "Assigned",
    })),
  );
  const calls = await models.Call.create(
    customers.map((c, i) => ({
      companyId,
      customerId: c._id,
      leadId: leads[i]._id,
      agentId: agents[i === 0 ? 0 : 5]._id,
      phone: c.phone,
      direction: "outgoing",
      source: "sim",
      isDemo: false,
      active: false,
      status: "unconfirmed",
    })),
  );
  const visible = await request(app).get("/api/leads").set(auth(supervisor));
  assert.equal(visible.status, 200);
  assert.equal(
    visible.body.items.some((l) => l._id === String(leads[0]._id)),
    true,
  );
  assert.equal(
    visible.body.items.some((l) => l._id === String(leads[1]._id)),
    false,
  );
  assert.equal(
    (
      await request(app)
        .get("/api/customers/" + customers[1]._id)
        .set(auth(supervisor))
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .get("/api/calls/" + calls[1]._id)
        .set(auth(supervisor))
    ).status,
    404,
  );
  const users = await request(app).get("/api/users").set(auth(supervisor));
  assert.equal(users.status, 200);
  assert.equal(users.body.items.length, 2);
  assert.equal(
    (
      await request(app)
        .get("/api/users/" + agents[5]._id)
        .set(auth(supervisor))
    ).status,
    404,
  );
  assert.equal(
    (await request(app).post("/api/users").set(auth(supervisor)).send({}))
      .status,
    403,
  );
  assert.equal(
    (await request(app).get("/api/campaigns").set(auth(supervisor))).body.items
      .length,
    2,
  );
  const team = await request(app)
    .put("/api/users/" + supervisor._id + "/team")
    .set(auth(admin))
    .send({ agentIds: [String(agents[0]._id)], campaignIds: [] });
  assert.equal(team.status, 200);
  assert.equal(
    (await request(app).get("/api/leads").set(auth(supervisor))).status,
    401,
  );
});

test("concurrent callback creation keeps one pending reminder for a lead", async () => {
  const customer = await models.Customer.create({
    companyId,
    fullName: "Callback concurrency",
    phone: "+9779841239444",
  });
  const lead = await models.Lead.create({
    companyId,
    customerId: customer._id,
    assignedAgentId: agents[7]._id,
    status: "Assigned",
  });
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app)
        .post("/api/follow-ups")
        .set(auth(agents[7]))
        .send({
          leadId: String(lead._id),
          dueAt: new Date(Date.now() + 3600000).toISOString(),
          notes: "Customer requested a callback",
        }),
    ),
  );
  assert.equal(
    responses.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(responses.map((r) => ({ status: r.status, body: r.body }))),
  );
  assert.equal(responses.filter((r) => r.status === 409).length, 9);
  assert.equal(
    await models.FollowUp.countDocuments({
      leadId: lead._id,
      status: "pending",
    }),
    1,
  );
});
