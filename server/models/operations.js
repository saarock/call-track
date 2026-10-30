import mongoose from "mongoose";
const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true },
  timezone: { type: String, required: true },
  status: { type: String, enum: ["generating", "ready", "failed"], default: "generating" },
  leaseUntil: Date,
  summary: mongoose.Schema.Types.Mixed,
  agents: [mongoose.Schema.Types.Mixed],
  generatedAt: Date,
  email: { status: { type: String, enum: ["not-configured", "disabled", "pending", "sending", "sent", "failed"], default: "disabled" }, sentAt: Date, error: String, messageId: String },
}, { timestamps: true });
schema.index({ companyId: 1, date: 1 }, { unique: true });
export const DailyReport = mongoose.models.DailyReport || mongoose.model("DailyReport", schema);
