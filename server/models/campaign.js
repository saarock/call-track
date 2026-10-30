import mongoose from "mongoose";
const { Schema } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const schema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, maxlength: 2000 },
    serviceType: { type: String, maxlength: 100 },
    status: {
      type: String,
      enum: ["active", "paused", "completed"],
      default: "active",
    },
    agentIds: [ref("User")],
    supervisorIds: [ref("User")],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
schema.index({ companyId: 1, name: 1 }, { unique: true });
schema.index({ companyId: 1, agentIds: 1, status: 1 });
export const Campaign =
  mongoose.models.Campaign || mongoose.model("Campaign", schema);
export const ensureCampaignIndexes = () => Campaign.init();
