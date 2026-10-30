import { DateTime } from "luxon";
import { Call, Lead, FollowUp, User, Settings } from "../models/index.js";
import { own, tenant, objectId, fail, escapeRegex } from "../utils/http.js";
import { Campaign } from "../models/campaign.js";

const observed = { $eq: ["$verification.method", "android-telecom"] };
const connected = {
  $and: [observed, { $ne: [{ $ifNull: ["$answeredAt", null] }, null] }],
};
const timed = {
  $and: [
    connected,
    { $eq: ["$durationKnown", true] },
    { $eq: ["$deviceActive", false] },
  ],
};
const countIf = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });
function grouping(id) {
  return {
    _id: id,
    totalCalls: countIf(observed),
    incoming: countIf({
      $and: [observed, { $eq: ["$direction", "incoming"] }],
    }),
    outgoing: countIf({
      $and: [observed, { $eq: ["$direction", "outgoing"] }],
    }),
    missed: countIf({
      $and: [
        observed,
        { $eq: ["$direction", "incoming"] },
        { $eq: ["$status", "no-answer"] },
      ],
    }),
    answered: countIf(connected),
    timedCalls: countIf(timed),
    talkSeconds: { $sum: { $cond: [timed, "$talkSeconds", 0] } },
    manualReports: countIf({
      $and: [
        { $ne: ["$verification.method", "android-telecom"] },
        { $ne: [{ $ifNull: ["$reportedAt", null] }, null] },
      ],
    }),
    unknownDurations: countIf({
      $and: [
        connected,
        { $ne: ["$durationKnown", true] },
        { $ne: ["$deviceActive", true] },
      ],
    }),
  };
}
export const emptyPerformance = () => ({
  totalCalls: 0,
  incoming: 0,
  outgoing: 0,
  missed: 0,
  answered: 0,
  timedCalls: 0,
  talkSeconds: 0,
  manualReports: 0,
  unknownDurations: 0,
  interested: 0,
  converted: 0,
  followups: 0,
  reportedAttempts: 0,
});
const normalize = (value) => {
  const v = { ...emptyPerformance(), ...value };
  return {
    ...v,
    averageSeconds: v.timedCalls ? Math.round(v.talkSeconds / v.timedCalls) : 0,
  };
};
export async function reportRange(companyId, query = {}, now = DateTime.now()) {
  const settings = await Settings.findOne({ companyId }).lean(),
    timezone = settings?.timezone || "Asia/Kathmandu";
  now = now.setZone(timezone);
  let start,
    end = now.plus({ days: 1 }).startOf("day");
  const period = String(query.period || "today");
  if (period === "today") start = now.startOf("day");
  else if (period === "yesterday") {
    start = now.minus({ days: 1 }).startOf("day");
    end = now.startOf("day");
  } else if (period === "week") start = now.startOf("week");
  else if (period === "month") start = now.startOf("month");
  else if (period === "custom") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(query.from)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(query.to))
    )
      throw fail(400, "Use YYYY-MM-DD for both dates");
    start = DateTime.fromISO(String(query.from), { zone: timezone }).startOf(
      "day",
    );
    end = DateTime.fromISO(String(query.to), { zone: timezone })
      .plus({ days: 1 })
      .startOf("day");
  } else throw fail(400, "Invalid report period");
  if (
    !start?.isValid ||
    !end?.isValid ||
    end <= start ||
    end.diff(start, "days").days > 366
  )
    throw fail(400, "Choose a valid date range of up to 366 days");
  return {
    from: start.toJSDate(),
    to: end.toJSDate(),
    fromDate: start.toISODate(),
    toDate: end.minus({ days: 1 }).toISODate(),
    timezone,
    period,
    settings,
  };
}
export async function performanceFilter(req, query = req.query) {
  const interval = await reportRange(req.user.companyId, query);
  const filter = {
    ...own(req),
    isDemo: false,
    source: { $in: ["sim", "android-telecom"] },
    initiatedAt: { $gte: interval.from, $lt: interval.to },
  };
  if (query.agentId) {
    const requested = objectId(query.agentId);
    if (req.user.role === "agent" && String(requested) !== String(req.user._id))
      throw fail(403, "Agent report is outside your access");
    if (
      req.user.role === "supervisor" &&
      !(req.user.supervisedAgentIds || []).some(
        (id) => String(id) === String(requested),
      )
    )
      throw fail(403, "Agent report is outside your team");
    filter.agentId = requested;
  }
  if (query.campaignId) {
    const id = objectId(query.campaignId);
    if (
      req.user.role === "supervisor" &&
      !(req.user.assignedCampaignIds || []).some(
        (value) => String(value) === String(id),
      )
    )
      throw fail(403, "Campaign is outside your access");
    filter.campaignId = id;
  }
  if (query.leadId) filter.leadId = objectId(query.leadId);
  if (query.phone) {
    const number = String(query.phone).replace(/[^\d+]/g, "");
    if (number) filter.phone = { $regex: escapeRegex(number) };
  }
  if (query.direction) {
    if (
      !["incoming", "outgoing", "missed", "unknown"].includes(query.direction)
    )
      throw fail(400, "Invalid call type");
    filter.direction =
      query.direction === "missed" ? "incoming" : query.direction;
    if (query.direction === "missed") filter.status = "no-answer";
  }
  if (query.outcome) filter.businessResult = String(query.outcome).slice(0, 80);
  return { filter, interval };
}
const outcomeGroup = (id) => ({
  _id: id,
  interested: countIf({ $eq: ["$businessResult", "interested"] }),
  converted: countIf({ $eq: ["$businessResult", "converted"] }),
  followups: countIf({ $in: ["$businessResult", ["call-later", "follow-up"]] }),
  reportedAttempts: { $sum: 1 },
});
export async function performanceReport(req, query = req.query) {
  const { filter, interval } = await performanceFilter(req, query);
  const outcomeFilter = {
    ...filter,
    reportedAt: { $gte: interval.from, $lt: interval.to },
    businessSyncComplete: true,
  };
  delete outcomeFilter.initiatedAt;
  const extra = {
    ...(filter.agentId ? { assignedAgentId: filter.agentId } : {}),
    ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
  };
  const leadScope = {
      ...own(req, "assignedAgentId"),
      archived: false,
      deletedAt: null,
      ...extra,
    },
    followScope = { ...own(req, "assignedAgentId"), ...extra };
  const agentFilter = {
    ...tenant(req),
    role: "agent",
    ...(filter.agentId ? { _id: filter.agentId } : {}),
  };
  const dayExpr = (field) => ({
    $dateToString: {
      format: "%Y-%m-%d",
      date: field,
      timezone: interval.timezone,
    },
  });
  const monthStart = DateTime.now()
      .setZone(interval.timezone)
      .startOf("month")
      .toJSDate(),
    weekStart = DateTime.now()
      .setZone(interval.timezone)
      .startOf("week")
      .toJSDate();
  const observedScope = { ...filter, "verification.method": "android-telecom" };
  const [
    phoneRows,
    outcomeRows,
    users,
    leads,
    pending,
    live,
    statusRows,
    weekCount,
    monthCount,
    trendOutcomes,
    campaignOutcomes,
  ] = await Promise.all([
    Call.aggregate([
      { $match: filter },
      {
        $facet: {
          totals: [{ $group: grouping(null) }],
          agents: [{ $group: grouping("$agentId") }],
          daily: [
            { $group: grouping(dayExpr("$initiatedAt")) },
            { $sort: { _id: 1 } },
          ],
          campaigns: [{ $group: grouping("$campaignId") }],
        },
      },
    ]),
    Call.aggregate([
      { $match: outcomeFilter },
      { $group: outcomeGroup("$agentId") },
    ]),
    User.find(agentFilter).select("fullName agentCode active deletedAt").lean(),
    Lead.aggregate([
      { $match: leadScope },
      {
        $group: {
          _id: "$assignedAgentId",
          assigned: { $sum: 1 },
          remaining: countIf({
            $and: [
              { $eq: [{ $ifNull: ["$lastOutcomeAt", null] }, null] },
              { $ne: ["$doNotCall", true] },
              {
                $not: [
                  {
                    $in: [
                      "$status",
                      [
                        "Converted",
                        "Already Customer",
                        "Not Interested",
                        "Lost",
                        "Do Not Call",
                      ],
                    ],
                  },
                ],
              },
            ],
          }),
        },
      },
    ]),
    FollowUp.aggregate([
      { $match: { ...followScope, status: "pending" } },
      { $group: { _id: "$assignedAgentId", count: { $sum: 1 } } },
    ]),
    req.app?.locals?.live?.snapshot
      ? req.app.locals.live.snapshot(req.user)
      : Promise.resolve({ items: [], serverTime: new Date().toISOString() }),
    Lead.aggregate([
      { $match: leadScope },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Call.countDocuments({
      ...observedScope,
      initiatedAt: { $gte: weekStart, $lt: new Date() },
    }),
    Call.countDocuments({
      ...observedScope,
      initiatedAt: { $gte: monthStart, $lt: new Date() },
    }),
    Call.aggregate([
      { $match: outcomeFilter },
      { $group: outcomeGroup(dayExpr("$reportedAt")) },
    ]),
    Call.aggregate([
      { $match: outcomeFilter },
      { $group: outcomeGroup("$campaignId") },
    ]),
  ]);
  const campaignRows = new Map(
    (phoneRows[0]?.campaigns || []).map((row) => [
      String(row._id),
      normalize(row),
    ]),
  );
  for (const row of campaignOutcomes)
    campaignRows.set(String(row._id), {
      ...(campaignRows.get(String(row._id)) || normalize({ _id: row._id })),
      ...row,
    });
  const campaignNames = await Campaign.find({
    ...tenant(req),
    _id: {
      $in: [...campaignRows.values()]
        .filter((row) => row._id)
        .map((row) => row._id),
    },
  })
    .select("name")
    .lean();
  const totals = normalize(phoneRows[0]?.totals[0]);
  for (const row of outcomeRows)
    for (const key of [
      "interested",
      "converted",
      "followups",
      "reportedAttempts",
    ])
      totals[key] += row[key] || 0;
  const agents = users.map((user) => {
    const equal = (item) => String(item._id) === String(user._id),
      row = {
        ...normalize(phoneRows[0]?.agents.find(equal)),
        ...outcomeRows.find(equal),
        ...user,
      };
    const assignment = leads.find(equal),
      status = live.items.find((item) => String(item._id) === String(user._id));
    const fresh =
      status?.phoneObservedAt &&
      Date.now() - new Date(status.phoneObservedAt).getTime() <= 45000;
    const verified = Boolean(
      status?.phoneStateVerified && status.call?.deviceActive && fresh,
    );
    return {
      ...row,
      conversionRate: row.reportedAttempts
        ? Math.round((1000 * row.converted) / row.reportedAttempts) / 10
        : 0,
      interestedRate: row.reportedAttempts
        ? Math.round((1000 * row.interested) / row.reportedAttempts) / 10
        : 0,
      assigned: assignment?.assigned || 0,
      remaining: assignment?.remaining || 0,
      pendingFollowUps: pending.find(equal)?.count || 0,
      online: Boolean(status?.online),
      phoneStateVerified: verified,
      phoneObservedAt: status?.phoneObservedAt,
      lastActivityAt: status?.lastActivityAt,
      status: verified
        ? status.status
        : status?.call?.deviceActive
          ? "Phone state needs refresh"
          : status?.online
            ? user.active
              ? status.status
              : "Disabled"
            : "Offline",
      call: verified ? status.call : null,
    };
  });
  const metric = interval.settings?.rankingMetric || "conversionRate",
    minimum = interval.settings?.rankingMinimumCalls || 5;
  const ranked = agents
    .filter((u) => u.reportedAttempts >= minimum)
    .sort(
      (a, b) =>
        b[metric] - a[metric] ||
        b.reportedAttempts - a.reportedAttempts ||
        a.fullName.localeCompare(b.fullName),
    );
  const daily = new Map(
    (phoneRows[0]?.daily || []).map((row) => [row._id, normalize(row)]),
  );
  for (const row of trendOutcomes)
    daily.set(row._id, {
      ...(daily.get(row._id) || normalize({ _id: row._id })),
      ...row,
    });
  return {
    summary: {
      ...totals,
      pendingFollowUps: pending.reduce((n, row) => n + row.count, 0),
      remaining: leads.reduce((n, row) => n + row.remaining, 0),
      onCall: agents.filter(
        (u) =>
          u.phoneStateVerified &&
          ["ACTIVE", "HOLDING"].includes(u.call?.deviceState),
      ).length,
      totalAgents: agents.length,
      activeAgents: agents.filter((u) => u.active).length,
      onlineAgents: agents.filter((u) => u.online).length,
      offlineAgents: agents.filter((u) => !u.online).length,
      availableAgents: agents.filter(
        (u) => u.online && !u.call && u.status === "Available",
      ).length,
      callsThisWeek: weekCount,
      callsThisMonth: monthCount,
    },
    agents,
    ranking: {
      metric,
      minimumReportedAttempts: minimum,
      top: ranked[0]?._id || null,
      lowest: ranked.length > 1 ? ranked.at(-1)._id : null,
    },
    trends: [...daily.values()].sort((a, b) =>
      String(a._id).localeCompare(String(b._id)),
    ),
    leadStatuses: statusRows,
    campaigns: [...campaignRows.values()].map((row) => ({
      ...row,
      name:
        campaignNames.find((c) => String(c._id) === String(row._id))?.name ||
        (row._id ? "Archived campaign" : "No campaign"),
    })),
    from: interval.from,
    to: interval.to,
    fromDate: interval.fromDate,
    toDate: interval.toDate,
    timezone: interval.timezone,
    period: interval.period,
    serverTime: live.serverTime || new Date().toISOString(),
    definitions: {
      totalCalls: "Android-observed calling attempts",
      talkSeconds:
        "Final Android-observed connected duration; unknown duration excluded",
      outcomes: "Agent-reported results saved within the date range",
      conversionRate:
        "Converted saved results divided by all saved results in the reporting period",
      pendingFollowUps: "Currently pending reminders",
      remaining: "Current assigned active leads without a saved outcome",
      trends:
        "Call events grouped by attempt date; outcomes grouped by saved-result date",
      callsThisWeek:
        "Observed attempts since Monday in Kathmandu; filters retained",
      callsThisMonth:
        "Observed attempts since first day of month in Kathmandu; filters retained",
    },
  };
}
