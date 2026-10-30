import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { DateTime } from "luxon";
import ExcelJS from "exceljs";
let mongo,
  db,
  m,
  app,
  live,
  users,
  tokens,
  companyId,
  customer,
  lead,
  campaignId;
const date = "2026-10-20",
  at = new Date(date + "T10:00:00+05:45");
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 120000, args: process.platform === "win32" ? [] : ["--nounixsocket"] },
  });
  db = await import("../config/database.js");
  await db.connectDatabase(mongo.getUri("reporting"));
  m = await import("../models/index.js");
  await m.ensureIndexes();
  const mongoose = (await import("mongoose")).default;
  companyId = new mongoose.Types.ObjectId();
  campaignId = new mongoose.Types.ObjectId();
  await m.Settings.create({
    _id: companyId,
    companyId,
    name: "Reporting test",
    timezone: "Asia/Kathmandu",
    rankingMinimumCalls: 1,
  });
  users = {};
  for (const [key, role, other] of [
    ["admin", "admin"],
    ["a", "agent"],
    ["b", "agent"],
    ["supervisor", "supervisor"],
    ["foreign", "agent", true],
  ])
    users[key] = await m.User.create({
      companyId: other ? new mongoose.Types.ObjectId() : companyId,
      fullName: key,
      email: key + "@reports.test",
      agentCode: key,
      role,
      passwordHash: "test-hash",
      ...(key === "supervisor"
        ? { supervisedAgentIds: [], assignedCampaignIds: [campaignId] }
        : {}),
    });
  users.supervisor.supervisedAgentIds = [users.a._id];
  await users.supervisor.save();
  customer = await m.Customer.create({
    companyId,
    fullName: "=Customer",
    phone: "+9779800010001",
  });
  lead = await m.Lead.create({
    companyId,
    customerId: customer._id,
    assignedAgentId: users.a._id,
    campaignId,
    status: "Interested",
  });
  const c2 = await m.Customer.create({
      companyId,
      fullName: "Second",
      phone: "+9779800010002",
    }),
    l2 = await m.Lead.create({
      companyId,
      customerId: c2._id,
      assignedAgentId: users.b._id,
      status: "New",
    });
  const make = async (key, overrides = {}) =>
    m.Call.create({
      companyId: users[key].companyId,
      agentId: users[key]._id,
      customerId: customer._id,
      leadId: lead._id,
      campaignId,
      phone: customer.phone,
      direction: "outgoing",
      source: "android-telecom",
      isDemo: false,
      status: "completed",
      active: false,
      deviceActive: false,
      deviceId: randomUUID(),
      deviceCallId: randomUUID(),
      initiatedAt: at,
      answeredAt: new Date(+at + 10000),
      endedAt: new Date(+at + 130000),
      deviceObservedAt: new Date(+at + 130000),
      durationKnown: true,
      talkSeconds: 120,
      reportKey: randomUUID(),
      businessSyncComplete: true,
      reportedAt: new Date(+at + 140000),
      businessResult: "converted",
      verification: { method: "android-telecom", startTimeKnown: true },
      ...overrides,
    });
  await make("a");
  await make("a", {
    direction: "incoming",
    status: "no-answer",
    answeredAt: null,
    durationKnown: false,
    talkSeconds: 0,
    businessResult: "no-answer",
  });
  await make("a", {
    durationKnown: false,
    talkSeconds: 999,
    businessResult: "busy",
  });
  await make("a", {
    source: "sim",
    deviceId: undefined,
    deviceCallId: undefined,
    verification: { method: "unverified" },
    reportedAnswered: true,
    talkSeconds: 999,
    durationKnown: true,
    businessResult: "interested",
  });
  await make("b", {
    customerId: c2._id,
    leadId: l2._id,
    phone: c2.phone,
    campaignId: undefined,
    talkSeconds: 600,
  });
  await make("foreign", { talkSeconds: 5000 });
  await m.FollowUp.create([
    {
      companyId,
      leadId: lead._id,
      customerId: customer._id,
      assignedAgentId: users.a._id,
      dueAt: at,
      notes: "A callback",
    },
    {
      companyId,
      leadId: l2._id,
      customerId: c2._id,
      assignedAgentId: users.b._id,
      dueAt: at,
    },
  ]);
  const config = {
    nodeEnv: "test",
    origins: [],
    jwtSecret: "reports-test-secret-is-long-enough-1234",
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
  tokens = Object.fromEntries(
    Object.entries(users).map(([key, user]) => [
      key,
      issueToken(user, config.jwtSecret),
    ]),
  );
});
after(async () => {
  live?.close();
  await db?.disconnectDatabase();
  await mongo?.stop();
});
const get = (role, path) =>
    request(app)
      .get("/api" + path)
      .auth(tokens[role], { type: "bearer" }),
  query = "?period=custom&from=" + date + "&to=" + date;
