import mongoose from "mongoose";
const { Schema } = mongoose;
const ref = (name, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const session = new Schema(
  {
    companyId: ref("Settings", true),
    agentId: ref("User", true),
    sessionId: { type: String, required: true },
    campaignId: ref("Campaign"),
    status: {
      type: String,
      enum: ["running", "paused", "stopped"],
      default: "running",
    },
    mode: { type: String, enum: ["power", "manual"], default: "power" },
    open: { type: Boolean, default: true },
    startedAt: { type: Date, default: Date.now },
    lastHeartbeatAt: Date,
    stoppedAt: Date,
  },
  { timestamps: true },
);
session.index(
  { companyId: 1, agentId: 1, open: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
session.index({ companyId: 1, agentId: 1, sessionId: 1 }, { unique: true });
export const DialerSession =
  mongoose.models.DialerSession || mongoose.model("DialerSession", session);
const reservation = new Schema(
  {
    companyId: ref("Settings", true),
    agentId: ref("User"),
    leadId: ref("Lead"),
    customerId: ref("Customer"),
    phone: { type: String, required: true },
    customerName: String,
    kind: { type: String, enum: ["call", "mutation"], default: "call" },
    sessionId: String,
    requestId: String,
    attemptId: String,
    manual: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    state: {
      type: String,
      enum: [
        "reserved",
        "dialing",
        "report-required",
        "released",
        "completed",
        "skipped",
        "expired",
        "mutation",
      ],
      default: "reserved",
    },
    expiresAt: Date,
    attemptAt: Date,
    endedAt: Date,
    releasedAt: Date,
    callId: ref("Call"),
    deviceCallId: String,
    result: String,
    reportKey: String,
    releaseReason: String,
    lastHeartbeatAt: Date,
  },
  { timestamps: true },
);
// MongoDB decides the winner: neither a read-before-write nor an application mutex is sufficient.
reservation.index(
  { companyId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: "one_live_reservation_per_phone",
  },
);
reservation.index(
  { companyId: 1, agentId: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, kind: "call" },
    name: "one_live_reservation_per_agent",
  },
);
reservation.index(
  { companyId: 1, agentId: 1, sessionId: 1, requestId: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: "call" },
    name: "idempotent_reservation_request",
  },
);
reservation.index({ companyId: 1, leadId: 1, attemptAt: -1 });
export const DialerReservation =
  mongoose.models.DialerReservation ||
  mongoose.model("DialerReservation", reservation);
export const ensurePowerIndexes = () =>
  Promise.all([DialerSession.init(), DialerReservation.init()]);
