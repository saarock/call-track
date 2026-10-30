import { expireRecordings } from "../routes/recordingRoutes.js";
import { Call, FollowUp, Notification } from "../models/index.js";
import { applyCallEvent } from "./callState.js";
import { runDailyReports } from "./dailyReports.js";
export function startJobs(config, live) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const pending = await FollowUp.find({
        status: "pending",
        dueAt: { $lte: new Date() },
      }).limit(500);
      for (const f of pending) {
        try {
          const key = `due:${f._id}:${f.assignedAgentId}:${f.dueAt.toISOString()}`;
          await Notification.updateOne(
            { dedupeKey: key },
            {
              $setOnInsert: {
                companyId: f.companyId,
                recipientId: f.assignedAgentId,
                leadId: f.leadId,
                text: "Follow-up is due",
                dedupeKey: key,
              },
            },
            { upsert: true },
          );
        } catch (e) {
          if (e.code !== 11000) throw e;
        }
      }
      if (config.callMode === "demo") {
        const calls = await Call.find({
          isDemo: true,
          active: true,
          initiatedAt: { $lt: new Date(Date.now() - 3600000) },
        }).limit(100);
        for (const call of calls)
          await applyCallEvent(call._id, { status: "canceled" }, live);
      }
      await expireRecordings(config);
      await runDailyReports(live);
    } catch {
      console.warn("Scheduled maintenance will retry");
    } finally {
      running = false;
    }
  }
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
