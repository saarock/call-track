import { Call, Lead, Activity } from "../models/index.js";
import { terminal, callStatuses } from "../models/index.js";
const rank = { initiated: 0, ringing: 1, "in-progress": 2 };
export function transition(
  call,
  { status, at = new Date(), duration, sequence, providerCallSid },
) {
  if (!callStatuses.includes(status)) return null;
  if (!call.active) return null;
  if (sequence != null && sequence <= call.sequence) return null;
  if (!terminal.includes(status) && rank[status] < rank[call.status])
    return null;
  const patch = {
    status,
    ...(sequence != null ? { sequence } : {}),
    ...(providerCallSid ? { providerCallSid } : {}),
  };
  if (status === "ringing" && !call.ringingAt) patch.ringingAt = at;
  if (status === "in-progress" && !call.answeredAt) patch.answeredAt = at;
  if (terminal.includes(status)) {
    patch.active = false;
    patch.endedAt = at;
    const answered = call.answeredAt;
    const supplied = Number(duration);
    patch.talkSeconds =
      status === "completed"
        ? Number.isFinite(supplied) && supplied >= 0
          ? Math.floor(supplied)
          : answered
            ? Math.max(0, Math.floor((at - new Date(answered)) / 1000))
            : 0
        : 0;
    // A missed answered callback can be recovered from verified final provider duration.
    if (status === "completed" && !answered)
      patch.answeredAt = new Date(+at - patch.talkSeconds * 1000);
    const endRing = patch.answeredAt || answered || at;
    patch.ringSeconds = Math.max(
      0,
      Math.floor((new Date(endRing) - new Date(call.initiatedAt)) / 1000),
    );
  }
  return patch;
}
export async function applyCallEvent(callId, event, live) {
  for (let retry = 0; retry < 5; retry++) {
    const call = await Call.findById(callId);
    if (!call) return null;
    const patch = transition(call, event);
    if (!patch) return call;
    const updated = await Call.findOneAndUpdate(
      { _id: call._id, __v: call.__v },
      { $set: patch, $inc: { __v: 1 } },
      { returnDocument: "after", runValidators: true },
    );
    if (!updated) continue;
    if (patch.answeredAt)
      await Lead.updateOne(
        { _id: call.leadId },
        { $max: { lastContactAt: patch.answeredAt } },
      );
    if (!updated.active)
      await Activity.create({
        companyId: call.companyId,
        agentId: call.agentId,
        leadId: call.leadId,
        customerId: call.customerId,
        callId: call._id,
        type: "call.ended",
        text: `${call.isDemo ? "Demo " : ""}Call ${updated.status}`,
      });
    live?.changed(call.companyId);
    return updated;
  }
  throw new Error("Concurrent call updates exceeded retry budget");
}
