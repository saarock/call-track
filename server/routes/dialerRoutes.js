import { Router } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { Call, Lead, FollowUp, Settings, User } from "../models/index.js";
import { admin } from "../middleware/auth.js";
import { own, tenant } from "../utils/http.js";
import {
  applyDeviceSnapshot,
  deviceSnapshotSchema,
  saveBusinessReport,
} from "../services/deviceCalls.js";

export const dialerRoutes = Router();
dialerRoutes.post("/device/calls", async (req, res) => {
  const { events } = z
    .object({ events: z.array(deviceSnapshotSchema).min(1).max(50) })
    .parse(req.body);
  const items = [];
  for (const event of events) {
    const call = await applyDeviceSnapshot(req, event);
    items.push({
      deviceCallId: event.callId,
      sequence: event.sequence,
      id: call._id,
    });
  }
  res.json({ items });
});
dialerRoutes.post("/call-results", async (req, res) =>
  res.json(await saveBusinessReport(req, req.body)),
);
dialerRoutes.get("/call-results/pending", async (req, res) => {
  const items = await Call.find({
    ...own(req),
    source: "android-telecom",
    deviceActive: false,
    reportedAt: null,
  })
    .sort({ initiatedAt: -1 })
    .limit(100)
    .populate("customerId")
    .populate("leadId");
  res.json({ items });
});
dialerRoutes.get("/crm/summary", admin, async (req, res) => {
  const settings = await Settings.findOne(tenant(req));
  const from = DateTime.now()
    .setZone(settings.timezone)
    .startOf("day")
    .toJSDate();
  const to = DateTime.now()
    .setZone(settings.timezone)
    .plus({ days: 1 })
    .startOf("day")
    .toJSDate();
  const visible = { ...tenant(req), archived: false, deletedAt: null };
  const [
    totalLeads,
    callsToday,
    interestedLeads,
    followUpsPending,
    convertedLeads,
    agents,
  ] = await Promise.all([
    Lead.countDocuments(visible),
    Call.countDocuments({
      ...tenant(req),
      source: "android-telecom",
      initiatedAt: { $gte: from, $lt: to },
    }),
    Lead.countDocuments({
      ...visible,
      $or: [{ status: "Interested" }, { lastOutcome: "interested" }],
    }),
    FollowUp.countDocuments({ ...tenant(req), status: "pending" }),
    Lead.countDocuments({
      ...visible,
      $or: [{ status: "Converted" }, { lastOutcome: "converted" }],
    }),
    User.countDocuments({ ...tenant(req), role: "agent", active: true }),
  ]);
  const live = req.app.locals.live;
  res.json({
    totalLeads,
    callsToday,
    interestedLeads,
    followUpsPending,
    convertedLeads,
    agents,
    timezone: settings.timezone,
    activity: live
      ? (await live.snapshot(req.user)).items.filter(
          (item) => item.role === "agent",
        )
      : [],
  });
});
