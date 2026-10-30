import { Router } from "express";
import { DateTime } from "luxon";
import { stringify } from "csv-stringify/sync";
import {
  Call,
  Lead,
  FollowUp,
  User,
  Settings,
  Activity,
} from "../models/index.js";
import { own, tenant, objectId, fail } from "../utils/http.js";
import { admin } from "../middleware/auth.js";
const answeredExpr = {
  $or: [
    { $ne: [{ $ifNull: ["$answeredAt", null] }, null] },
    { $eq: ["$reportedAnswered", true] },
  ],
};
const knownDurationExpr = {
  $or: [{ $eq: ["$isDemo", true] }, { $eq: ["$durationKnown", true] }],
};
function summaryGroup(idValue) {
  return {
    _id: idValue,
    totalCalls: { $sum: 1 },
    answered: { $sum: { $cond: [answeredExpr, 1, 0] } },
    missed: { $sum: { $cond: [{ $eq: ["$status", "no-answer"] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
    busy: { $sum: { $cond: [{ $eq: ["$status", "busy"] }, 1, 0] } },
    canceled: { $sum: { $cond: [{ $eq: ["$status", "canceled"] }, 1, 0] } },
    unconfirmed: {
      $sum: { $cond: [{ $eq: ["$status", "unconfirmed"] }, 1, 0] },
    },
    pendingReports: { $sum: { $cond: [{ $eq: ["$active", true] }, 1, 0] } },
    talkSeconds: {
      $sum: {
        $cond: [
          { $and: [{ $eq: ["$active", false] }, knownDurationExpr] },
          "$talkSeconds",
          0,
        ],
      },
    },
    answeredFinal: {
      $sum: {
        $cond: [
          {
            $and: [
              { $eq: ["$active", false] },
              answeredExpr,
              knownDurationExpr,
            ],
          },
          1,
          0,
        ],
      },
    },
    unknownDurations: {
      $sum: {
        $cond: [
          {
            $and: [
              { $eq: ["$active", false] },
              answeredExpr,
              { $not: [knownDurationExpr] },
            ],
          },
          1,
          0,
        ],
      },
    },
  };
}
function normalizeSummary(s) {
  const value = s || {
    totalCalls: 0,
    answered: 0,
    missed: 0,
    failed: 0,
    busy: 0,
    canceled: 0,
    talkSeconds: 0,
    answeredFinal: 0,
    unconfirmed: 0,
    pendingReports: 0,
    unknownDurations: 0,
  };
  return {
    ...value,
    averageSeconds: value.answeredFinal
      ? Math.round(value.talkSeconds / value.answeredFinal)
      : 0,
  };
}

async function range(req) {
  const settings = await Settings.findOne(tenant(req));
  const now = DateTime.now().setZone(settings.timezone);
  const preset = req.query.period || "today";
  let start,
    end = now.plus({ days: 1 }).startOf("day");
  if (preset === "today") start = now.startOf("day");
  else if (preset === "yesterday") {
    start = now.minus({ days: 1 }).startOf("day");
    end = now.startOf("day");
  } else if (preset === "week") start = now.startOf("week");
  else if (preset === "month") start = now.startOf("month");
  else if (preset === "custom") {
    start = DateTime.fromISO(String(req.query.from), {
      zone: settings.timezone,
    });
    end = DateTime.fromISO(String(req.query.to), { zone: settings.timezone });
  } else throw fail(400, "Invalid reporting period");
  if (
    !start?.isValid ||
    !end?.isValid ||
    end <= start ||
    end.diff(start, "days").days > 366
  )
    throw fail(400, "Choose a valid range of up to 366 days; end is exclusive");
  return {
    start: start.toJSDate(),
    end: end.toJSDate(),
    timezone: settings.timezone,
  };
}
export function reportRoutes(config) {
  const r = Router();
  async function data(req) {
    const interval = await range(req);
    const match = {
      ...own(req),
      isDemo: config.callMode === "demo",
      ...(config.callMode === "sim"
        ? { source: { $in: ["sim", "android-telecom"] } }
        : {}),
      initiatedAt: { $gte: interval.start, $lt: interval.end },
    };
    if (req.query.agentId && req.user.role === "admin")
      match.agentId = objectId(req.query.agentId);
    // Aggregations and exact reports are computed on MongoDB records; bound reporting window prevents unbounded history scans.
    const [aggregated] = await Call.aggregate([
      { $match: match },
      {
        $facet: {
          totals: [{ $group: summaryGroup(null) }],
          agents: [{ $group: summaryGroup("$agentId") }],
          daily: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$initiatedAt",
                    timezone: interval.timezone,
                  },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);
    const leadMatch = { ...own(req, "assignedAgentId"), archived: false };
    if (match.agentId) leadMatch.assignedAgentId = match.agentId;
    const leads = await Lead.find(leadMatch).lean();
    const followups = await FollowUp.find({
      ...own(req, "assignedAgentId"),
      ...(match.agentId ? { assignedAgentId: match.agentId } : {}),
    }).lean();
    const converted = await Activity.countDocuments({
      ...tenant(req),
      type: "lead.updated",
      "details.after": "Converted",
      createdAt: { $gte: interval.start, $lt: interval.end },
      ...(match.agentId ? { actorId: match.agentId } : {}),
    });
    return {
      match,
      summary: normalizeSummary(aggregated.totals[0]),
      agentSummaries: aggregated.agents.map(normalizeSummary),
      daily: Object.fromEntries(aggregated.daily.map((v) => [v._id, v.count])),
      leads,
      followups,
      converted,
      ...interval,
    };
  }
  r.get("/dashboard", async (req, res) => {
    const d = await data(req);
    const summary = d.summary;
    const state = await req.app.locals.live.snapshot(req.user);
    const daily = d.daily;
    const statuses = {};
    for (const lead of d.leads)
      statuses[lead.status] = (statuses[lead.status] || 0) + 1;
    res.json({
      ...summary,
      totalLeads: d.leads.length,
      newLeads: d.leads.filter((l) => l.status === "New").length,
      leadsContacted: d.leads.filter((l) => l.lastContactAt).length,
      converted: d.converted,
      totalAgents: state.items.filter((u) => u.role === "agent").length,
      onlineAgents: state.items.filter((u) => u.role === "agent" && u.online)
        .length,
      onCalls: state.items.filter(
        (u) =>
          u.phoneStateVerified &&
          u.call?.deviceActive &&
          ["ACTIVE", "HOLDING"].includes(u.call.deviceState),
      ).length,
      availableAgents: state.items.filter((u) => u.status === "Available")
        .length,
      scheduledFollowUps: d.followups.filter((f) => f.status === "pending")
        .length,
      overdue: d.followups.filter(
        (f) => f.status === "pending" && f.dueAt < new Date(),
      ).length,
      completedFollowUps: d.followups.filter(
        (f) => f.completedAt >= d.start && f.completedAt < d.end,
      ).length,
      daily,
      statuses,
      from: d.start,
      to: d.end,
      timezone: d.timezone,
      isDemo: config.callMode === "demo",
      ...(config.callMode === "sim"
        ? { source: { $in: ["sim", "android-telecom"] } }
        : {}),
    });
  });
  r.get("/agents", async (req, res) => {
    const d = await data(req);
    const users = await User.find({
      ...tenant(req),
      role: "agent",
      ...(req.user.role === "admin"
        ? {}
        : req.user.role === "supervisor"
          ? { _id: { $in: req.user.supervisedAgentIds || [] } }
          : { _id: req.user._id }),
    }).lean();
    res.json({
      items: users.map((u) => ({
        ...normalizeSummary(
          d.agentSummaries.find((s) => String(s._id) === String(u._id)),
        ),
        _id: u._id,
        fullName: u.fullName,
        assignedLeads: d.leads.filter(
          (l) => String(l.assignedAgentId) === String(u._id),
        ).length,
        convertedLeads: d.leads.filter(
          (l) =>
            String(l.assignedAgentId) === String(u._id) &&
            l.status === "Converted",
        ).length,
        pendingFollowUps: d.followups.filter(
          (f) =>
            String(f.assignedAgentId) === String(u._id) &&
            f.status === "pending",
        ).length,
      })),
    });
  });
  r.get("/calls", async (req, res) => {
    const d = await data(req);
    res.json({
      summary: d.summary,
      from: d.start,
      to: d.end,
      timezone: d.timezone,
    });
  });
  r.get("/export", admin, async (req, res) => {
    const d = await data(req);
    const safe = (value) =>
      typeof value === "string" && /^[=+\-@\t\r]/.test(value)
        ? `'${value}`
        : value;
    const count = await Call.countDocuments(d.match);
    if (count > 10000)
      throw fail(400, "Narrow the date range to export at most 10,000 calls");
    const calls = await Call.find(d.match).sort({ initiatedAt: 1 }).lean();
    const csv = stringify(
      calls.map((c) =>
        Object.fromEntries(
          Object.entries({
            id: String(c._id),
            agentId: String(c.agentId),
            phone: c.phone,
            direction: c.direction,
            status: c.status,
            taskCreatedAt: c.initiatedAt.toISOString(),
            talkSeconds: c.isDemo || c.durationKnown ? c.talkSeconds : "",
            verification: c.isDemo
              ? "simulated"
              : c.verification?.method === "android-telecom"
                ? "Android-observed"
                : "self-reported",
            reportedAt: c.reportedAt?.toISOString() || "",
            durationKnown: c.isDemo || c.durationKnown,
            result: c.result || "",
            notes: c.notes || "",
            demo: c.isDemo,
          }).map(([k, v]) => [k, safe(v)]),
        ),
      ),
      {
        header: true,
        columns: [
          "id",
          "agentId",
          "phone",
          "direction",
          "status",
          "taskCreatedAt",
          "talkSeconds",
          "verification",
          "reportedAt",
          "durationKnown",
          "result",
          "notes",
          "demo",
        ],
      },
    );
    res.type("text/csv").attachment("calltrack-calls.csv").send(csv);
  });
  return r;
}
