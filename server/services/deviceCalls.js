import { DialerReservation } from "../models/power.js";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import {
  Call,
  Lead,
  Customer,
  Settings,
  Activity,
  FollowUp,
} from "../models/index.js";
import {
  fail,
  tenant,
  own,
  id,
  phone as internationalPhone,
  text,
} from "../utils/http.js";
import { changed } from "./events.js";
import { normalizePhone } from "../utils/phone.js";
import {
  observeReservedCall,
  validateReportReservation,
  finishReservation,
  applyOutcomeQueueRules,
  withCallbackMutation,
} from "./powerDialer.js";

const iso = z.string().datetime({ offset: true });
const callStates = [
  "NEW",
  "SELECT_PHONE_ACCOUNT",
  "CONNECTING",
  "DIALING",
  "RINGING",
  "ACTIVE",
  "HOLDING",
  "DISCONNECTING",
  "DISCONNECTED",
];
export const deviceSnapshotSchema = z.object({
  deviceId: z.string().uuid(),
  callId: z.string().uuid(),
  sequence: z.number().int().min(1),
  userId: id.nullish(),
  state: z.enum(callStates),
  phone: text(40).min(1),
  normalizedPhone: internationalPhone.nullish(),
  direction: z.enum(["incoming", "outgoing", "unknown"]),
  startedAt: iso,
  observedAt: iso,
  connectedAt: iso.nullish(),
  endedAt: iso.nullish(),
  hadActive: z.boolean(),
  durationSeconds: z.number().int().min(0).max(604800).nullish(),
  disconnectCause: z.string().max(80).nullish(),
  leadId: id.nullish(),
  startTimeKnown: z.boolean().default(true),
});
function assertAgent(req) {
  if (req.user.role !== "agent")
    throw fail(403, "Sign in as an agent to synchronize phone calls");
  if (req.app.locals.config.callMode === "demo")
    throw fail(409, "Real phone calls are disabled in demo mode");
}
function recordId(value) {
  return new mongoose.Types.ObjectId(
    createHash("sha256").update(value).digest("hex").slice(0, 24),
  );
}
function statusFor(snapshot) {
  if (snapshot.state !== "DISCONNECTED") {
    return snapshot.hadActive
      ? "in-progress"
      : snapshot.state === "RINGING"
        ? "ringing"
        : "initiated";
  }
  if (snapshot.hadActive) return "completed";
  if (snapshot.disconnectCause === "BUSY") return "busy";
  if (["MISSED", "REMOTE"].includes(snapshot.disconnectCause))
    return "no-answer";
  if (
    ["ERROR", "RESTRICTED", "CONNECTION_MANAGER_NOT_SUPPORTED"].includes(
      snapshot.disconnectCause,
    )
  )
    return "failed";
  if (["LOCAL", "CANCELED", "REJECTED"].includes(snapshot.disconnectCause))
    return "canceled";
  return "unconfirmed";
}
export async function applyDeviceSnapshot(req, input) {
  assertAgent(req);
  const snapshot = deviceSnapshotSchema.parse(input);
  if (snapshot.userId && snapshot.userId !== String(req.user._id))
    throw fail(403, "This phone event belongs to another account");
  const start = new Date(snapshot.startedAt),
    observed = new Date(snapshot.observedAt),
    connected = snapshot.connectedAt ? new Date(snapshot.connectedAt) : null,
    ended = snapshot.endedAt ? new Date(snapshot.endedAt) : null;
  if (
    +observed > Date.now() + 300000 ||
    start > observed ||
    (connected && (connected < start || connected > observed)) ||
    (ended && (ended < start || ended > observed)) ||
    (connected && ended && connected > ended)
  )
    throw fail(
      400,
      "Phone timestamps are inconsistent. Check the device clock.",
    );
  if (
    snapshot.hadActive !== Boolean(connected) ||
    (["ACTIVE", "HOLDING"].includes(snapshot.state) && !connected) ||
    (snapshot.state === "DISCONNECTED" && !ended) ||
    (snapshot.state !== "DISCONNECTED" && ended)
  )
    throw fail(
      400,
      "The phone event has no consistent Android connection evidence",
    );
  const key = {
    ...tenant(req),
    agentId: req.user._id,
    source: "android-telecom",
    deviceId: snapshot.deviceId,
    deviceCallId: snapshot.callId,
  };
  const existing = await Call.findOne(key);
  if (existing?.deviceSequence >= snapshot.sequence) return existing;
  let lead = existing?.leadId
    ? await Lead.findOne({ _id: existing.leadId, ...tenant(req) })
    : null;
  const normalized =
    snapshot.normalizedPhone ||
    (/^\+[1-9]\d{7,14}$/.test(snapshot.phone) ? snapshot.phone : null);
  if (!lead && snapshot.leadId) {
    lead = await Lead.findOne({
      _id: snapshot.leadId,
      ...own(req, "assignedAgentId"),
      archived: false,
      deletedAt: null,
    });
    if (lead) {
      const customer = await Customer.findById(lead.customerId);
      if (!normalized || customer.phone !== normalized)
        throw fail(400, "Phone event does not match the assigned lead");
    }
  }
  if (!lead && normalized) {
    const customer = await Customer.findOne({
      ...tenant(req),
      phone: normalized,
    });
    if (customer)
      lead = await Lead.findOne({
        ...own(req, "assignedAgentId"),
        customerId: customer._id,
        archived: false,
        deletedAt: null,
      });
  }
  const known = Boolean(ended && connected && snapshot.durationSeconds != null);
  const update = {
    deviceSequence: snapshot.sequence,
    deviceState: snapshot.state,
    deviceActive: snapshot.state !== "DISCONNECTED",
    deviceObservedAt: observed,
    disconnectCause: snapshot.disconnectCause || null,
    ringingObservedAt:
      existing?.ringingObservedAt ||
      (snapshot.state === "RINGING" ? observed : null),
    phone: normalized || snapshot.phone,
    direction: snapshot.direction,
    initiatedAt: start,
    answeredAt: connected,
    endedAt: ended,
    status: statusFor(snapshot),
    durationKnown: known,
    talkSeconds: known ? snapshot.durationSeconds : 0,
    reportedAnswered: false,
    verification: {
      method: "android-telecom",
      answerEvidence: connected ? "android-call-details" : null,
      startTimeKnown: snapshot.startTimeKnown,
      durationSource: known ? "android-elapsed-realtime" : null,
    },
    ...(lead
      ? {
          leadId: lead._id,
          customerId: lead.customerId,
          campaignId: lead.campaignId,
        }
      : {}),
  };
  let call;
  try {
    call = await Call.findOneAndUpdate(
      {
        ...key,
        $or: [
          { deviceSequence: { $lt: snapshot.sequence } },
          { deviceSequence: { $exists: false } },
        ],
      },
      { $set: update, $setOnInsert: { ...key, isDemo: false, active: false } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    call = await Call.findOne(key);
    if (!call || call.deviceSequence < snapshot.sequence)
      return applyDeviceSnapshot(req, snapshot);
  }
  if (
    !existing ||
    existing.deviceState !== snapshot.state ||
    existing.phone !== (normalized || snapshot.phone)
  )
    changed(req);
  await observeReservedCall(req, call);
  return call;
}
export const resultOptions = [
  "interested",
  "not-interested",
  "follow-up",
  "call-later",
  "already-customer",
  "converted",
  "no-answer",
  "busy",
  "wrong-number",
  "new-lead",
  "unreachable",
  "do-not-call",
];
export const resultLabels = {
  interested: "Interested",
  "not-interested": "Not Interested",
  "follow-up": "Follow-up",
  "call-later": "Call Later",
  "already-customer": "Already Customer",
  converted: "Converted",
  "no-answer": "No Answer",
  busy: "Busy",
  "wrong-number": "Wrong Number",
  "new-lead": "New Lead",
  unreachable: "Unreachable",
  "do-not-call": "Do Not Call",
};
export const businessReportSchema = z.object({
  direction: z.enum(["incoming", "outgoing", "unknown"]).optional(),
  reportId: z.string().uuid(),
  createdAt: iso,
  phone: z.preprocess(normalizePhone, text(40).min(1)),
  result: z.enum(resultOptions),
  notes: text(4000).default(""),
  leadId: id.nullish(),
  legacyCallId: id.nullish(),
  serverCallId: id.nullish(),
  reservationId: id.nullish(),
  sessionId: z.string().uuid().nullish(),
  attemptId: z.string().uuid().nullish(),
  leadStatus: text(60).nullish(),
  optOut: z.boolean().default(false),
  customerName: text(100).default(""),
  createLead: z.boolean().default(false),
  followUpAt: iso.nullish(),
  device: deviceSnapshotSchema.nullish(),
});
export async function saveBusinessReport(req, input) {
  assertAgent(req);
  const report = businessReportSchema.parse(input);
  if (report.result === "do-not-call") report.optOut = true;
  const reportTime = new Date(report.createdAt);
  if (+reportTime > Date.now() + 300000)
    throw fail(400, "Check the device date and time before synchronizing");
  if (["follow-up", "call-later"].includes(report.result) && !report.followUpAt)
    throw fail(400, "Choose the next follow-up date and time");
  let call = await Call.findOne({
    ...tenant(req),
    agentId: req.user._id,
    reportKey: report.reportId,
  });
  if (call?.businessSyncComplete) {
    const reservation = await validateReportReservation(req, report, call);
    await finishReservation(req, report, call, reservation);
    return call;
  }
  if (report.device) {
    const observed = await applyDeviceSnapshot(req, report.device);
    if (call && String(call._id) !== String(observed._id))
      throw fail(409, "Report identity does not match this call");
    call = observed;
    if (call.deviceActive)
      throw fail(409, "Finish the phone call before saving its result");
    if (call.reportKey && call.reportKey !== report.reportId)
      throw fail(409, "This call already has a saved result");
  }
  if (report.serverCallId && !call) {
    call = await Call.findOne({
      _id: report.serverCallId,
      ...own(req),
      isDemo: false,
    });
    if (!call) throw fail(404, "Call record not found");
    if (call.source === "android-telecom" && call.deviceActive)
      throw fail(409, "Finish the phone call before saving its result");
    if (call.reportKey && call.reportKey !== report.reportId)
      throw fail(409, "This call already has a saved result");
    if (
      call.source === "sim" &&
      !call.active &&
      !call.reportKey &&
      call.reportedAt
    )
      throw fail(409, "This task already has a saved report");
  }
  if (report.legacyCallId && !call) {
    call = await Call.findOne({
      _id: report.legacyCallId,
      ...own(req),
      source: "sim",
      isDemo: false,
    });
    if (!call) throw fail(404, "Call task not found");
    if (!call.active && !call.reportKey)
      throw fail(409, "This task already has a saved report");
    if (call.reportKey && call.reportKey !== report.reportId)
      throw fail(409, "This task already has a saved result");
  }
  let lead = report.leadId
    ? await Lead.findOne({
        _id: report.leadId,
        ...own(req, "assignedAgentId"),
        archived: false,
        deletedAt: null,
      })
    : null;
  if (report.leadId && !lead && String(call?.leadId) !== report.leadId)
    throw fail(404, "Assigned lead not found");
  if (!lead && call?.leadId)
    lead = await Lead.findOne({
      _id: call.leadId,
      ...own(req, "assignedAgentId"),
      deletedAt: null,
    });
  if (lead) {
    const contact = await Customer.findById(lead.customerId);
    const actual = call?.phone || report.phone;
    if (/^\+[1-9]\d{7,14}$/.test(actual) && contact.phone !== actual)
      throw fail(400, "The selected lead has a different phone number");
  }
  const settings = await Settings.findOne(tenant(req));
  if (report.leadStatus && !settings.leadStatuses.includes(report.leadStatus))
    throw fail(400, "Invalid lead status");
  const reservation = await validateReportReservation(req, report, call);
  if (!lead && report.createLead) {
    if (
      await DialerReservation.exists({
        ...tenant(req),
        phone: report.phone,
        active: true,
        kind: "call",
        agentId: { $ne: req.user._id },
      })
    )
      throw fail(
        409,
        "This number is reserved by another agent; ask your administrator to reconcile the lead",
      );
    if (settings.agentCanCreateAfterCallLeads === false)
      throw fail(403, "Your admin has disabled new leads after calls");
    const number = internationalPhone.parse(report.phone);
    let customer = await Customer.findOne({ ...tenant(req), phone: number });
    if (!customer) {
      try {
        customer = await Customer.create({
          ...tenant(req),
          phone: number,
          fullName: report.customerName || number,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        customer = await Customer.findOne({ ...tenant(req), phone: number });
      }
    }
    lead = await Lead.findOne({
      ...tenant(req),
      customerId: customer._id,
      archived: false,
      deletedAt: null,
    });
    if (lead && String(lead.assignedAgentId) !== String(req.user._id))
      throw fail(
        409,
        "This number is assigned elsewhere. Save without adding a lead, or ask your admin.",
      );
    if (!lead) {
      try {
        lead = await Lead.create({
          ...tenant(req),
          customerId: customer._id,
          assignedAgentId: req.user._id,
          assignedAt: reportTime,
          source: "After call",
          status: "New",
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        lead = await Lead.findOne({
          ...own(req, "assignedAgentId"),
          customerId: customer._id,
          archived: false,
          deletedAt: null,
        });
        if (!lead)
          throw fail(409, "The lead was assigned elsewhere; ask your admin");
      }
    }
  }
  if (report.followUpAt && !lead)
    throw fail(
      400,
      "Choose an assigned lead or add this number as a lead before scheduling a follow-up",
    );
  if (!call) {
    try {
      call = await Call.create({
        ...tenant(req),
        agentId: req.user._id,
        ...(lead?.campaignId ? { campaignId: lead.campaignId } : {}),
        source: "sim",
        isDemo: false,
        active: false,
        status: "unconfirmed",
        phone: report.phone,
        direction: report.direction || "unknown",
        initiatedAt: reportTime,
        reportKey: report.reportId,
        verification: { method: "unverified" },
        ...(lead ? { leadId: lead._id, customerId: lead.customerId } : {}),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      call = await Call.findOne({
        ...tenant(req),
        agentId: req.user._id,
        reportKey: report.reportId,
      });
      if (!call) throw error;
    }
  }
  const claimed = await Call.findOneAndUpdate(
    {
      _id: call._id,
      ...tenant(req),
      agentId: req.user._id,
      $or: [
        { reportKey: { $exists: false } },
        { reportKey: report.reportId },
        { reportKey: null },
      ],
    },
    {
      $set: {
        reportKey: report.reportId,
        result: resultLabels[report.result],
        businessResult: report.result,
        customerName: report.customerName,
        notes: report.notes,
        active: false,
        reportedAt: reportTime,
        reportedBy: req.user._id,
        ...(reservation
          ? {
              reservationId: reservation._id,
              powerSessionId: reservation.sessionId,
              attemptId: reservation.attemptId,
            }
          : {}),
        businessSyncComplete: false,
        ...(lead ? { leadId: lead._id, customerId: lead.customerId } : {}),
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed) throw fail(409, "This call already has another report");
  const noteId = recordId(String(call._id) + ":report:" + report.reportId);
  await Activity.updateOne(
    { _id: noteId },
    {
      $setOnInsert: {
        ...tenant(req),
        actorId: req.user._id,
        leadId: lead?._id,
        customerId: lead?.customerId || call.customerId,
        callId: call._id,
        type: "call.result",
        text: report.notes || resultLabels[report.result],
        details: {
          result: report.result,
          verification: call.verification?.method || "unverified",
          reportId: report.reportId,
        },
        createdAt: reportTime,
      },
    },
    { upsert: true },
  );
  if (lead) {
    const target = {
      interested: "Interested",
      "not-interested": "Not Interested",
      "follow-up": "Follow-up Required",
      "call-later": "Follow-up Required",
      "already-customer": "Already Customer",
      "wrong-number": "Wrong Number",
      "new-lead": "New Lead",
      unreachable: "Unreachable",
      "no-answer": "No Answer",
      busy: "Busy",
      "do-not-call": "Do Not Call",
      converted: "Converted",
    }[report.result];
    await Lead.updateOne(
      {
        _id: lead._id,
        ...tenant(req),
        $or: [
          { lastOutcomeAt: { $exists: false } },
          { lastOutcomeAt: { $lte: reportTime } },
        ],
      },
      {
        $set: {
          lastOutcome: report.result,
          lastOutcomeAt: reportTime,
          ...(target && settings.leadStatuses.includes(target)
            ? { status: target }
            : {}),
          ...(report.leadStatus ? { status: report.leadStatus } : {}),
          ...(call.answeredAt ? { lastContactAt: call.answeredAt } : {}),
        },
      },
    );
    await applyOutcomeQueueRules(req, report, lead);
    await withCallbackMutation(req, lead, async () => {
      if (
        [
          "converted",
          "not-interested",
          "already-customer",
          "wrong-number",
          "do-not-call",
          "call-later",
          "follow-up",
        ].includes(report.result)
      )
        await FollowUp.updateMany(
          {
            ...tenant(req),
            leadId: lead._id,
            status: "pending",
            createdAt: { $lte: reportTime },
            sourceCallId: { $ne: call._id },
          },
          {
            $set: {
              status: report.followUpAt ? "completed" : "canceled",
              completedAt: reportTime,
            },
          },
        );
      if (report.followUpAt)
        await FollowUp.updateOne(
          { _id: recordId(String(call._id) + ":followup:" + report.reportId) },
          {
            $setOnInsert: {
              ...tenant(req),
              leadId: lead._id,
              customerId: lead.customerId,
              assignedAgentId: req.user._id,
              dueAt: new Date(report.followUpAt),
              notes: report.notes,
              status: "pending",
              sourceCallId: call._id,
            },
          },
          { upsert: true },
        );
    });
  }
  if (report.optOut) {
    if (!lead) {
      const known = await Customer.findOne({
        ...tenant(req),
        phone: report.phone,
      }).select("_id");
      if (
        known &&
        (await Lead.exists({
          ...tenant(req),
          customerId: known._id,
          archived: false,
          deletedAt: null,
          assignedAgentId: { $ne: req.user._id },
        }))
      )
        throw fail(
          403,
          "Only the assigned agent can change this customer opt-out",
        );
    }
    let contact = lead
      ? await Customer.findById(lead.customerId)
      : await Customer.findOne({
          ...tenant(req),
          phone: normalizePhone(report.phone),
        });
    if (!contact && /^\+[1-9]\d{7,14}$/.test(report.phone)) {
      try {
        contact = await Customer.create({
          ...tenant(req),
          phone: report.phone,
          fullName: report.customerName || report.phone,
          doNotCall: true,
          optOutAt: reportTime,
          optOutReason: report.notes || "Customer requested no more calls",
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        contact = await Customer.findOne({
          ...tenant(req),
          phone: report.phone,
        });
      }
    }
    if (contact)
      await Customer.updateOne(
        { _id: contact._id, ...tenant(req) },
        {
          $set: {
            doNotCall: true,
            optOutAt: reportTime,
            optOutReason: report.notes || "Customer opted out during call",
          },
        },
      );
    if (lead) {
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { dialingClosed: true } },
      );
      await FollowUp.updateMany(
        { ...tenant(req), leadId: lead._id, status: "pending" },
        { $set: { status: "canceled" } },
      );
    }
  }
  await finishReservation(req, report, call, reservation);
  const saved = await Call.findByIdAndUpdate(
    call._id,
    { $set: { businessSyncComplete: true } },
    { returnDocument: "after" },
  );
  changed(req);
  return saved;
}
