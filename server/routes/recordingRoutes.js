import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Recording, Call, Settings } from "../models/index.js";
import {
  own,
  tenant,
  objectId,
  id,
  fail,
  page,
  escapeRegex,
} from "../utils/http.js";
import { admin } from "../middleware/auth.js";
import { audit, changed } from "../services/events.js";
const MAX_BYTES = 20 * 1024 * 1024;
export function inspectAudio(data) {
  if (!Buffer.isBuffer(data) || data.length < 128)
    throw fail(415, "Choose a supported audio file, not an empty recording.");
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WAVE"
  ) {
    let format,
      rate,
      bytes = 0;
    for (let at = 12; at + 8 <= data.length;) {
      const kind = data.toString("ascii", at, at + 4),
        length = data.readUInt32LE(at + 4);
      if (at + 8 + length > data.length)
        throw fail(415, "The WAV file is incomplete.");
      if (kind === "fmt " && length >= 16) {
        format = data.readUInt16LE(at + 8);
        rate = data.readUInt32LE(at + 16);
      }
      if (kind === "data") bytes += length;
      at += 8 + length + (length % 2);
    }
    if (![1, 3, 6, 7, 65534].includes(format) || !rate || !bytes)
      throw fail(415, "This WAV audio format is not supported.");
    return {
      mimeType: "audio/wav",
      durationSeconds: bytes / rate,
      durationKnown: true,
    };
  }
  const head = data.subarray(0, 512).toString("latin1");
  if (
    data.toString("ascii", 0, 4) === "OggS" &&
    (head.includes("OpusHead") || head.includes("vorbis"))
  )
    return { mimeType: "audio/ogg", durationKnown: false };
  if (
    data.toString("ascii", 4, 8) === "ftyp" &&
    (data.includes(Buffer.from("mdat")) || data.includes(Buffer.from("moov")))
  )
    return { mimeType: "audio/mp4", durationKnown: false };
  if (data.readUInt32BE(0) === 0x1a45dfa3 && head.includes("webm"))
    return { mimeType: "audio/webm", durationKnown: false };
  let offset = 0;
  if (data.toString("ascii", 0, 3) === "ID3") {
    if (data.length < 10) throw fail(415, "Incomplete MP3 file.");
    offset =
      10 +
      ((data[6] & 127) << 21) +
      ((data[7] & 127) << 14) +
      ((data[8] & 127) << 7) +
      (data[9] & 127);
  }
  for (let n = offset; n < Math.min(data.length - 4, offset + 4096); n++)
    if (
      data[n] === 255 &&
      (data[n + 1] & 224) === 224 &&
      ((data[n + 1] >> 1) & 3) !== 0 &&
      ((data[n + 2] >> 4) & 15) > 0 &&
      ((data[n + 2] >> 4) & 15) < 15 &&
      ((data[n + 2] >> 2) & 3) < 3
    )
      return { mimeType: "audio/mpeg", durationKnown: false };
  throw fail(415, "Supported audio files: WAV, MP3, M4A, Ogg or WebM.");
}
function storage(config) {
  const key = Object.hasOwn(config, "recordingEncryptionKey")
    ? config.recordingEncryptionKey
    : process.env.RECORDING_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || ""))
    throw fail(503, "Private recording storage is not configured.");
  const directory = path.resolve(
    config.recordingDirectory ||
      process.env.RECORDING_DIRECTORY ||
      "private-recordings",
  );
  const web = config.webDirectory && path.resolve(config.webDirectory);
  if (web && (directory === web || directory.startsWith(web + path.sep)))
    throw fail(
      503,
      "Recording storage must be outside the public web directory.",
    );
  return { directory, key: Buffer.from(key, "hex") };
}
const publicRecord = (r) => {
  const o = r.toObject ? r.toObject() : { ...r };
  for (const key of [
    "storageKey",
    "encryptionIv",
    "encryptionTag",
    "sha256",
    "uploadLeaseUntil",
    "providerRecordingSid",
  ])
    delete o[key];
  return o;
};
async function callFor(req, value) {
  const call = await Call.findOne({
    _id: objectId(value),
    ...own(req),
    isDemo: false,
  });
  if (!call) throw fail(404, "Call not found");
  return call;
}
function fileFor(directory, key) {
  if (!/^[a-f0-9]{24}\.ctrec$/.test(key || ""))
    throw fail(404, "Recording file is unavailable.");
  return path.join(directory, key);
}
export function recordingRoutes(config) {
  const r = Router();
  r.get("/recordings/config", async (req, res) => {
    const settings = await Settings.findOne(tenant(req));
    let configured = false;
    try {
      storage(config);
      configured = true;
    } catch {}
    res.json({
      enabled: Boolean(settings.recordingEnabled),
      retentionDays: settings.retentionDays,
      storageConfigured: configured,
      automaticSimRecording: false,
      maxBytes: MAX_BYTES,
      source: "authorized-existing-audio-file",
    });
  });
  r.put("/recordings/config", admin, async (req, res) => {
    const data = z
      .object({
        enabled: z.boolean(),
        retentionDays: z.number().int().min(1).max(365),
      })
      .parse(req.body);
    if (data.enabled) storage(config);
    await Settings.updateOne(tenant(req), {
      $set: {
        recordingEnabled: data.enabled,
        retentionDays: data.retentionDays,
      },
    });
    await audit(req, "recording.settings.changed", {}, data);
    changed(req);
    res.json({ enabled: data.enabled, retentionDays: data.retentionDays });
  });
  r.get("/recordings", async (req, res) => {
    const paging = page(req),
      filter = { ...own(req), isDemo: false };
    if (req.query.agentId) {
      const requested = objectId(req.query.agentId);
      if (
        req.user.role === "agent" &&
        String(requested) !== String(req.user._id)
      )
        throw fail(403, "Agent access denied");
      if (
        req.user.role === "supervisor" &&
        !(req.user.supervisedAgentIds || []).some(
          (v) => String(v) === String(requested),
        )
      )
        throw fail(403, "Agent access denied");
      filter.agentId = requested;
    }
    if (req.query.phone)
      filter.phone = new RegExp(escapeRegex(req.query.phone), "i");
    if (req.query.callId) filter._id = objectId(req.query.callId);
    if (req.query.campaignId)
      filter.campaignId = objectId(req.query.campaignId);
    if (req.query.from || req.query.to) {
      const from = req.query.from && new Date(req.query.from),
        to = req.query.to && new Date(req.query.to);
      if (
        (from && !Number.isFinite(+from)) ||
        (to && !Number.isFinite(+to)) ||
        (from && to && from >= to)
      )
        throw fail(400, "Invalid date range");
      filter.initiatedAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lt: to } : {}),
      };
    }
    const callIds = await Call.find(filter).distinct("_id");
    const query = {
      ...tenant(req),
      callId: { $in: callIds },
      source: "agent-upload",
    };
    if (req.query.status)
      query.status = z
        .enum(["available", "failed", "processing", "deleted"])
        .parse(req.query.status);
    const [items, total] = await Promise.all([
      Recording.find(query)
        .sort({ createdAt: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .populate({
          path: "callId",
          populate: [
            { path: "agentId", select: "fullName agentCode" },
            { path: "customerId", select: "fullName" },
          ],
        })
        .lean(),
      Recording.countDocuments(query),
    ]);
    res.json({
      items: items.map(publicRecord),
      total,
      page: paging.page,
      hasMore: paging.skip + items.length < total,
    });
  });
  const limit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) =>
      String(req.user.companyId) + ":" + String(req.user._id),
  });
  r.post(
    "/recordings/attachments",
    limit,
    raw({ type: "application/octet-stream", limit: MAX_BYTES }),
    async (req, res) => {
      const data = z
        .object({
          callId: id,
          uploadId: z.string().uuid(),
          consent: z.literal("confirmed"),
          name: z.string().max(160).optional(),
        })
        .parse(req.query);
      const call = await callFor(req, data.callId);
      if (call.deviceActive)
        throw fail(
          409,
          "Finish the phone call before attaching its recording.",
        );
      const settings = await Settings.findOne(tenant(req));
      if (!settings.recordingEnabled)
        throw fail(
          409,
          "An administrator must enable consented recording attachments first.",
        );
      const store = storage(config),
        audio = inspectAudio(req.body),
        hash = createHash("sha256").update(req.body).digest("hex");
      const identity = "upload:" + req.user.companyId + ":" + data.uploadId;
      let record = await Recording.findOne({
        ...tenant(req),
        providerRecordingSid: identity,
      }).select("+sha256 +uploadLeaseUntil");
      if (record) {
        if (
          String(record.callId) !== String(call._id) ||
          record.sha256 !== hash
        )
          throw fail(
            409,
            "Upload identity belongs to a different file or call.",
          );
        if (record.status === "available")
          return res.json(publicRecord(record));
        if (record.status === "deleted")
          throw fail(410, "This recording was deleted.");
      }
      if (!record) {
        try {
          record = await Recording.create({
            ...tenant(req),
            callId: call._id,
            agentId: call.agentId,
            providerRecordingSid: identity,
            source: "agent-upload",
            status: "failed",
            sha256: hash,
            uploadedBy: req.user._id,
            originalName: path.basename(data.name || "Recording").slice(0, 160),
            mimeType: audio.mimeType,
            bytes: req.body.length,
            durationSeconds: audio.durationSeconds || 0,
            durationKnown: audio.durationKnown,
            consentAt: new Date(),
            consentBy: req.user._id,
            expiresAt: new Date(Date.now() + settings.retentionDays * 86400000),
          });
        } catch (e) {
          if (e.code === 11000)
            throw fail(
              409,
              "This file upload is already being processed. Retry shortly.",
            );
          throw e;
        }
      }
      const locked = await Recording.findOneAndUpdate(
        {
          _id: record._id,
          status: { $in: ["failed", "processing"] },
          $or: [
            { uploadLeaseUntil: null },
            { uploadLeaseUntil: { $lte: new Date() } },
          ],
        },
        {
          $set: {
            status: "processing",
            uploadLeaseUntil: new Date(Date.now() + 120000),
            failureReason: null,
          },
        },
        { returnDocument: "after" },
      );
      if (!locked)
        throw fail(
          409,
          "This file upload is already being processed. Retry shortly.",
        );
      const key = String(record._id) + ".ctrec",
        target = fileFor(store.directory, key),
        temp = target + ".part";
      try {
        await fs.mkdir(store.directory, { recursive: true, mode: 0o700 });
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", store.key, iv),
          encrypted = Buffer.concat([cipher.update(req.body), cipher.final()]);
        await fs.writeFile(temp, encrypted, { mode: 0o600 });
        await fs.rename(temp, target);
        await audit(
          req,
          "recording.attached",
          {
            callId: call._id,
            leadId: call.leadId,
            customerId: call.customerId,
          },
          {
            recordingId: String(record._id),
            source: "agent-upload",
            consentConfirmed: true,
          },
        );
        record = await Recording.findByIdAndUpdate(
          record._id,
          {
            $set: {
              status: "available",
              storageKey: key,
              encryptionIv: iv.toString("hex"),
              encryptionTag: cipher.getAuthTag().toString("hex"),
              uploadLeaseUntil: null,
              failureReason: null,
            },
          },
          { returnDocument: "after" },
        );
        changed(req);
        res.status(201).json(publicRecord(record));
      } catch (e) {
        await Recording.updateOne(
          { _id: record._id },
          {
            $set: {
              status: "failed",
              uploadLeaseUntil: null,
              failureReason: "Private upload failed; retry the same file.",
            },
          },
        );
        await fs.unlink(temp).catch(() => {});
        throw fail(
          500,
          "Private recording upload failed. Your device copy can be retried.",
        );
      }
    },
  );
  r.get("/recordings/:id/media", async (req, res) => {
    const record = await Recording.findOne({
      _id: objectId(req.params.id),
      ...tenant(req),
      source: "agent-upload",
    }).select("+storageKey +encryptionIv +encryptionTag");
    if (!record) throw fail(404, "Recording not found");
    const call = await callFor(req, String(record.callId));
    if (
      record.status !== "available" ||
      record.deletedAt ||
      record.expiresAt <= new Date()
    )
      throw fail(410, "Recording unavailable or expired.");
    const store = storage(config);
    let bytes;
    try {
      const encrypted = await fs.readFile(
          fileFor(store.directory, record.storageKey),
        ),
        decipher = createDecipheriv(
          "aes-256-gcm",
          store.key,
          Buffer.from(record.encryptionIv, "hex"),
        );
      decipher.setAuthTag(Buffer.from(record.encryptionTag, "hex"));
      bytes = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch {
      await Recording.updateOne(
        { _id: record._id },
        {
          $set: {
            status: "failed",
            failureReason: "The stored file could not be retrieved.",
          },
        },
      );
      throw fail(503, "Recording file could not be retrieved.");
    }
    await audit(
      req,
      req.query.download === "1"
        ? "recording.downloaded"
        : "recording.playback.requested",
      { callId: call._id, leadId: call.leadId, customerId: call.customerId },
      { recordingId: String(record._id) },
    );
    res
      .set({
        "Cache-Control": "private, no-store",
        "Content-Type": record.mimeType,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition":
          (req.query.download === "1" ? "attachment" : "inline") +
          '; filename="recording-' +
          record._id +
          "." +
          ({
            "audio/wav": "wav",
            "audio/mpeg": "mp3",
            "audio/mp4": "m4a",
            "audio/ogg": "ogg",
            "audio/webm": "webm",
          }[record.mimeType] || "audio") +
          '"',
      })
      .send(bytes);
  });
  r.delete("/recordings/:id", admin, async (req, res) => {
    const record = await Recording.findOne({
      _id: objectId(req.params.id),
      ...tenant(req),
      source: "agent-upload",
    }).select("+storageKey");
    if (!record) throw fail(404, "Recording not found");
    const call = await callFor(req, String(record.callId));
    await audit(
      req,
      "recording.deleted",
      { callId: call._id },
      { recordingId: String(record._id) },
    );
    await Recording.updateOne(
      { _id: record._id },
      { $set: { status: "deleted", deletedAt: new Date() } },
    );
    if (record.storageKey) {
      const store = storage(config);
      await fs
        .unlink(fileFor(store.directory, record.storageKey))
        .catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    }
    changed(req);
    res.json({ deleted: true });
  });
  return r;
}
export async function expireRecordings(config) {
  let store;
  try {
    store = storage(config);
  } catch {
    return;
  }
  const records = await Recording.find({
    source: "agent-upload",
    $or: [
      { expiresAt: { $lte: new Date() }, status: { $ne: "deleted" } },
      { status: "deleted", storageKey: { $ne: null } },
    ],
  })
    .select("+storageKey")
    .limit(100);
  for (const record of records) {
    await Recording.updateOne(
      { _id: record._id },
      {
        $set: { status: "deleted", deletedAt: record.deletedAt || new Date() },
      },
    );
    try {
      const retainedFile = fileFor(
        store.directory,
        record.storageKey || String(record._id) + ".ctrec",
      );
      await fs.unlink(retainedFile).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.unlink(retainedFile + ".part").catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await Recording.updateOne(
        { _id: record._id },
        { $unset: { storageKey: 1 } },
      );
    } catch (e) {
      if (e.code === "ENOENT")
        await Recording.updateOne(
          { _id: record._id },
          { $unset: { storageKey: 1 } },
        );
    }
  }
}
