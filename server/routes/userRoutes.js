import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { User, Call, Lead } from "../models/index.js";
import { admin, manager, safeUser } from "../middleware/auth.js";
import {
  text,
  phone,
  id,
  findOwned,
  tenant,
  list,
  fail,
} from "../utils/http.js";
import { audit, changed } from "../services/events.js";
export const userRoutes = Router();
userRoutes.patch("/me/availability", async (req, res) => {
  const { availability } = z
    .object({
      availability: z.enum(["Available", "Busy", "On Break", "Online"]),
    })
    .parse(req.body);
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { availability },
    { returnDocument: "after" },
  );
  changed(req);
  res.json(safeUser(user));
});
userRoutes.use(manager);
userRoutes.get("/", async (req, res) => {
  const result = await list(User, req, {
    ...tenant(req),
    deletedAt: null,
    ...(req.user.role === "supervisor"
      ? { _id: { $in: req.user.supervisedAgentIds || [] }, role: "agent" }
      : {}),
    ...(req.query.role === "agent" ? { role: "agent" } : {}),
  });
  const ids = result.items.map((user) => user._id);
  const [calls, leads] = await Promise.all([
    Call.aggregate([
      {
        $match: {
          ...tenant(req),
          agentId: { $in: ids },
          isDemo: req.app.locals.config.callMode === "demo",
          ...(req.app.locals.config.callMode === "sim"
            ? { source: "android-telecom" }
            : {}),
        },
      },
      {
        $group: {
          _id: "$agentId",
          totalCalls: { $sum: 1 },
          talkSeconds: {
            $sum: { $cond: ["$durationKnown", "$talkSeconds", 0] },
          },
        },
      },
    ]),
    Lead.aggregate([
      {
        $match: {
          ...tenant(req),
          assignedAgentId: { $in: ids },
          archived: false,
        },
      },
      { $group: { _id: "$assignedAgentId", count: { $sum: 1 } } },
    ]),
  ]);
  result.items = result.items.map((user) => ({
    ...user,
    totalCalls:
      calls.find((c) => String(c._id) === String(user._id))?.totalCalls || 0,
    talkSeconds:
      calls.find((c) => String(c._id) === String(user._id))?.talkSeconds || 0,
    assignedLeads:
      leads.find((l) => String(l._id) === String(user._id))?.count || 0,
  }));
  res.json(result);
});
const fields = z.object({
  fullName: text(100).min(1),
  email: z.string().email().max(200),
  phone: phone.optional().or(z.literal("")),
  agentCode: text(40).min(1),
});
userRoutes.post("/", admin, async (req, res) => {
  const data = fields
    .extend({
      password: z.string().min(12).max(72),
      role: z.enum(["agent", "supervisor"]).default("agent"),
    })
    .parse(req.body);
  const { password, ...rest } = data;
  const user = await User.create({
    ...rest,
    ...tenant(req),
    role: data.role,
    passwordHash: await bcrypt.hash(password, 12),
  });
  await audit(req, "agent.created", {}, { userId: user._id });
  changed(req);
  res.status(201).json(safeUser(user));
});
userRoutes.get("/:id", async (req, res) => {
  if (
    req.user.role === "supervisor" &&
    !(req.user.supervisedAgentIds || []).some(
      (value) => String(value) === req.params.id,
    )
  )
    throw fail(404, "Agent not found");
  const user = await findOwned(User, req);
  res.json(safeUser(user));
});
userRoutes.put("/:id/team", admin, async (req, res) => {
  const data = z
    .object({
      agentIds: z.array(id).max(500),
      campaignIds: z.array(id).max(500).default([]),
    })
    .parse(req.body);
  const user = await findOwned(User, req);
  if (user.role !== "supervisor") throw fail(400, "Choose a supervisor");
  const agents = await User.countDocuments({
    ...tenant(req),
    _id: { $in: data.agentIds },
    role: "agent",
    deletedAt: null,
  });
  if (agents !== new Set(data.agentIds).size)
    throw fail(400, "Choose company agents");
  const { Campaign } = await import("../models/campaign.js");
  const campaigns = await Campaign.countDocuments({
    ...tenant(req),
    _id: { $in: data.campaignIds },
    deletedAt: null,
  });
  if (campaigns !== new Set(data.campaignIds).size)
    throw fail(400, "Choose company campaigns");
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        supervisedAgentIds: data.agentIds,
        assignedCampaignIds: data.campaignIds,
      },
      $inc: { tokenVersion: 1 },
    },
  );
  req.app.locals.live?.revoke(user._id);
  await audit(
    req,
    "supervisor.team.updated",
    {},
    {
      userId: user._id,
      agentIds: data.agentIds,
      campaignIds: data.campaignIds,
    },
  );
  changed(req);
  res.json(safeUser(await User.findById(user._id)));
});
userRoutes.patch("/:id/password", admin, async (req, res) => {
  const { password } = z
    .object({ password: z.string().min(12).max(72) })
    .parse(req.body);
  const user = await findOwned(User, req);
  if (user.role === "admin")
    throw fail(
      400,
      "Use personal account settings to change an administrator password",
    );
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await bcrypt.hash(password, 12) },
      $inc: { tokenVersion: 1 },
    },
  );
  req.app.locals.live?.revoke(user._id);
  await audit(req, "account.password-reset", {}, { userId: user._id });
  changed(req);
  res.json({ ok: true });
});
userRoutes.put("/:id", admin, async (req, res) => {
  const data = fields.partial().parse(req.body);
  const user = await findOwned(User, req);
  if (!["agent", "supervisor"].includes(user.role))
    throw fail(400, "Use profile controls for admin accounts");
  Object.assign(user, data);
  await user.save();
  await audit(req, "agent.updated", {}, { userId: user._id });
  changed(req);
  res.json(safeUser(user));
});
userRoutes.patch("/:id/status", admin, async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const user = await findOwned(User, req);
  if (user.role !== "agent")
    throw fail(400, "Only agent accounts can be deactivated here");
  if (
    !active &&
    (await Call.exists({
      ...tenant(req),
      agentId: user._id,
      $or: [{ active: true }, { deviceActive: true }],
    }))
  )
    throw fail(409, "End the agent’s active call before deactivating");
  await User.updateOne(
    { _id: user._id },
    { $set: { active }, $inc: { tokenVersion: 1 } },
  );
  req.app.locals.live?.revoke(user._id);
  await audit(req, "agent.status", {}, { userId: user._id, active });
  changed(req);
  res.json({ ok: true });
});
userRoutes.delete("/:id", admin, async (req, res) => {
  const user = await findOwned(User, req);
  if (user.role !== "agent")
    throw fail(400, "Only agent accounts can be removed here");
  if (
    await Call.exists({
      ...tenant(req),
      agentId: user._id,
      $or: [{ active: true }, { deviceActive: true }],
    })
  )
    throw fail(
      409,
      "Finish the agent's active call before removing the account",
    );
  if (
    await Lead.exists({
      ...tenant(req),
      assignedAgentId: user._id,
      archived: false,
      deletedAt: null,
    })
  )
    throw fail(
      409,
      "Reassign the agent's active leads before removing the account",
    );
  await User.updateOne(
    { _id: user._id },
    {
      $set: { active: false, deletedAt: new Date() },
      $inc: { tokenVersion: 1 },
    },
  );
  req.app.locals.live?.revoke(user._id);
  await audit(
    req,
    "agent.removed",
    {},
    { userId: user._id, historyRetained: true },
  );
  changed(req);
  res.json({ ok: true, historyRetained: true });
});
