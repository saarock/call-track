import { Router } from "express";
import { z } from "zod";
import {
  Call,
  Customer,
  Lead,
  terminal,
  callStatuses,
} from "../models/index.js";
import { ownedLead } from "./crmRoutes.js";
import {
  id,
  text,
  own,
  findOwned,
  list,
  fail,
  dateFilter,
  objectId,
  escapeRegex,
} from "../utils/http.js";
import { audit, changed } from "../services/events.js";
import { applyCallEvent } from "../services/callState.js";
export async function callFilter(req, config) {
  const filter = {
    ...own(req),
    isDemo: config.callMode === "demo",
    ...(config.callMode === "sim"
      ? { source: { $in: ["sim", "android-telecom"] } }
      : {}),
    ...dateFilter(req),
  };
  for (const key of ["status", "direction"])
    if (req.query[key]) {
      if (key === "direction" && req.query.direction === "missed") {
        filter.direction = "incoming";
        filter.status = "no-answer";
      } else filter[key] = String(req.query[key]);
    }
  if (req.query.agentId && req.user.role !== "agent") {
    const agentId = objectId(req.query.agentId);
    if (
      req.user.role === "supervisor" &&
      !(req.user.supervisedAgentIds || []).some(
        (id) => String(id) === String(agentId),
      )
    )
      throw fail(403, "Choose an agent assigned to your team");
    filter.agentId = agentId;
  }
  for (const key of ["leadId", "customerId"])
    if (req.query[key]) filter[key] = objectId(req.query[key]);
  if (req.query.q) {
    const customers = await Customer.find({
      companyId: req.user.companyId,
      fullName: { $regex: escapeRegex(req.query.q), $options: "i" },
    }).distinct("_id");
    filter.$or = [
      { phone: { $regex: escapeRegex(req.query.q) } },
      { customerId: { $in: customers } },
    ];
  }
  return filter;
}

export function callRoutes(config) {
  const r = Router();
  const modeScope = {
    isDemo: config.callMode === "demo",
    ...(config.callMode === "sim"
      ? { source: { $in: ["sim", "android-telecom"] } }
      : {}),
  };
  r.get("/calls/active", async (req, res) =>
    res.json({
      items: await Call.find({ ...own(req), ...modeScope, active: true })
        .populate("customerId")
        .populate("agentId", "fullName"),
      serverTime: new Date().toISOString(),
    }),
  );
  r.get("/calls", async (req, res) =>
    res.json(
      await list(Call, req, await callFilter(req, config), [
        { path: "customerId" },
        { path: "agentId", select: "fullName" },
      ]),
    ),
  );
  r.get("/calls/agent/:id", async (req, res) => {
    const agentId = objectId(req.params.id);
    if (req.user.role !== "admin" && String(agentId) !== String(req.user._id))
      throw fail(404, "Agent not found");
    res.json(
      await list(Call, req, { ...(await callFilter(req, config)), agentId }, [
        { path: "customerId" },
      ]),
    );
  });
  r.post("/calls/start", async (req, res) => {
    if (req.user.role !== "agent")
      throw fail(403, "Sign in as an agent to open the dialer");
    const { leadId } = z.object({ leadId: id }).parse(req.body);
    const lead = await ownedLead(req, leadId);
    if (lead.archived) throw fail(400, "Archived leads cannot be called");
    const customer = await Customer.findById(lead.customerId);
    const call = await Call.create({
      companyId: req.user.companyId,
      agentId: req.user._id,
      customerId: customer._id,
      leadId: lead._id,
      phone: customer.phone,
      direction: "outgoing",
      isDemo: config.callMode === "demo",
      source: config.callMode,
      status: config.callMode === "sim" ? "unconfirmed" : "initiated",
    });
    await audit(
      req,
      "call.task_created",
      { leadId: lead._id, customerId: customer._id, callId: call._id },
      {
        text: call.isDemo
          ? "Simulated call started"
          : "SIM dialer requested; telephone connection not verified",
      },
    );
    changed(req);
    res.status(201).json(call);
  });
  r.get("/calls/:id", async (req, res) => {
    const call = await findOwned(Call, req, { ...own(req), ...modeScope });
    await call.populate([
      { path: "customerId" },
      { path: "agentId", select: "fullName" },
      { path: "reportedBy", select: "fullName" },
    ]);
    res.json({ call });
  });
  r.patch("/calls/:id/result", async (req, res) => {
    const call = await findOwned(Call, req, { ...own(req), ...modeScope });
    Object.assign(
      call,
      z.object({ result: text(100), notes: text(4000) }).parse(req.body),
    );
    await call.save();
    await audit(
      req,
      "call.notes",
      { callId: call._id, leadId: call.leadId, customerId: call.customerId },
      { text: call.notes, result: call.result },
    );
    changed(req);
    res.json(call);
  });
  r.post("/calls/:id/report", async (req, res) => {
    if (config.callMode !== "sim")
      throw fail(409, "Manual reports are only available in SIM mode");
    const call = await findOwned(Call, req, {
      ...own(req),
      source: "sim",
      isDemo: false,
    });
    const data = z
      .object({
        status: z.enum([...terminal, "unconfirmed"]),
        talkSeconds: z.number().int().min(0).max(86400).optional(),
        result: text(100).default(""),
        notes: text(4000).default(""),
      })
      .parse(req.body);
    if (!call.active) throw fail(409, "This task already has a saved report");
    if (data.status !== "completed" && data.talkSeconds > 0)
      throw fail(400, "Talk duration is only valid for an answered call");
    const reportedAt = new Date();
    const updated = await Call.findOneAndUpdate(
      { _id: call._id, active: true },
      {
        $set: {
          status: data.status,
          active: false,
          reportedAt,
          reportedBy: req.user._id,
          reportedAnswered: data.status === "completed",
          durationKnown:
            data.status === "completed" && data.talkSeconds !== undefined,
          talkSeconds: data.status === "completed" ? data.talkSeconds || 0 : 0,
          result: data.result,
          notes: data.notes,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: "after" },
    );
    if (!updated) throw fail(409, "This task already has a saved report");
    // Do not invent answer/end times. reportedAt is the reporting time, not the SIM call timestamp.
    await audit(
      req,
      "call.manual_report",
      { callId: call._id, leadId: call.leadId, customerId: call.customerId },
      { ...data, text: data.notes, reportedAt, verification: "self-reported" },
    );
    changed(req);
    res.json(updated);
  });
  r.post("/calls/:id/hangup", async (req, res) => {
    if (config.callMode !== "demo")
      throw fail(
        409,
        "End the SIM call in your phone app; CallTrack cannot hang it up",
      );
    const call = await findOwned(Call, req, { ...own(req), isDemo: true });
    res.json(
      await applyCallEvent(
        call._id,
        { status: call.answeredAt ? "completed" : "canceled" },
        req.app.locals.live,
      ),
    );
  });
  r.post("/demo/calls/:id/events", async (req, res) => {
    if (config.callMode !== "demo") throw fail(404, "Endpoint not found");
    const call = await findOwned(Call, req, { ...own(req), isDemo: true });
    const { status } = z
      .object({
        status: z.enum(callStatuses.filter((s) => s !== "unconfirmed")),
      })
      .parse(req.body);
    res.json(await applyCallEvent(call._id, { status }, req.app.locals.live));
  });
  return r;
}