test("totals exclude manual/unknown durations and conversion denominator is saved results", async () => {
  const { body: d } = await get("admin", "/reports/overview" + query).expect(
    200,
  );
  assert.equal(d.summary.totalCalls, 4);
  assert.equal(d.summary.talkSeconds, 720);
  assert.equal(d.summary.averageSeconds, 360);
  assert.equal(d.summary.missed, 1);
  assert.equal(d.summary.manualReports, 1);
  assert.equal(d.summary.unknownDurations, 1);
  assert.equal(d.summary.converted, 2);
  assert.equal(d.summary.interested, 1);
  assert.equal(d.summary.pendingFollowUps, 2);
  const a = d.agents.find((a) => a._id === String(users.a._id));
  assert.equal(a.conversionRate, 25);
  assert.equal(a.reportedAttempts, 4);
  assert.equal(d.ranking.top, String(users.b._id));
  assert.equal(d.ranking.lowest, String(users.a._id));
  assert.equal(d.trends[0]._id, date);
  assert.equal(d.trends[0].totalCalls, 4);
});
test("supervisors report only assigned teams and campaigns", async () => {
  const { body: d } = await get(
    "supervisor",
    "/reports/overview" + query,
  ).expect(200);
  assert.equal(d.agents.length, 1);
  assert.equal(d.agents[0]._id, String(users.a._id));
  assert.equal(d.summary.totalCalls, 3);
  await get(
    "supervisor",
    "/reports/overview" + query + "&agentId=" + users.b._id,
  ).expect(403);
  const mongoose = (await import("mongoose")).default;
  await get(
    "supervisor",
    "/reports/overview" +
      query +
      "&campaignId=" +
      new mongoose.Types.ObjectId(),
  ).expect(403);
  await get(
    "supervisor",
    "/reports/overview" + query + "&campaignId=" + campaignId,
  ).expect(200);
  const records = await get("supervisor", "/reports/records" + query).expect(
    200,
  );
  assert.ok(
    records.body.items.every((c) => c.agentId._id === String(users.a._id)),
  );
  await get("supervisor", "/reports/daily").expect(403);
  await get("supervisor", "/operations/audit").expect(403);
});
test("agents own statistics and export access are enforced", async () => {
  const r = await get("a", "/reports/my-performance" + query).expect(200);
  assert.equal(r.body.agents.length, 1);
  assert.equal(r.body.summary.totalCalls, 3);
  await get(
    "a",
    "/reports/my-performance" + query + "&agentId=" + users.b._id,
  ).expect(403);
  await get("a", "/reports/overview" + query).expect(403);
  await get("a", "/reports/download" + query).expect(403);
  await request(app)
    .get("/api/reports/download" + query)
    .expect(401);
});
test("CSV and Excel exports contain scoped records and neutralize formulas", async () => {
  const csv = await get(
    "supervisor",
    "/reports/download" + query + "&format=csv",
  ).expect(200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.match(csv.text, /'=Customer/);
  assert.match(csv.text, /Android-observed/);
  assert.doesNotMatch(csv.text, /,Second,/);
  const response = await get(
    "admin",
    "/reports/download" + query + "&format=xlsx&type=agents",
  )
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  const sheet = workbook.getWorksheet("Agents");
  assert.equal(sheet.rowCount, 3);
  assert.ok(sheet.getRow(1).values.includes("conversionRate"));
  assert.ok(await m.Activity.findOne({ companyId, type: "report.exported" }));
});
test("all report types export and invalid ranges reject", async () => {
  for (const type of [
    "calls",
    "agents",
    "duration",
    "direction",
    "leads",
    "conversions",
    "callbacks",
    "recordings",
    "campaigns",
  ]) {
    const r = await get(
      "admin",
      "/reports/download" + query + "&type=" + type + "&format=csv",
    ).expect(200);
    assert.ok(r.text.length);
  }
  await get("admin", "/reports/overview?period=custom&from=bad&to=bad").expect(
    400,
  );
  await get(
    "admin",
    "/reports/overview?period=custom&from=2026-10-21&to=2026-10-20",
  ).expect(400);
  assert.equal(
    (await get("a", "/reports/catalog").expect(200)).body.reports.length,
    9,
  );
});
test("daily generation is concurrent-idempotent and no SMTP means no delivery", async () => {
  const daily = await import("../services/dailyReports.js"),
    reports = await Promise.all(
      Array.from({ length: 3 }, () =>
        daily.generateDailyReport(companyId, date, live),
      ),
    );
  assert.ok(reports.every((r) => String(r._id) === String(reports[0]._id)));
  const model = (await import("../models/operations.js")).DailyReport,
    report = await model.findOne({ companyId, date }).lean();
  assert.equal(await model.countDocuments({ companyId, date }), 1);
  assert.equal(report.status, "ready");
  assert.equal(report.email.status, "disabled");
  assert.equal(await daily.deliverDailyReport(report._id, { env: {} }), false);
  assert.equal(daily.smtpReadiness({}), false);
  await assert.rejects(
    () =>
      daily.generateDailyReport(
        companyId,
        DateTime.now().setZone("Asia/Kathmandu").toISODate(),
        live,
      ),
    /completed day/,
  );
});
test("configured daily email is claimed once with a test transport", async () => {
  const daily = await import("../services/dailyReports.js"),
    model = (await import("../models/operations.js")).DailyReport;
  await m.Settings.updateOne(
    { companyId },
    {
      $set: {
        dailyReportEmailEnabled: true,
        dailyReportEmails: ["admin@company.test"],
      },
    },
  );
  const report = await model.findOneAndUpdate(
      { companyId, date },
      { $set: { "email.status": "pending" } },
      { returnDocument: "after" },
    ),
    env = {
      SMTP_HOST: "smtp.company.test",
      SMTP_PORT: "587",
      SMTP_USER: "test",
      SMTP_PASSWORD: "not-a-real-credential",
      SMTP_FROM: "reports@company.test",
    };
  let sent = 0;
  const transport = {
    sendMail: async (message) => {
      sent++;
      assert.match(message.text, /Android-observed calls: 4/);
      assert.equal(message.to, "admin@company.test");
      return { messageId: "test-only" };
    },
  };
  const results = await Promise.all([
    daily.deliverDailyReport(report._id, { env, transport }),
    daily.deliverDailyReport(report._id, { env, transport }),
  ]);
  assert.equal(sent, 1);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await model.findById(report._id)).email.status, "sent");
});
test("composer audit does not claim delivery and opt-out blocks communication", async () => {
  const compose = () =>
    request(app)
      .post("/api/communications/compose")
      .auth(tokens.a, { type: "bearer" })
      .send({ leadId: String(lead._id), channel: "whatsapp", text: "Hello" });
  const result = await compose().expect(200);
  assert.equal(result.body.delivery, "unconfirmed");
  assert.match(result.body.url, /wa\.me\/977/);
  assert.equal(
    await m.Activity.countDocuments({ type: "communication.composer_opened" }),
    1,
  );
  await request(app)
    .post("/api/communications/compose")
    .auth(tokens.b, { type: "bearer" })
    .send({ leadId: String(lead._id), channel: "sms", text: "Hi" })
    .expect(404);
  await m.Customer.updateOne(
    { _id: customer._id },
    { $set: { doNotCall: true } },
  );
  await compose().expect(409);
});

test("only admins change validated calling/reporting rules and partial queue updates preserve other rules", async () => {
  const adminPut = (body) =>
    request(app)
      .put("/api/operations/settings")
      .auth(tokens.admin, { type: "bearer" })
      .send(body);
  const before = await m.Settings.findOne({ companyId }).lean();
  await adminPut({ powerDialer: { callDelaySeconds: 7 } }).expect(200);
  const saved = await m.Settings.findOne({ companyId }).lean();
  assert.equal(saved.powerDialer.callDelaySeconds, 7);
  assert.equal(
    saved.powerDialer.noAnswerRetryMinutes,
    before.powerDialer.noAnswerRetryMinutes,
  );
  await adminPut({ powerDialer: { callDelaySeconds: -1 } }).expect(400);
  await request(app)
    .put("/api/operations/settings")
    .auth(tokens.supervisor, { type: "bearer" })
    .send({ dailyReportEnabled: true })
    .expect(403);
});
