import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";
import {
  Call,
  Settings,
  Activity,
  Lead,
  FollowUp,
  Recording,
} from "../models/index.js";
import { DailyReport } from "../models/operations.js";
import { admin, manager } from "../middleware/auth.js";
import { tenant, own, objectId, page, fail } from "../utils/http.js";
import { audit, changed } from "../services/events.js";
import {
  performanceReport,
  performanceFilter,
} from "../services/performance.js";
import {
  generateDailyReport,
  smtpReadiness,
} from "../services/dailyReports.js";
import { ownedLead } from "./crmRoutes.js";

export const operationsRoutes = Router();
const reportTypes = [
  "calls",
  "agents",
  "duration",
  "direction",
  "leads",
  "conversions",
  "callbacks",
  "recordings",
  "campaigns",
];
async function callViews(items, req) {
  const recordings = await Recording.find({
    ...tenant(req),
    callId: { $in: items.map((call) => call._id) },
    source: "agent-upload",
    status: "available",
    deletedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .select("callId")
    .lean();
  const available = new Set(recordings.map((record) => String(record.callId)));
  return items.map((call) => ({
    ...call,
    metadataVerified: call.verification?.method === "android-telecom",
    recordingAvailable: available.has(String(call._id)),
  }));
}
operationsRoutes.get("/reports/catalog", async (req, res) =>
  res.json({
    reports: [
      { type: "calls", name: "Daily / weekly / monthly call report" },
      { type: "agents", name: "Individual agent report" },
      { type: "duration", name: "Call duration report" },
      { type: "direction", name: "Incoming / outgoing / missed report" },
      { type: "leads", name: "Lead status report" },
      { type: "conversions", name: "Conversion report" },
      { type: "callbacks", name: "Callback report" },
      { type: "recordings", name: "Recording availability report" },
      { type: "campaigns", name: "Campaign performance report" },
    ],
    periods: ["today", "yesterday", "week", "month", "custom"],
    conversionDenominator: "All saved results in the selected reporting period",
    telephoneEvidence:
      "Only Android-observed call events count toward telephone statistics",
  }),
);
operationsRoutes.get("/reports/my-performance", async (req, res) =>
  res.json(await performanceReport(req)),
);
operationsRoutes.get("/reports/overview", manager, async (req, res) =>
  res.json(await performanceReport(req)),
);
operationsRoutes.get("/reports/records", manager, async (req, res) => {
  const { filter } = await performanceFilter(req),
    paging = page(req);
  const [items, total] = await Promise.all([
    Call.find(filter)
      .sort({ initiatedAt: -1, _id: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate("agentId", "fullName agentCode")
      .populate("customerId", "fullName phone")
      .lean(),
    Call.countDocuments(filter),
  ]);
  res.set("Cache-Control", "no-store").json({
    items: await callViews(items, req),
    total,
    page: paging.page,
    hasMore: paging.skip + items.length < total,
  });
});
async function exportRows(req, type) {
  const { filter, interval } = await performanceFilter(req);
  if (type === "direction") {
    const report = await performanceReport(req);
    return {
      interval,
      rows: ["incoming", "outgoing", "missed", "answered"].map((direction) => ({
        direction,
        observedCalls: report.summary[direction],
        from: interval.fromDate,
        to: interval.toDate,
        timezone: interval.timezone,
      })),
    };
  }
  if (["agents", "campaigns"].includes(type)) {
    const report = await performanceReport(req);
    const source = type === "agents" ? report.agents : report.campaigns;
    return {
      interval,
      rows: source.map((a) => ({
        id: String(a._id || ""),
        name: a.fullName || a.name || "",
        calls: a.totalCalls,
        incoming: a.incoming,
        outgoing: a.outgoing,
        missed: a.missed,
        answered: a.answered,
        talkSeconds: a.talkSeconds,
        averageSeconds: a.averageSeconds,
        interested: a.interested,
        converted: a.converted,
        reportedAttempts: a.reportedAttempts,
        conversionRate:
          a.conversionRate ??
          (a.reportedAttempts
            ? Math.round((1000 * a.converted) / a.reportedAttempts) / 10
            : 0),
        pendingCallbacks: a.pendingFollowUps ?? "",
        remaining: a.remaining ?? "",
      })),
    };
  }
  const extra = {
    ...(filter.agentId ? { assignedAgentId: filter.agentId } : {}),
    ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
  };
  if (type === "leads") {
    const query = { ...own(req, "assignedAgentId"), deletedAt: null, ...extra };
    if ((await Lead.countDocuments(query)) > 10000)
      throw fail(400, "Narrow filters to export at most 10,000 leads");
    const leads = await Lead.find(query)
      .populate("customerId")
      .populate("assignedAgentId", "fullName")
      .lean();
    return {
      interval,
      rows: leads.map((l) => ({
        id: String(l._id),
        customer: l.customerId?.fullName || "",
        phone: l.customerId?.phone || "",
        agent: l.assignedAgentId?.fullName || "",
        campaignId: String(l.campaignId || ""),
        status: l.status,
        priority: l.priority,
        source: l.source,
        lastOutcome: l.lastOutcome || "",
        lastOutcomeAt: l.lastOutcomeAt?.toISOString() || "",
        doNotCall: Boolean(l.doNotCall || l.customerId?.doNotCall),
      })),
    };
  }
  if (type === "callbacks") {
    const query = {
      ...own(req, "assignedAgentId"),
      ...extra,
      dueAt: { $gte: interval.from, $lt: interval.to },
    };
    if ((await FollowUp.countDocuments(query)) > 10000)
      throw fail(400, "Narrow filters to export at most 10,000 callbacks");
    const rows = await FollowUp.find(query)
      .populate("customerId", "fullName phone")
      .populate("assignedAgentId", "fullName")
      .sort({ dueAt: 1 })
      .lean();
    return {
      interval,
      rows: rows.map((f) => ({
        id: String(f._id),
        customer: f.customerId?.fullName || "",
        phone: f.customerId?.phone || "",
        agent: f.assignedAgentId?.fullName || "",
        dueAt: f.dueAt?.toISOString() || "",
        status: f.status,
        completedAt: f.completedAt?.toISOString() || "",
        notes: f.notes || "",
      })),
    };
  }
  const query = { ...filter };
  if (type === "conversions") {
    delete query.initiatedAt;
    query.reportedAt = { $gte: interval.from, $lt: interval.to };
    query.businessResult = "converted";
    query.businessSyncComplete = true;
  }
  if ((await Call.countDocuments(query)) > 10000)
    throw fail(400, "Narrow the filters to export at most 10,000 calls");
  const calls = await Call.find(query)
    .sort({ initiatedAt: 1 })
    .populate("agentId", "fullName")
    .populate("customerId", "fullName")
    .lean();
  const ids = calls.map((c) => c._id),
    metadata =
      type === "recordings"
        ? await Recording.find({
            ...tenant(req),
            callId: { $in: ids },
            source: "agent-upload",
          })
            .sort({ createdAt: -1 })
            .lean()
        : [];
  const rows = calls.map((c) => ({
    id: String(c._id),
    agent: c.agentId?.fullName || "",
    customer: c.customerId?.fullName || c.customerName || "",
    phone: c.phone,
    campaignId: String(c.campaignId || ""),
    deviceId: c.deviceId || "",
    callingMethod: c.source,
    synchronization: c.businessSyncComplete
      ? "Result synchronized"
      : "Result pending",
    direction: c.direction,
    callState: c.status,
    initiatedAt: c.initiatedAt?.toISOString() || "",
    ringingAt: c.ringingAt?.toISOString() || "",
    answeredAt: c.answeredAt?.toISOString() || "",
    endedAt: c.endedAt?.toISOString() || "",
    talkSeconds:
      c.verification?.method === "android-telecom" && c.durationKnown
        ? c.talkSeconds
        : "",
    verification:
      c.verification?.method === "android-telecom"
        ? "Android-observed"
        : "Manually reported; telephone state unverified",
    outcome: c.businessResult || c.result || "",
    notes: c.notes || "",
    reportedAt: c.reportedAt?.toISOString() || "",
    recording:
      metadata.find(
        (r) =>
          String(r.callId) === String(c._id) &&
          r.status === "available" &&
          !r.deletedAt &&
          r.expiresAt > new Date(),
      )?.status ||
      metadata.find(
        (r) => String(r.callId) === String(c._id) && r.status !== "available",
      )?.status ||
      (metadata.some((r) => String(r.callId) === String(c._id))
        ? "Expired"
        : null) ||
      "Unavailable: no supported audio source",
  }));
  return { interval, rows };
}
operationsRoutes.get("/reports/download", manager, async (req, res) => {
  const format = String(req.query.format || "csv"),
    type = String(req.query.type || "calls");
  if (!["csv", "xlsx"].includes(format) || !reportTypes.includes(type))
    throw fail(400, "Choose a valid report type and CSV or XLSX");
  const { rows, interval } = await exportRows(req, type);
  const columns = rows.length
    ? Object.keys(rows[0])
    : type === "agents"
      ? [
          "id",
          "name",
          "calls",
          "talkSeconds",
          "interested",
          "converted",
          "conversionRate",
        ]
      : ["id"];
  await audit(
    req,
    "report.exported",
    {},
    { format, type, count: rows.length, from: interval.from, to: interval.to },
  );
  res.set("Cache-Control", "no-store");
  if (format === "csv") {
    const safe = (v) =>
      typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
    return res
      .type("text/csv")
      .attachment("calltrack-" + type + ".csv")
      .send(
        stringify(
          rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k, safe(v)]),
            ),
          ),
          { header: true, columns },
        ),
      );
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CallTrack";
  const sheet = workbook.addWorksheet(type[0].toUpperCase() + type.slice(1));
  sheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: ["notes", "verification"].includes(key) ? 45 : 24,
  }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment("calltrack-" + type + ".xlsx")
    .send(Buffer.from(await workbook.xlsx.writeBuffer()));
});
operationsRoutes.get("/reports/daily", admin, async (req, res) => {
  const paging = page(req),
    filter = tenant(req);
  const [items, total] = await Promise.all([
    DailyReport.find(filter)
      .sort({ date: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .lean(),
    DailyReport.countDocuments(filter),
  ]);
  res.json({
    items,
    total,
    page: paging.page,
    hasMore: paging.skip + items.length < total,
  });
});
operationsRoutes.post("/reports/daily/generate", admin, async (req, res) => {
  const { date } = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .parse(req.body);
  const report = await generateDailyReport(
    req.user.companyId,
    date,
    req.app.locals.live,
  );
  await audit(req, "report.generated", {}, { date });
  changed(req);
  res.json(report);
});
operationsRoutes.get("/operations/settings", manager, async (req, res) => {
  const settings = await Settings.findOne(tenant(req)).lean();
  const visible =
    req.user.role === "admin"
      ? settings
      : {
          name: settings?.name,
          timezone: settings?.timezone,
          retentionDays: settings?.retentionDays,
        };
  res.json({
    settings: visible,
    integrations: {
      smtpConfigured: smtpReadiness(),
      whatsappBusinessConfigured: false,
      smsProviderConfigured: false,
      pbxConfigured: false,
      recordingSupported: false,
      liveListeningSupported: false,
    },
    monitoringNotice:
      "CallTrack shares business call metadata and saved customer notes with your company. SIM call audio is not collected. Android call-state metadata requires the default phone role and phone permissions.",
    externalRequirements: {
      recording:
        "Authorized PBX/SIP or manufacturer audio source, recording notice and consent, secure media storage and lifecycle.",
      liveListening:
        "Authorized media bridge on PBX/carrier platform; unavailable for normal cellular SIM audio.",
      messaging:
        "Configure an approved provider and authorized templates before automated WhatsApp/SMS delivery.",
    },
  });
});
operationsRoutes.put("/operations/settings", admin, async (req, res) => {
  const data = z
    .object({
      rankingMetric: z
        .enum(["conversionRate", "interestedRate", "talkSeconds"])
        .optional(),
      rankingMinimumCalls: z.number().int().min(1).max(10000).optional(),
      dailyReportEnabled: z.boolean().optional(),
      dailyReportHour: z.number().int().min(0).max(23).optional(),
      dailyReportMinute: z.number().int().min(0).max(59).optional(),
      dailyReportEmailEnabled: z.boolean().optional(),
      dailyReportEmails: z
        .array(z.string().email().max(200))
        .max(10)
        .optional(),
      retentionDays: z.number().int().min(1).max(365).optional(),
      powerDialer: z
        .object({
          maxAttempts: z.number().int().min(1).max(10).optional(),
          noAnswerRetryMinutes: z.number().int().min(1).max(43200).optional(),
          busyRetryMinutes: z.number().int().min(1).max(43200).optional(),
          skipRetryMinutes: z.number().int().min(1).max(43200).optional(),
          callDelaySeconds: z.number().int().min(0).max(120).optional(),
        })
        .optional(),
    })
    .parse(req.body);
  const update = { ...data };
  delete update.powerDialer;
  for (const [key, value] of Object.entries(data.powerDialer || {}))
    update["powerDialer." + key] = value;
  const settings = await Settings.findOneAndUpdate(
    tenant(req),
    { $set: update },
    { returnDocument: "after", runValidators: true },
  );
  await audit(req, "report.settings_changed", {}, data);
  changed(req);
  res.json(settings);
});
operationsRoutes.get("/operations/audit", admin, async (req, res) => {
  const paging = page(req),
    filter = {
      ...tenant(req),
      ...(req.query.type ? { type: String(req.query.type).slice(0, 100) } : {}),
    };
  const [items, total] = await Promise.all([
    Activity.find(filter)
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate("actorId", "fullName")
      .lean(),
    Activity.countDocuments(filter),
  ]);
  res.json({
    items,
    total,
    page: paging.page,
    hasMore: paging.skip + items.length < total,
  });
});
operationsRoutes.post("/communications/compose", async (req, res) => {
  const { leadId, channel, text } = z
    .object({
      leadId: z.string(),
      channel: z.enum(["whatsapp", "sms"]),
      text: z.string().trim().max(2000).default(""),
    })
    .parse(req.body);
  const lead = await ownedLead(req, leadId);
  await lead.populate("customerId");
  if (
    lead.doNotCall ||
    lead.customerId.doNotCall ||
    lead.optedOutAt ||
    lead.customerId.optedOutAt
  )
    throw fail(409, "This customer has opted out. Communication is blocked.");
  const number = lead.customerId.phone,
    url =
      channel === "whatsapp"
        ? "https://wa.me/" +
          number.replace(/\D/g, "") +
          "?text=" +
          encodeURIComponent(text)
        : "sms:" + number + "?body=" + encodeURIComponent(text);
  await audit(
    req,
    "communication.composer_opened",
    { leadId: lead._id, customerId: lead.customerId._id },
    {
      channel,
      text,
      delivery: "unconfirmed",
      notice:
        "Composer requested; sending remains a user action in the messaging app",
    },
  );
  changed(req);
  res.json({ url, channel, delivery: "unconfirmed" });
});
