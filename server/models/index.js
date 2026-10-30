import mongoose from "mongoose";
import { ensureCampaignIndexes } from "./campaign.js";
import { ensurePowerIndexes } from "./power.js";
const { Schema } = mongoose;
const ref = (name, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const company = { type: Schema.Types.ObjectId, required: true, index: true };
export const leadStatuses = [
  "New",
  "Assigned",
  "Contacted",
  "Interested",
  "Not Interested",
  "Follow-up Required",
  "Converted",
  "Lost",
  "New Lead",
  "Call Later",
  "Wrong Number",
  "Already Customer",
  "No Answer",
  "Busy",
  "Unreachable",
  "Do Not Call",
];
export const callStatuses = [
  "unconfirmed",
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
];
export const terminal = [
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
];
function model(name, fields, indexes = []) {
  const schema = new Schema(
    {
      companyId:
        name === "Settings"
          ? { type: Schema.Types.ObjectId, required: true }
          : company,
      ...fields,
    },
    { timestamps: true, optimisticConcurrency: true },
  );
  for (const [keys, options] of indexes) schema.index(keys, options || {});
  return mongoose.models[name] || mongoose.model(name, schema);
}
export const User = model(
  "User",
  {
    fullName: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    agentCode: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "supervisor", "agent"],
      default: "agent",
    },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    supervisedAgentIds: [ref("User")],
    assignedCampaignIds: [ref("Campaign")],
    passwordHash: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: Date,
    availability: {
      type: String,
      enum: ["Available", "Busy", "On Break", "Online"],
      default: "Available",
    },
  },
  [
    [{ email: 1 }, { unique: true }],
    [{ companyId: 1, agentCode: 1 }, { unique: true }],
  ],
);
export const Customer = model(
  "Customer",
  {
    fullName: { type: String, required: true, maxlength: 100 },
    phone: { type: String, required: true, match: /^\+[1-9]\d{7,14}$/ },
    email: String,
    organization: String,
    address: String,
    serviceType: String,
    serviceNotes: String,
    doNotCall: { type: Boolean, default: false },
    optOutAt: Date,
    optOutReason: String,
  },
  [[{ companyId: 1, phone: 1 }, { unique: true }]],
);
export const Lead = model(
  "Lead",
  {
    customerId: ref("Customer", true),
    campaignId: ref("Campaign"),
    assignedAgentId: ref("User"),
    source: { type: String, default: "Manual" },
    status: { type: String, required: true, default: "New" },
    priority: {
      type: String,
      enum: ["Low", "Normal", "High"],
      default: "Normal",
    },
    archived: { type: Boolean, default: false },
    assignedAt: Date,
    deletedAt: Date,
    lastOutcome: String,
    lastOutcomeAt: Date,
    lastContactAt: Date,
    nextAttemptAt: Date,
    dialingClosed: { type: Boolean, default: false },
    consent: {
      permitted: { type: Boolean, default: false },
      evidence: String,
      recordedBy: ref("User"),
      recordedAt: Date,
    },
  },
  [
    [
      { companyId: 1, customerId: 1 },
      { unique: true, partialFilterExpression: { archived: false } },
    ],
    [{ companyId: 1, assignedAgentId: 1, status: 1 }],
  ],
);
export const Call = model(
  "Call",
  {
    agentId: ref("User", true),
    campaignId: ref("Campaign"),
    customerId: ref("Customer", function () {
      return this.source !== "android-telecom" && !this.reportKey;
    }),
    leadId: ref("Lead", function () {
      return this.source !== "android-telecom" && !this.reportKey;
    }),
    phone: { type: String, required: true },
    direction: {
      type: String,
      enum: ["incoming", "outgoing", "unknown"],
      required: true,
    },
    status: { type: String, enum: callStatuses, default: "initiated" },
    active: { type: Boolean, default: true },
    providerCallSid: String,
    parentCallSid: String,
    isDemo: { type: Boolean, required: true },
    source: {
      type: String,
      enum: ["sim", "demo", "legacy-provider", "android-telecom"],
      default: "legacy-provider",
    },
    deviceId: String,
    deviceCallId: String,
    deviceSequence: Number,
    deviceState: String,
    deviceActive: { type: Boolean, default: false },
    deviceObservedAt: Date,
    disconnectCause: String,
    ringingObservedAt: Date,
    reportKey: String,
    businessResult: String,
    customerName: String,
    reservationId: ref("DialerReservation"),
    powerSessionId: String,
    attemptId: String,
    businessSyncComplete: { type: Boolean, default: false },
    verification: {
      method: { type: String, enum: ["unverified", "android-telecom"] },
      answerEvidence: String,
      startTimeKnown: Boolean,
      durationSource: String,
    },
    reportedAnswered: { type: Boolean, default: false },
    durationKnown: { type: Boolean, default: false },
    reportedAt: Date,
    reportedBy: ref("User"),
    initiatedAt: { type: Date, default: Date.now },
    ringingAt: Date,
    answeredAt: Date,
    endedAt: Date,
    talkSeconds: { type: Number, default: 0, min: 0 },
    ringSeconds: { type: Number, default: 0, min: 0 },
    result: String,
    notes: String,
    sequence: { type: Number, default: -1 },
    recordingRequested: { type: Boolean, default: false },
    consentEvidence: String,
  },
  [
    [
      { companyId: 1, agentId: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    ],
    [{ providerCallSid: 1 }, { unique: true, sparse: true }],
    [{ parentCallSid: 1 }, { unique: true, sparse: true }],
    [{ companyId: 1, agentId: 1, initiatedAt: -1 }],
    [
      { companyId: 1, agentId: 1, deviceId: 1, deviceCallId: 1 },
      {
        unique: true,
        name: "native_call_identity",
        partialFilterExpression: { source: "android-telecom" },
      },
    ],
    [
      { companyId: 1, agentId: 1, reportKey: 1 },
      {
        unique: true,
        name: "business_report_identity",
        partialFilterExpression: { reportKey: { $type: "string" } },
      },
    ],
  ],
);
export const Recording = model(
  "Recording",
  {
    callId: ref("Call", true),
    providerRecordingSid: { type: String, required: true },
    agentId: ref("User"),
    source: { type: String, enum: ["agent-upload", "provider"] },
    uploadedBy: ref("User"),
    originalName: String,
    mimeType: String,
    bytes: Number,
    durationKnown: { type: Boolean, default: false },
    consentAt: Date,
    consentBy: ref("User"),
    failureReason: String,
    storageKey: { type: String, select: false },
    encryptionIv: { type: String, select: false },
    encryptionTag: { type: String, select: false },
    sha256: { type: String, select: false },
    uploadLeaseUntil: { type: Date, select: false },
    status: {
      type: String,
      enum: ["processing", "available", "failed", "deleted"],
      default: "processing",
    },
    durationSeconds: { type: Number, default: 0 },
    expiresAt: Date,
    deletedAt: Date,
  },
  [
    [{ providerRecordingSid: 1 }, { unique: true }],
    [{ companyId: 1, expiresAt: 1 }],
  ],
);
export const FollowUp = model(
  "FollowUp",
  {
    leadId: ref("Lead", true),
    customerId: ref("Customer", true),
    assignedAgentId: ref("User", true),
    dueAt: { type: Date, required: true },
    notes: String,
    status: {
      type: String,
      enum: ["pending", "completed", "canceled"],
      default: "pending",
    },
    completedAt: Date,
    sourceCallId: ref("Call"),
  },
  [[{ companyId: 1, assignedAgentId: 1, status: 1, dueAt: 1 }]],
);
export const Activity = model(
  "Activity",
  {
    actorId: ref("User"),
    leadId: ref("Lead"),
    customerId: ref("Customer"),
    callId: ref("Call"),
    type: { type: String, required: true },
    text: String,
    details: Schema.Types.Mixed,
  },
  [[{ companyId: 1, leadId: 1, createdAt: -1 }]],
);
export const Notification = model(
  "Notification",
  {
    recipientId: ref("User", true),
    text: { type: String, required: true },
    leadId: ref("Lead"),
    readAt: Date,
    dedupeKey: String,
  },
  [
    [{ companyId: 1, recipientId: 1, createdAt: -1 }],
    [{ dedupeKey: 1 }, { unique: true, sparse: true }],
  ],
);
export const Settings = model(
  "Settings",
  {
    name: { type: String, required: true },
    timezone: { type: String, default: "Asia/Kathmandu" },
    leadStatuses: { type: [String], default: leadStatuses },
    agentCanCreateCustomers: { type: Boolean, default: true },
    agentCanCreateAfterCallLeads: { type: Boolean, default: true },
    incomingEnabled: { type: Boolean, default: false },
    recordingEnabled: { type: Boolean, default: false },
    retentionDays: { type: Number, default: 30, min: 1, max: 365 },
    rankingMetric: {
      type: String,
      enum: ["conversionRate", "interestedRate", "talkSeconds"],
      default: "conversionRate",
    },
    rankingMinimumCalls: { type: Number, default: 5, min: 1, max: 10000 },
    dailyReportEnabled: { type: Boolean, default: false },
    dailyReportHour: { type: Number, default: 18, min: 0, max: 23 },
    dailyReportMinute: { type: Number, default: 0, min: 0, max: 59 },
    dailyReportEmails: [String],
    dailyReportEmailEnabled: { type: Boolean, default: false },
    powerDialer: {
      maxAttempts: { type: Number, default: 3, min: 1, max: 10 },
      noAnswerRetryMinutes: { type: Number, default: 1440, min: 1, max: 43200 },
      busyRetryMinutes: { type: Number, default: 60, min: 1, max: 43200 },
      skipRetryMinutes: { type: Number, default: 60, min: 1, max: 43200 },
      callDelaySeconds: { type: Number, default: 2, min: 0, max: 120 },
    },
  },
  [[{ companyId: 1 }, { unique: true }]],
);
export async function ensureIndexes() {
  await ensurePowerIndexes();
  await ensureCampaignIndexes();
  await Promise.all(
    [
      User,
      Customer,
      Lead,
      Call,
      Recording,
      FollowUp,
      Activity,
      Notification,
      Settings,
    ].map((m) => m.init()),
  );
}
