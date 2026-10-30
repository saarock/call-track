import { DateTime } from "luxon";
import nodemailer from "nodemailer";
import { Settings } from "../models/index.js";
import { DailyReport } from "../models/operations.js";
import { performanceReport } from "./performance.js";
import { fail } from "../utils/http.js";

export function smtpReadiness(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  return Boolean(
    env.SMTP_HOST &&
    env.SMTP_USER &&
    env.SMTP_PASSWORD &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SMTP_FROM || "") &&
    [465, 587].includes(port),
  );
}
export async function generateDailyReport(companyId, date, live) {
  await DailyReport.init();
  const settings = await Settings.findOne({ companyId }).lean();
  const timezone = settings?.timezone || "Asia/Kathmandu";
  const day = DateTime.fromISO(String(date), { zone: timezone });
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(date)) ||
    !day.isValid ||
    day >= DateTime.now().setZone(timezone).startOf("day")
  )
    throw fail(400, "Choose a completed day using YYYY-MM-DD");
  const key = { companyId, date },
    now = new Date();
  let doc;
  try {
    doc = await DailyReport.findOneAndUpdate(
      {
        ...key,
        $or: [
          { status: "failed" },
          { status: "generating", leaseUntil: { $lt: now } },
        ],
      },
      {
        $set: {
          status: "generating",
          leaseUntil: new Date(Date.now() + 300000),
          timezone,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return DailyReport.findOne(key).lean();
  }
  try {
    const req = {
      user: { companyId, role: "admin" },
      app: { locals: { live } },
      query: { period: "custom", from: date, to: date },
    };
    const result = await performanceReport(req);
    return await DailyReport.findOneAndUpdate(
      { _id: doc._id, status: "generating" },
      {
        $set: {
          status: "ready",
          summary: result.summary,
          agents: result.agents.map(({ call, ...agent }) => agent),
          generatedAt: new Date(),
          "email.status": !settings?.dailyReportEmailEnabled
            ? "disabled"
            : smtpReadiness()
              ? "pending"
              : "not-configured",
        },
        $unset: { leaseUntil: 1 },
      },
      { returnDocument: "after" },
    ).lean();
  } catch (error) {
    await DailyReport.updateOne(
      { _id: doc._id },
      { $set: { status: "failed" }, $unset: { leaseUntil: 1 } },
    );
    throw error;
  }
}
export function dailyReportText(report, companyName) {
  const s = report.summary;
  const lines = [
    `${companyName} — CallTrack daily report`,
    `${report.date} (${report.timezone})`,
    "",
    `Android-observed calls: ${s.totalCalls}`,
    `Verified talk time: ${s.talkSeconds} seconds`,
    `Interested: ${s.interested}`,
    `Converted: ${s.converted}`,
    `Missed: ${s.missed}`,
    `Pending follow-ups at generation: ${s.pendingFollowUps}`,
    `Remaining assigned numbers at generation: ${s.remaining}`,
    "",
    "Agent | Calls | Talk seconds | Interested | Converted | Missed | Pending | Remaining",
  ];
  for (const a of report.agents)
    lines.push(
      [
        a.fullName,
        a.totalCalls,
        a.talkSeconds,
        a.interested,
        a.converted,
        a.missed,
        a.pendingFollowUps,
        a.remaining,
      ].join(" | "),
    );
  lines.push(
    "",
    "Call counts and talk time use Android-observed metadata. Outcomes are reported by agents. Pending and remaining are a snapshot at generation.",
  );
  return lines.join("\n");
}
export async function deliverDailyReport(
  reportId,
  { transport, env = process.env } = {},
) {
  const report = await DailyReport.findById(reportId).lean();
  if (!report || report.status !== "ready") return false;
  const settings = await Settings.findOne({
    companyId: report.companyId,
  }).lean();
  if (!settings?.dailyReportEmailEnabled || !settings.dailyReportEmails?.length)
    return false;
  if (!smtpReadiness(env)) {
    await DailyReport.updateOne(
      { _id: reportId, "email.status": { $in: ["pending", "not-configured"] } },
      { $set: { "email.status": "not-configured" } },
    );
    return false;
  }
  // Claim delivery once across workers. A process interrupted after SMTP accepts
  // remains 'sending' for manual investigation, avoiding blind duplicate sends.
  const claimed = await DailyReport.findOneAndUpdate(
    { _id: reportId, "email.status": { $in: ["pending", "not-configured"] } },
    { $set: { "email.status": "sending", "email.error": null } },
    { returnDocument: "after" },
  );
  if (!claimed) return false;
  const sender =
    transport ||
    nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: Number(env.SMTP_PORT || 587) === 465,
      requireTLS: true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
  try {
    const result = await sender.sendMail({
      from: env.SMTP_FROM,
      to: settings.dailyReportEmails.join(", "),
      subject: `${settings.name} — CallTrack report ${report.date}`,
      text: dailyReportText(report, settings.name),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await DailyReport.updateOne(
      { _id: reportId, "email.status": "sending" },
      {
        $set: {
          "email.status": "sent",
          "email.sentAt": new Date(),
          "email.messageId": String(result.messageId || "").slice(0, 200),
        },
      },
    );
    return true;
  } catch {
    await DailyReport.updateOne(
      { _id: reportId, "email.status": "sending" },
      {
        $set: {
          "email.status": "failed",
          "email.error":
            "Delivery failed. Verify SMTP configuration and server logs before retrying.",
        },
      },
    );
    return false;
  } finally {
    if (!transport) sender.close();
  }
}
export async function runDailyReports(live, now = DateTime.now()) {
  const companies = await Settings.find({ dailyReportEnabled: true }).lean();
  for (const settings of companies) {
    const local = now.setZone(settings.timezone || "Asia/Kathmandu");
    if (
      !local.isValid ||
      local.hour * 60 + local.minute <
        (settings.dailyReportHour ?? 18) * 60 +
          (settings.dailyReportMinute ?? 0)
    )
      continue;
    const report = await generateDailyReport(
      settings.companyId,
      local.minus({ days: 1 }).toISODate(),
      live,
    );
    if (report?.status === "ready") await deliverDailyReport(report._id);
  }
}
