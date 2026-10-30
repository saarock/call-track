import { allowedCampaign } from "../routes/campaignRoutes.js";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { Call, Customer, Lead, FollowUp, Settings } from "../models/index.js";
import { DialerSession, DialerReservation } from "../models/power.js";
import { fail, own, tenant, objectId } from "../utils/http.js";
import { audit, changed } from "./events.js";

const leaseMs = 120000;
export function requireAgent(req) {
  if (req.user.role !== "agent") throw fail(403, "Agent access required");
  if (req.app.locals.config.callMode !== "sim")
    throw fail(409, "Power dialing requires real SIM mode");
}
const owner = (req) => ({ ...tenant(req), agentId: req.user._id });
export async function expireUnusedReservations(companyId) {
  // Never automatically release a dialed number: an offline handset may still be on the call.
  await DialerReservation.updateMany(
    {
      companyId,
      active: true,
      state: { $in: ["reserved", "mutation"] },
      expiresAt: { $lte: new Date() },
    },
    {
      $set: {
        active: false,
        state: "expired",
        releasedAt: new Date(),
        releaseReason: "Unused reservation expired",
      },
    },
  );
}
export async function withNumberMutation(req, customer, task) {
  await expireUnusedReservations(req.user.companyId);
  let guard;
  try {
    guard = await DialerReservation.create({
      ...tenant(req),
      phone: customer.phone,
      customerId: customer._id,
      kind: "mutation",
      state: "mutation",
      active: true,
      expiresAt: new Date(Date.now() + leaseMs),
    });
  } catch (error) {
    if (error.code === 11000)
      throw fail(
        409,
        "This number is reserved or being called. Finish the call result before changing it.",
      );
    throw error;
  }
  try {
    return await task();
  } finally {
    await DialerReservation.updateOne(
      { _id: guard._id },
      { $set: { active: false, state: "released", releasedAt: new Date() } },
    );
  }
}
export async function getSession(req, sessionId) {
  return DialerSession.findOne({
    ...owner(req),
    ...(sessionId ? { sessionId } : { open: true }),
  });
}
async function openSession(req, sessionId, mode = "power", campaignId = null) {
  requireAgent(req);
  let existing = await getSession(req, sessionId);
  if (existing) return existing;
  const current = await getSession(req);
  if (current) return current;
  try {
    return await DialerSession.create({
      ...owner(req),
      sessionId,
      mode,
      campaignId,
      status: mode === "manual" ? "paused" : "running",
      lastHeartbeatAt: new Date(),
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return getSession(req);
  }
}
export async function startSession(req, sessionId, campaignId) {
  if (campaignId) await allowedCampaign(req, campaignId, { active: true });
  const session = await openSession(req, sessionId, "power", campaignId);
  if (session && !session.campaignId && campaignId) {
    if (
      await DialerReservation.exists({
        ...owner(req),
        active: true,
        kind: "call",
      })
    )
      throw fail(409, "Finish the current number before selecting a campaign");
    session.campaignId = campaignId;
    await session.save();
  }
  if (
    session?.campaignId &&
    campaignId &&
    String(session.campaignId) !== campaignId
  )
    throw fail(
      409,
      "Stop the previous campaign session before choosing a different campaign",
    );
  if (!session || !session.open) throw fail(409, "Start a new calling session");
  if (session.status !== "running" || session.mode !== "power") {
    session.status = "running";
    session.mode = "power";
    session.lastHeartbeatAt = new Date();
    await session.save();
  }
  changed(req);
  return sessionView(req);
}
async function candidates(req, { includeLocked = false } = {}) {
  const now = new Date();
  const currentSession = await getSession(req);
  const campaignId = currentSession?.campaignId || req.query?.campaignId;
  if (campaignId) {
    const campaign = await allowedCampaign(req, campaignId);
    if (campaign.status !== "active") return [];
  }
  const [leads, followUps, reservations, settings] = await Promise.all([
    Lead.find({
      ...(campaignId
        ? {
            ...tenant(req),
            $or: [{ assignedAgentId: req.user._id }, { assignedAgentId: null }],
          }
        : own(req, "assignedAgentId")),
      archived: false,
      deletedAt: null,
      ...(campaignId ? { campaignId } : {}),
    })
      .populate("customerId")
      .sort({ assignedAt: 1, createdAt: 1, _id: 1 })
      .limit(10000)
      .lean(),
    FollowUp.find({ ...own(req, "assignedAgentId"), status: "pending" })
      .sort({ dueAt: 1 })
      .lean(),
    DialerReservation.find({ ...tenant(req), active: true })
      .select("phone agentId state")
      .lean(),
    Settings.findOne(tenant(req)).lean(),
  ]);
  const counts = await DialerReservation.aggregate([
    {
      $match: {
        ...tenant(req),
        kind: "call",
        leadId: { $in: leads.map((lead) => lead._id) },
        attemptAt: { $ne: null },
      },
    },
    { $group: { _id: "$leadId", total: { $sum: 1 } } },
  ]);
  const attempts = new Map(
    counts.map((item) => [String(item._id), item.total]),
  );
  const due = new Map();
  for (const reminder of followUps)
    if (!due.has(String(reminder.leadId)))
      due.set(String(reminder.leadId), reminder);
  const locks = new Map(reservations.map((item) => [item.phone, item]));
  const max = settings?.powerDialer?.maxAttempts || 3;
  const items = [];
  for (const lead of leads) {
    const contact = lead.customerId;
    if (!contact || contact.doNotCall || lead.status === "Do Not Call")
      continue;
    const reminder = due.get(String(lead._id));
    const dueNow = reminder && reminder.dueAt <= now;
    if (lead.dialingClosed && !dueNow) continue;
    if (lead.nextAttemptAt > now || (reminder && !dueNow)) continue;
    if ((attempts.get(String(lead._id)) || 0) >= max && !dueNow) continue;
    const lock = locks.get(contact.phone);
    if (lock && !includeLocked) continue;
    items.push({
      leadId: lead._id,
      phone: contact.phone,
      customerName: contact.fullName,
      customerId: contact._id,
      status: lead.status,
      lastOutcome: lead.lastOutcome || null,
      attempts: attempts.get(String(lead._id)) || 0,
      callbackAt: reminder?.dueAt || null,
      reserved: Boolean(lock),
      reservedBySelf: Boolean(
        lock && String(lock.agentId) === String(req.user._id),
      ),
    });
  }
  items.sort(
    (a, b) =>
      (a.callbackAt ? +new Date(a.callbackAt) : Infinity) -
      (b.callbackAt ? +new Date(b.callbackAt) : Infinity),
  );
  return items;
}
export async function sessionView(req) {
  requireAgent(req);
  await expireUnusedReservations(req.user.companyId);
  const session = await getSession(req);
  const [reservation, queue, complete, settings] = await Promise.all([
    DialerReservation.findOne({
      ...owner(req),
      kind: "call",
      active: true,
    }).lean(),
    candidates(req),
    session
      ? DialerReservation.find({
          ...owner(req),
          sessionId: session.sessionId,
          kind: "call",
          state: "completed",
        })
          .select("result")
          .lean()
      : [],
    Settings.findOne(tenant(req)).select("powerDialer").lean(),
  ]);
  return {
    session: session
      ? {
          sessionId: session.sessionId,
          campaignId: session.campaignId,
          status: session.status,
          mode: session.mode,
          startedAt: session.startedAt,
          lastHeartbeatAt: session.lastHeartbeatAt,
        }
      : null,
    reservation,
    progress: {
      called: complete.length,
      remaining: queue.length + (reservation ? 1 : 0),
      interested: complete.filter((item) => item.result === "interested")
        .length,
      followUps: complete.filter((item) =>
        ["follow-up", "call-later"].includes(item.result),
      ).length,
    },
    queue: queue
      .slice(0, 100)
      .map((item, index) => ({ ...item, position: index + 1 })),
    queueTotal: queue.length,
    callDelaySeconds: settings?.powerDialer?.callDelaySeconds ?? 2,
    timezone: "Asia/Kathmandu",
  };
}
export async function reserveNext(req, data, manual = false) {
  requireAgent(req);
  await expireUnusedReservations(req.user.companyId);
  let session = manual
    ? await openSession(req, randomUUID(), "manual")
    : await getSession(req, data.sessionId);
  if (!session || !session.open || (!manual && session.status !== "running"))
    throw fail(409, "Start or resume calling first");
  // A replay of a finished request must never silently reserve the next phone.
  const previous = await DialerReservation.findOne({
    ...owner(req),
    sessionId: session.sessionId,
    requestId: data.requestId,
    kind: "call",
  });
  if (previous)
    return {
      ...(await sessionView(req)),
      requestReplayed: true,
      previousReservationId: previous._id,
    };
  const current = await DialerReservation.findOne({
    ...owner(req),
    kind: "call",
    active: true,
  });
  if (current) {
    if (
      (data.leadId && String(current.leadId) !== data.leadId) ||
      (data.phone && current.phone !== data.phone)
    )
      throw fail(
        409,
        "Finish or skip the current number before choosing another",
      );
    return sessionView(req);
  }
  const queue = await candidates(req);
  let choices = data.leadId
    ? queue.filter((item) => String(item.leadId) === data.leadId)
    : queue;
  if (manual && !data.leadId && data.phone) {
    const customer = await Customer.findOne({
      ...tenant(req),
      phone: data.phone,
    });
    if (customer?.doNotCall)
      throw fail(409, "This customer has opted out of calls");
    const lead = customer
      ? await Lead.findOne({
          ...tenant(req),
          customerId: customer._id,
          archived: false,
          deletedAt: null,
        })
      : null;
    if (lead && String(lead.assignedAgentId) !== String(req.user._id))
      throw fail(
        403,
        "This number belongs to another agent or has not been assigned to you",
      );
    if (lead) {
      choices = queue.filter(
        (item) => String(item.leadId) === String(lead._id),
      );
      if (!choices.length)
        throw fail(
          409,
          "This number is reserved, scheduled for later, or no longer eligible",
        );
    } else
      choices = [
        {
          phone: data.phone,
          customerName: customer?.fullName || data.customerName || data.phone,
          customerId: customer?._id,
        },
      ];
  }
  if (data.leadId && !choices.length)
    throw fail(
      409,
      "This lead is reserved, opted out, scheduled for later, or no longer eligible",
    );
  for (const next of choices) {
    let reservation;
    try {
      reservation = await DialerReservation.create({
        ...owner(req),
        sessionId: session.sessionId,
        requestId: data.requestId,
        manual,
        ...next,
        state: "reserved",
        expiresAt: new Date(Date.now() + leaseMs),
        lastHeartbeatAt: new Date(),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Another process can reserve the same number or another request for this agent.
      const active = await DialerReservation.findOne({
        ...owner(req),
        kind: "call",
        active: true,
      });
      if (active) return sessionView(req);
      continue;
    }
    if (next.leadId && session.campaignId) {
      const claimed = await Lead.findOneAndUpdate(
        {
          _id: next.leadId,
          ...tenant(req),
          campaignId: session.campaignId,
          archived: false,
          deletedAt: null,
          assignedAgentId: null,
        },
        {
          $set: {
            assignedAgentId: req.user._id,
            assignedAt: new Date(),
            status: "Assigned",
          },
        },
        { returnDocument: "after" },
      );
      if (claimed)
        await audit(
          req,
          "campaign.contact.claimed",
          { leadId: claimed._id, customerId: claimed.customerId },
          {
            campaignId: String(session.campaignId),
            reservationId: String(reservation._id),
          },
        );
    }
    const lead = next.leadId
      ? await Lead.findOne({
          _id: next.leadId,
          ...own(req, "assignedAgentId"),
          archived: false,
          deletedAt: null,
        }).populate("customerId")
      : null;
    const contact = await Customer.findOne({
      ...tenant(req),
      phone: next.phone,
    });
    const foreignLead =
      !next.leadId && contact
        ? await Lead.exists({
            ...tenant(req),
            customerId: contact._id,
            archived: false,
            deletedAt: null,
            assignedAgentId: { $ne: req.user._id },
          })
        : false;
    session = await getSession(req, session.sessionId);
    if (
      (next.leadId && !lead) ||
      contact?.doNotCall ||
      foreignLead ||
      !session?.open ||
      (!manual && session.status !== "running")
    ) {
      await DialerReservation.updateOne(
        { _id: reservation._id, state: "reserved" },
        {
          $set: {
            active: false,
            state: "released",
            releasedAt: new Date(),
            releaseReason: "Eligibility changed before reservation",
          },
        },
      );
      throw fail(409, "Calling paused or the lead changed; refresh the queue");
    }
    changed(req);
    return sessionView(req);
  }
  if (manual && choices.length)
    throw fail(409, "This number was just reserved by another agent");
  return sessionView(req);
}
export async function authorizeAttempt(req, data) {
  requireAgent(req);
  const filter = {
    _id: objectId(data.reservationId),
    ...owner(req),
    kind: "call",
  };
  const current = await DialerReservation.findOne(filter);
  if (!current || !current.active)
    throw fail(409, "The number reservation has expired or been released");
  if (current.attemptId === data.attemptId)
    return {
      ...(await sessionView(req)),
      dialAuthorized: false,
      alreadyAttempted: true,
    };
  if (current.state !== "reserved")
    throw fail(409, "This number has already been attempted; save its result");
  const session = await getSession(req, current.sessionId);
  const [settings, lastCompleted] = await Promise.all([
    Settings.findOne(tenant(req)).select("powerDialer").lean(),
    DialerReservation.findOne({ ...owner(req), state: "completed" })
      .sort({ releasedAt: -1 })
      .select("releasedAt")
      .lean(),
  ]);
  const readyAt =
    +(lastCompleted?.releasedAt || 0) +
    (settings?.powerDialer?.callDelaySeconds ?? 2) * 1000;
  if (readyAt > Date.now())
    throw fail(
      429,
      "Wait " +
        Math.ceil((readyAt - Date.now()) / 1000) +
        " seconds before the next call",
    );
  if (session?.campaignId)
    await allowedCampaign(req, session.campaignId, { active: true });
  if (
    !session?.open ||
    (!current.manual &&
      session.mode === "power" &&
      session.status !== "running")
  )
    throw fail(409, "Calling is paused");
  const lead = current.leadId
    ? await Lead.findOne({
        _id: current.leadId,
        ...own(req, "assignedAgentId"),
        archived: false,
        deletedAt: null,
      }).populate("customerId")
    : null;
  const contact = await Customer.findOne({
    ...tenant(req),
    phone: current.phone,
  });
  const foreignLead =
    !current.leadId && contact
      ? await Lead.exists({
          ...tenant(req),
          customerId: contact._id,
          archived: false,
          deletedAt: null,
          assignedAgentId: { $ne: req.user._id },
        })
      : false;
  if (
    (current.leadId && (!lead || lead.customerId?.phone !== current.phone)) ||
    contact?.doNotCall ||
    foreignLead
  )
    throw fail(409, "This number is no longer available to call");
  const updated = await DialerReservation.findOneAndUpdate(
    {
      ...filter,
      active: true,
      state: "reserved",
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        state: "dialing",
        attemptId: data.attemptId,
        attemptAt: new Date(),
        expiresAt: null,
        lastHeartbeatAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated)
    return {
      ...(await sessionView(req)),
      dialAuthorized: false,
      alreadyAttempted: true,
    };
  await audit(
    req,
    "dialer.attempt.authorized",
    { leadId: current.leadId, customerId: current.customerId },
    { reservationId: String(current._id), attemptId: data.attemptId },
  );
  changed(req);
  return { ...(await sessionView(req)), dialAuthorized: true };
}
export async function controlSession(req, data) {
  requireAgent(req);
  const session = await getSession(req, data.sessionId);
  if (!session) throw fail(404, "Calling session not found");
  const current = await DialerReservation.findOne({
    ...owner(req),
    kind: "call",
    active: true,
    sessionId: session.sessionId,
  });
  if (data.action === "skip") {
    if (
      !current ||
      (data.reservationId && String(current._id) !== data.reservationId)
    )
      throw fail(409, "This number is no longer reserved");
    if (current.state !== "reserved")
      throw fail(409, "Finish the call and save its result before skipping");
    const settings = await Settings.findOne(tenant(req));
    const released = await DialerReservation.findOneAndUpdate(
      { _id: current._id, active: true, state: "reserved" },
      { $set: { active: false, state: "skipped", releasedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!released)
      throw fail(409, "Calling has already started; save the result");
    await Lead.updateOne(
      { _id: current.leadId, ...tenant(req) },
      {
        $set: {
          nextAttemptAt: new Date(
            Date.now() +
              (settings?.powerDialer?.skipRetryMinutes || 60) * 60000,
          ),
        },
      },
    );
  } else {
    const state = { pause: "paused", resume: "running", stop: "stopped" }[
      data.action
    ];
    if (!session.open) throw fail(409, "Start a new calling session");
    session.status = state;
    session.lastHeartbeatAt = new Date();
    if (data.action === "resume") session.mode = "power";
    if (data.action === "stop") {
      session.open = false;
      session.stoppedAt = new Date();
    }
    await session.save();
    if (
      ["pause", "stop"].includes(data.action) &&
      current?.state === "reserved"
    ) {
      await DialerReservation.updateOne(
        { _id: current._id, state: "reserved", active: true },
        {
          $set: {
            active: false,
            state: "released",
            releasedAt: new Date(),
            releaseReason: "Calling " + state,
          },
        },
      );
    }
  }
  changed(req);
  return sessionView(req);
}
export async function heartbeat(req, data) {
  requireAgent(req);
  await DialerSession.updateOne(
    { ...owner(req), sessionId: data.sessionId, open: true },
    { $set: { lastHeartbeatAt: new Date() } },
  );
  if (data.reservationId) {
    await DialerReservation.updateOne(
      {
        _id: objectId(data.reservationId),
        ...owner(req),
        active: true,
        sessionId: data.sessionId,
      },
      { $set: { lastHeartbeatAt: new Date() } },
    );
    // A missed lease cannot be revived by a delayed heartbeat.
    await DialerReservation.updateOne(
      {
        _id: objectId(data.reservationId),
        ...owner(req),
        active: true,
        state: "reserved",
        expiresAt: { $gt: new Date() },
      },
      { $set: { expiresAt: new Date(Date.now() + leaseMs) } },
    );
  }
  return sessionView(req);
}
export async function attemptFailed(req, data) {
  requireAgent(req);
  const reservation = await DialerReservation.findOneAndUpdate(
    {
      _id: objectId(data.reservationId),
      ...owner(req),
      active: true,
      attemptId: data.attemptId,
      state: "dialing",
      deviceCallId: null,
    },
    {
      $set: {
        state: "report-required",
        endedAt: new Date(),
        releaseReason: "Phone did not confirm call initiation; result required",
      },
    },
    { returnDocument: "after" },
  );
  if (!reservation)
    throw fail(
      409,
      "A device call may be in progress; finish it before reporting",
    );
  return sessionView(req);
}
export async function observeReservedCall(req, call) {
  if (call.direction !== "outgoing") return;
  const reservation = await DialerReservation.findOne({
    ...owner(req),
    active: true,
    kind: "call",
    phone: call.phone,
    state: { $in: ["dialing", "report-required"] },
    attemptAt: { $lte: new Date(+call.initiatedAt + 10000) },
    $or: [{ deviceCallId: null }, { deviceCallId: call.deviceCallId }],
  }).sort({ attemptAt: -1 });
  if (!reservation) return;
  // Avoid binding a much older call flushed from an offline device.
  if (+call.initiatedAt < +reservation.attemptAt - 10000) return;
  await DialerReservation.updateOne(
    { _id: reservation._id, active: true },
    {
      $set: {
        callId: call._id,
        deviceCallId: call.deviceCallId,
        state: call.deviceActive ? "dialing" : "report-required",
        ...(call.endedAt ? { endedAt: call.endedAt } : {}),
      },
    },
  );
  await Call.updateOne(
    { _id: call._id },
    {
      $set: {
        reservationId: reservation._id,
        powerSessionId: reservation.sessionId,
        attemptId: reservation.attemptId,
        ...(reservation.leadId
          ? {
              campaignId: (await Lead.findById(reservation.leadId))?.campaignId,
            }
          : {}),
      },
    },
  );
}
export async function validateReportReservation(req, report, call) {
  const reservationId = report.reservationId || call?.reservationId;
  if (!reservationId) return null;
  const reservation = await DialerReservation.findOne({
    _id: objectId(reservationId),
    ...owner(req),
    kind: "call",
  });
  if (!reservation) throw fail(404, "Calling reservation not found");
  if (reservation.reportKey && reservation.reportKey !== report.reportId)
    throw fail(409, "This attempt already has a result");
  if (report.sessionId && report.sessionId !== reservation.sessionId)
    throw fail(409, "Calling session does not match");
  if (report.attemptId && report.attemptId !== reservation.attemptId)
    throw fail(409, "Calling attempt does not match");
  if (!reservation.attemptAt)
    throw fail(409, "This number was never submitted to the phone");
  if (reservation.phone !== report.phone)
    throw fail(400, "Result number differs from its reservation");
  if (
    reservation.callId &&
    call &&
    String(reservation.callId) !== String(call._id)
  )
    throw fail(409, "Result belongs to a different phone call");
  if (reservation.callId) {
    const deviceCall = await Call.findById(reservation.callId);
    if (deviceCall?.deviceActive)
      throw fail(409, "Finish the phone call before saving its result");
  }
  if (!reservation.active && reservation.state !== "completed")
    throw fail(
      409,
      "This calling attempt was released by an administrator; ask them to reconcile the result",
    );
  return reservation;
}
export async function finishReservation(req, report, call, reservation) {
  if (!reservation) return;
  const match = {
    _id: reservation._id,
    ...owner(req),
    $or: [{ reportKey: null }, { reportKey: report.reportId }],
  };
  const saved = await DialerReservation.findOneAndUpdate(
    match,
    {
      $set: {
        active: false,
        state: "completed",
        releasedAt: new Date(),
        result: report.result,
        reportKey: report.reportId,
        callId: call._id,
      },
    },
    { returnDocument: "after" },
  );
  if (!saved) throw fail(409, "Another result already completed this attempt");
  await Call.updateOne(
    { _id: call._id },
    {
      $set: {
        reservationId: reservation._id,
        powerSessionId: reservation.sessionId,
        attemptId: reservation.attemptId,
      },
    },
  );
}
export async function applyOutcomeQueueRules(req, report, lead) {
  if (!lead) return;
  const settings = await Settings.findOne(tenant(req));
  const retry = settings?.powerDialer || {};
  const at = new Date(report.createdAt);
  const nextAttemptAt = report.followUpAt
    ? new Date(report.followUpAt)
    : ["busy", "no-answer", "unreachable"].includes(report.result)
      ? new Date(
          +at +
            (report.result === "busy"
              ? retry.busyRetryMinutes || 60
              : retry.noAnswerRetryMinutes || 1440) *
              60000,
        )
      : null;
  const dialingClosed = ![
    "busy",
    "no-answer",
    "unreachable",
    "new-lead",
    "follow-up",
    "call-later",
  ].includes(report.result);
  await Lead.updateOne(
    {
      _id: lead._id,
      ...tenant(req),
      $or: [{ lastOutcomeAt: null }, { lastOutcomeAt: { $lte: at } }],
    },
    { $set: { nextAttemptAt, dialingClosed } },
  );
}
export async function releaseReviewedReservation(req, data) {
  if (req.user.role !== "admin")
    throw fail(403, "Administrator access required");
  if (!data.confirmPhoneIdle || !data.reason?.trim())
    throw fail(
      400,
      "Confirm that the agent handset has ended the call and provide a reason",
    );
  const reservation = await DialerReservation.findOne({
    _id: objectId(data.reservationId),
    ...tenant(req),
    active: true,
  });
  if (!reservation) throw fail(404, "Active reservation not found");
  if (
    await Call.exists({
      ...tenant(req),
      phone: reservation.phone,
      deviceActive: true,
      deviceObservedAt: { $gt: new Date(Date.now() - 45000) },
    })
  )
    throw fail(409, "Android still reports an active call");
  // Audit first: if audit storage fails, the number stays protected.
  await audit(
    req,
    "dialer.reservation.reviewed-release",
    { leadId: reservation.leadId, customerId: reservation.customerId },
    {
      reservationId: String(reservation._id),
      reason: data.reason,
      confirmedPhoneIdle: true,
    },
  );
  await DialerReservation.updateOne(
    { _id: reservation._id, active: true },
    {
      $set: {
        active: false,
        state: "released",
        releasedAt: new Date(),
        releaseReason: data.reason,
      },
    },
  );
  changed(req);
  return { success: true };
}
export async function callbackDateFilter(req, filter) {
  if (!["today", "upcoming", "overdue"].includes(req.query.scope))
    return filter;
  const settings = await Settings.findOne(tenant(req));
  const today = DateTime.now()
    .setZone(settings?.timezone || "Asia/Kathmandu")
    .startOf("day");
  filter.status = "pending";
  filter.dueAt =
    req.query.scope === "today"
      ? { $gte: today.toJSDate(), $lt: today.plus({ days: 1 }).toJSDate() }
      : req.query.scope === "upcoming"
        ? { $gte: today.plus({ days: 1 }).toJSDate() }
        : { $lt: new Date() };
  return filter;
}

export async function withCallbackMutation(req, lead, task) {
  return withNumberMutation(
    req,
    { phone: "callback:" + String(lead._id), _id: lead.customerId },
    task,
  );
}
