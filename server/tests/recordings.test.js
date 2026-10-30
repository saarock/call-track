import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase, disconnectDatabase } from "../config/database.js";

let issueToken, createApp, expireRecordings;
let mongo,
  models,
  app,
  config,
  directory,
  admin,
  agent,
  other,
  supervisor,
  call,
  tokens,
  audio,
  recording;
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 120000, args: process.platform === "win32" ? [] : ["--nounixsocket"] },
  });
  await connectDatabase(mongo.getUri("recording_storage_test"));
  models = await import("../models/index.js");
  await models.ensureIndexes();
  ({ issueToken } = await import("../middleware/auth.js"));
  ({ createApp } = await import("../app.js"));
  ({ expireRecordings } = await import("../routes/recordingRoutes.js"));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "calltrack-recording-"));
  const mongoose = (await import("mongoose")).default,
    companyId = new mongoose.Types.ObjectId();
  await models.Settings.create({
    _id: companyId,
    companyId,
    name: "Recording storage test",
    recordingEnabled: false,
  });
  const users = await models.User.create(
    ["admin", "agent", "agent", "supervisor"].map((role, i) => ({
      companyId,
      fullName: "Recording test " + i,
      email: i + "@recording.test",
      agentCode: "R" + i,
      role,
      passwordHash: "test-placeholder-not-a-real-login",
    })),
  );
  [admin, agent, other, supervisor] = users;
  supervisor.supervisedAgentIds = [other._id];
  await supervisor.save();
  const customer = await models.Customer.create({
    companyId,
    fullName: "Storage fixture customer",
    phone: "+9779800000005",
  });
  const lead = await models.Lead.create({
    companyId,
    customerId: customer._id,
    assignedAgentId: agent._id,
  });
  call = await models.Call.create({
    companyId,
    agentId: agent._id,
    customerId: customer._id,
    leadId: lead._id,
    phone: customer.phone,
    source: "sim",
    direction: "outgoing",
    status: "unconfirmed",
    active: false,
    reportKey: randomUUID(),
    isDemo: false,
    initiatedAt: new Date(),
  });
  config = {
    nodeEnv: "test",
    jwtSecret: "recording-storage-test-secret-at-least-32-characters",
    callMode: "sim",
    recordingEncryptionKey: randomBytes(32).toString("hex"),
    recordingDirectory: directory,
  };
  app = createApp({ config, isDatabaseReady: () => true });
  tokens = users.map((user) => issueToken(user, config.jwtSecret));
  const media = "C:/Windows/Media";
  if (fs.existsSync(media)) {
    const file = fs
      .readdirSync(media)
      .find((name) => name.toLowerCase().endsWith(".wav"));
    if (file) audio = fs.readFileSync(path.join(media, file));
  }
});
after(async () => {
  await disconnectDatabase();
  await mongo?.stop();
  if (
    directory &&
    path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)
  )
    fs.rmSync(directory, { recursive: true, force: true });
});
const api = (token = tokens[0]) => ({
  get: (p) =>
    request(app)
      .get("/api" + p)
      .auth(token, { type: "bearer" }),
  put: (p, b) =>
    request(app)
      .put("/api" + p)
      .auth(token, { type: "bearer" })
      .send(b),
});
const upload = (bytes, id = randomUUID(), target = app, token = tokens[1]) =>
  request(target)
    .post("/api/recordings/attachments")
    .query({
      callId: String(call._id),
      uploadId: id,
      consent: "confirmed",
      name: "OS notification audio fixture.wav",
    })
    .auth(token, { type: "bearer" })
    .set("Content-Type", "application/octet-stream")
    .send(bytes);
test("recording settings require admin authorization; unavailable native capture is never claimed", async () => {
  assert.equal(
    (
      await api(tokens[1]).put("/recordings/config", {
        enabled: true,
        retentionDays: 30,
      })
    ).status,
    403,
  );
  const initial = await api().get("/recordings/config");
  assert.equal(initial.body.enabled, false);
  assert.equal(initial.body.automaticSimRecording, false);
  assert.equal(
    (
      await api().put("/recordings/config", {
        enabled: true,
        retentionDays: 30,
      })
    ).status,
    200,
  );
});
test("authorized real audio is encrypted, associated once and retrieved with access audit", async (t) => {
  if (!audio)
    return t.skip(
      "No existing OS audio fixture on this host; not a SIM recording test.",
    );
  const id = randomUUID(),
    response = await upload(audio, id);
  assert.equal(response.status, 201, response.text);
  recording = response.body;
  assert.equal(recording.source, "agent-upload");
  assert.equal(recording.status, "available");
  assert.equal(recording.storageKey, undefined);
  assert(recording.durationSeconds > 0);
  assert.equal((await upload(audio, id)).status, 200);
  const altered=Buffer.from(audio);altered[altered.length-1]^=1;assert.equal((await upload(altered,id)).status,409);
  const report=await api().get("/reports/records?period=today");assert.equal(report.status,200);assert.equal(report.body.items.find(row=>row._id===String(call._id)).recordingAvailable,true);
  assert.equal(await models.Recording.countDocuments({ callId: call._id }), 1);
  const disk = fs.readFileSync(path.join(directory, recording._id + ".ctrec"));
  assert(!disk.equals(audio));
  assert.notEqual(disk.toString("ascii", 0, 4), "RIFF");
  const retrieved = await api()
    .get("/recordings/" + recording._id + "/media?download=1")
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(retrieved.status, 200);
  assert.deepEqual(retrieved.body, audio);
  assert.match(retrieved.headers["cache-control"], /no-store/);
  assert.equal(
    await models.Activity.countDocuments({
      callId: call._id,
      type: "recording.downloaded",
    }),
    1,
  );
  const untouched = await models.Call.findById(call._id);
  assert.equal(untouched.status, "unconfirmed");
  assert.equal(untouched.durationKnown, false);
  assert.equal(untouched.answeredAt, undefined);
});
test("recording retrieval and metadata are scoped to the current agent/supervisor", async (t) => {
  if (!recording) return t.skip("Requires real OS audio fixture.");
  for (const token of [tokens[2], tokens[3]]) {
    assert.equal(
      (await api(token).get("/recordings/" + recording._id + "/media")).status,
      404,
    );
    assert.equal((await api(token).get("/recordings")).body.total, 0);
  }
  assert.equal((await api(tokens[1]).get("/recordings")).body.total, 1);
});
test("non-audio uploads and omitted consent are rejected without storing a recording", async () => {
  assert.equal((await upload(Buffer.alloc(300, 65))).status, 415);
  const result = await request(app)
    .post("/api/recordings/attachments")
    .query({ callId: String(call._id), uploadId: randomUUID() })
    .auth(tokens[1], { type: "bearer" })
    .set("Content-Type", "application/octet-stream")
    .send(Buffer.alloc(300));
  assert.equal(result.status, 400);
});
test("failed storage upload retries with the same identity and retention removes real encrypted files", async (t) => {
  if (!audio) return t.skip("Requires real OS audio fixture.");
  const id = randomUUID(),
    block = path.join(directory, "blocked");
  fs.writeFileSync(block, "not-a-directory");
  const broken = createApp({
    config: { ...config, recordingDirectory: block },
    isDatabaseReady: () => true,
  });
  assert.equal((await upload(audio, id, broken)).status, 500);
  const failed = await models.Recording.findOne({
    providerRecordingSid: "upload:" + agent.companyId + ":" + id,
  });
  assert.equal(failed.status, "failed");
  const retried = await upload(audio, id);
  assert.equal(retried.status, 201, retried.text);
  assert.equal(retried.body._id, String(failed._id));
  await models.Recording.updateOne(
    { _id: failed._id },
    { $set: { expiresAt: new Date(0) } },
  );
  await expireRecordings(config);
  assert.equal((await models.Recording.findById(failed._id)).status, "deleted");
  assert.equal(
    fs.existsSync(path.join(directory, failed._id + ".ctrec")),
    false,
  );
  assert.equal(
    (await api().get("/recordings/" + failed._id + "/media")).status,
    410,
  );
});
