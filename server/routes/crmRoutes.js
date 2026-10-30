import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { readLeadImport } from "../services/importWorkbook.js";
import {
  User,
  Lead,
  Customer,
  FollowUp,
  Activity,
  Call,
  Settings,
  Notification,
} from "../models/index.js";
import {
  callbackDateFilter,
  withNumberMutation,
  withCallbackMutation,
} from "../services/powerDialer.js";
import { allowedCampaign } from "./campaignRoutes.js";
import { Campaign } from "../models/campaign.js";
import { admin, manager } from "../middleware/auth.js";
import {
  id,
  phone,
  text,
  tenant,
  own,
  findOwned,
  list,
  fail,
  objectId,
  escapeRegex,
  dateFilter,
} from "../utils/http.js";
import { audit, notify, changed } from "../services/events.js";
export const crmRoutes = Router();
export async function ownedLead(req, leadId = req.params.id) {
  const lead = await Lead.findOne({
    _id: objectId(leadId),
    deletedAt: null,
    ...tenant(req),
  });
  if (!lead) throw fail(404, "Lead not found");
  if (
    req.user.role === "agent" &&
    String(lead.assignedAgentId) !== String(req.user._id)
  )
    throw fail(404, "Lead not found");
  if (
    req.user.role === "supervisor" &&
    !(req.user.supervisedAgentIds || []).some(
      (id) => String(id) === String(lead.assignedAgentId),
    )
  ) {
    if (lead.assignedAgentId || !lead.campaignId)
      throw fail(404, "Lead not found");
    await allowedCampaign(req, lead.campaignId);
  }
  return lead;
}
const customerFields = z.object({
  fullName: text(100).min(1),
  phone,
  email: z.string().email().max(200).optional().or(z.literal("")),
  organization: text(200).optional(),
  address: text(500).optional(),
  serviceType: text(100).optional(),
  serviceNotes: text(4000).optional(),
});
const leadFields = z.object({
  source: text(100).optional(),
  priority: z.enum(["Low", "Normal", "High"]).optional(),
  status: text(60).optional(),
  campaignId: id.nullish(),
});
async function validateStatus(req, status) {
  const settings = await Settings.findOne(tenant(req));
  if (status && !settings.leadStatuses.includes(status))
    throw fail(400, "Invalid lead status");
  return settings;
}
async function agent(req, agentId) {
  const user = await User.findOne({
    _id: objectId(agentId),
    ...tenant(req),
    role: "agent",
    active: true,
  });
  if (!user) throw fail(400, "Choose an active agent in this company");
  return user;
}
async function createLead(req, input) {
  const data = customerFields
    .merge(leadFields)
    .extend({ assignedAgentId: id.optional() })
    .parse(input);
  const settings = await validateStatus(req, data.status);
  if (req.user.role === "supervisor")
    throw fail(403, "Only administrators and agents can create customers");
  if (req.user.role === "agent" && !settings.agentCanCreateCustomers)
    throw fail(403, "Customer creation is disabled for agents");
  const assignedAgentId =
    req.user.role === "admin" ? data.assignedAgentId : String(req.user._id);
  if (assignedAgentId) await agent(req, assignedAgentId);
  if (data.campaignId) await allowedCampaign(req, data.campaignId);
  return withNumberMutation(req, { phone: data.phone }, async () => {
    // The phone unique index prevents concurrent duplicate customers. Existing contact details are never overwritten by import.
    let customer = await Customer.findOne({
      ...tenant(req),
      phone: data.phone,
    });
    if (customer)
      throw fail(409, "This phone number already exists. Use its existing customer record or ask your administrator for access.");
    if (!customer) {
      try {
        customer = await Customer.create({
          ...customerFields.parse(data),
          ...tenant(req),
        });
      } catch (e) {
        if (e.code !== 11000) throw e;
        customer = await Customer.findOne({
          ...tenant(req),
          phone: data.phone,
        });
      }
    }
    const lead = await Lead.create({
      ...leadFields.parse(data),
      ...tenant(req),
      customerId: customer._id,
      assignedAgentId,
      ...(assignedAgentId ? { assignedAt: new Date() } : {}),
      status: data.status || (assignedAgentId ? "Assigned" : "New"),
    });
    await audit(
      req,
      "lead.created",
      { leadId: lead._id, customerId: customer._id },
      { text: "Lead created" },
    );
    if (assignedAgentId)
      await notify(
        req.user.companyId,
        assignedAgentId,
        "A lead was assigned to you",
        lead._id,
      );
    changed(req);
    return lead;
  });
}
crmRoutes.get("/leads", async (req, res) => {
  const filter = {
    ...own(req, "assignedAgentId"),
    archived: req.query.archived === "true",
    deletedAt: null,
    ...dateFilter(req, "createdAt"),
  };
  if (req.query.scope === "today") {
    const settings = await Settings.findOne(tenant(req));
    const start = DateTime.now()
      .setZone(settings.timezone)
      .startOf("day")
      .toJSDate();
    const end = DateTime.now()
      .setZone(settings.timezone)
      .plus({ days: 1 })
      .startOf("day")
      .toJSDate();
    const due = await FollowUp.find({
      ...own(req, "assignedAgentId"),
      status: "pending",
      dueAt: { $lt: end },
    }).distinct("leadId");
    filter.$and = [
      {
        $or: [
          { assignedAt: { $gte: start, $lt: end } },
          {
            assignedAt: { $exists: false },
            createdAt: { $gte: start, $lt: end },
          },
          { _id: { $in: due } },
        ],
      },
    ];
  }
  if (req.query.campaignId) {
    filter.campaignId = objectId(req.query.campaignId);
    if (req.user.role === "supervisor") {
      await allowedCampaign(req, req.query.campaignId);
      delete filter.assignedAgentId;
      filter.$or = [
        { assignedAgentId: { $in: req.user.supervisedAgentIds || [] } },
        { assignedAgentId: null },
      ];
    }
  }
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.agentId && req.user.role === "admin")
    filter.assignedAgentId = objectId(req.query.agentId);
  if (req.query.q) {
    const customers = await Customer.find({
      ...tenant(req),
      $or: [
        { fullName: { $regex: escapeRegex(req.query.q), $options: "i" } },
        { phone: { $regex: escapeRegex(req.query.q) } },
      ],
    }).select("_id");
    filter.customerId = { $in: customers.map((c) => c._id) };
  }
  res.json(
    await list(Lead, req, filter, [
      { path: "customerId" },
      { path: "assignedAgentId", select: "fullName agentCode" },
    ]),
  );
});
crmRoutes.post("/leads", async (req, res) =>
  res.status(201).json(await createLead(req, req.body)),
);
crmRoutes.post("/leads/import", admin, async (req, res) => {
  const rows = await readLeadImport(req.body);
  if (rows.length > 500) throw fail(400, "Import at most 500 rows");
  const preview = req.body.preview === true,
    results = [],
    seen = new Set();
  if (req.body.campaignId)
    await allowedCampaign(req, id.parse(req.body.campaignId));
  if (req.body.assignedAgentId)
    await agent(req, id.parse(req.body.assignedAgentId));
  for (const [i, raw] of rows.entries()) {
    const row = {
      ...raw,
      ...(req.body.campaignId ? { campaignId: req.body.campaignId } : {}),
      ...(req.body.assignedAgentId
        ? { assignedAgentId: req.body.assignedAgentId }
        : {}),
    };
    const rowNumber = raw.__rowNumber || i + 2;
    try {
      if (row.campaign && !row.campaignId) {
        const campaign = await Campaign.findOne({
          ...tenant(req),
          name: String(row.campaign).trim(),
          deletedAt: null,
        });
        if (!campaign) throw fail(400, "Campaign not found");
        row.campaignId = String(campaign._id);
      }
      const data = customerFields
        .merge(leadFields)
        .extend({ assignedAgentId: id.optional() })
        .parse(row);
      await validateStatus(req, data.status);
      if (data.assignedAgentId) await agent(req, data.assignedAgentId);
      if (data.campaignId) await allowedCampaign(req, data.campaignId);
      const duplicate =
        seen.has(data.phone) ||
        (await Customer.exists({ ...tenant(req), phone: data.phone }));
      seen.add(data.phone);
      if (duplicate) {
        results.push({
          row: rowNumber,
          status: "duplicate",
          fullName: data.fullName,
          phone: data.phone,
          message:
            "This phone number already exists; update its existing lead.",
        });
        continue;
      }
      if (preview) {
        results.push({
          row: rowNumber,
          status: "ready",
          fullName: data.fullName,
          phone: data.phone,
        });
        continue;
      }
      const lead = await createLead(req, data);
      results.push({
        row: rowNumber,
        id: lead._id,
        status: "created",
        fullName: data.fullName,
        phone: data.phone,
      });
    } catch (e) {
      if (e.code === 11000)
        results.push({ row: rowNumber, status: "duplicate" });
      else if (e.name === "ZodError" || e.safe)
        results.push({
          row: rowNumber,
          status: "invalid",
          message: e.safe ? e.message : "Invalid fields",
        });
      else throw e;
    }
  }
  res.json({ preview, results });
});
async function assignLead(req, lead, agentId, campaignId) {
  if (
    req.user.role === "supervisor" &&
    !(req.user.supervisedAgentIds || []).some((id) => String(id) === agentId)
  )
    throw fail(403, "Choose an agent assigned to your supervision");
  if (req.user.role === "supervisor") {
    if (!lead.campaignId && !campaignId)
      throw fail(403, "Supervisors assign contacts within their campaigns");
    await allowedCampaign(req, campaignId || lead.campaignId);
  }
  await agent(req, agentId);
  const customer = await Customer.findById(lead.customerId);
  if (!customer) throw fail(404, "Customer not found");
  return withNumberMutation(req, customer, async () => {
    if (
      await Call.exists({
        ...tenant(req),
        leadId: lead._id,
        $or: [{ active: true }, { deviceActive: true }],
      })
    )
      throw fail(409, "End the active call before reassigning");
    if (campaignId) await allowedCampaign(req, campaignId);
    const previous = lead.assignedAgentId;
    if (campaignId || lead.campaignId)
      await Campaign.updateOne(
        { _id: campaignId || lead.campaignId, ...tenant(req) },
        { $addToSet: { agentIds: agentId } },
      );
    const updated = await Lead.findOneAndUpdate(
      { _id: lead._id, ...tenant(req) },
      {
        $set: {
          assignedAgentId: agentId,
          assignedAt: new Date(),
          ...(lead.status === "New" ? { status: "Assigned" } : {}),
          ...(campaignId ? { campaignId } : {}),
        },
      },
      { returnDocument: "after" },
    );
    await FollowUp.updateMany(
      { leadId: lead._id, status: "pending" },
      { $set: { assignedAgentId: agentId } },
    );
    await audit(
      req,
      "lead.assigned",
      { leadId: lead._id, customerId: lead.customerId },
      { previous, agentId },
    );
    await notify(req.user.companyId, agentId, "Lead assigned to you", lead._id);
    changed(req);
    return updated;
  });
}
crmRoutes.post("/leads/bulk-assign", manager, async (req, res) => {
  const data = z
    .object({
      leadIds: z.array(id).min(1).max(500),
      agentId: id,
      campaignId: id.optional(),
    })
    .parse(req.body);
  await agent(req, data.agentId);
  const results = [];
  for (const leadId of [...new Set(data.leadIds)]) {
    try {
      const lead = await ownedLead(req, leadId);
      await assignLead(req, lead, data.agentId, data.campaignId);
      results.push({ id: leadId, status: "assigned" });
    } catch (e) {
      if (!e.safe) throw e;
      results.push({ id: leadId, status: "failed", message: e.message });
    }
  }
  res.json({ results });
});
crmRoutes.post("/leads/bulk-update", admin, async (req, res) => {
  const data = z
    .object({ leadIds: z.array(id).min(1).max(500), values: leadFields })
    .parse(req.body);
  await validateStatus(req, data.values.status);
  if (data.values.campaignId)
    await allowedCampaign(req, data.values.campaignId);
  const results = [];
  for (const leadId of [...new Set(data.leadIds)]) {
    try {
      const lead = await ownedLead(req, leadId);
      const customer = await Customer.findById(lead.customerId);
      await withNumberMutation(req, customer, () =>
        Lead.updateOne({ _id: lead._id }, { $set: data.values }),
      );
      await audit(
        req,
        "lead.updated",
        { leadId: lead._id, customerId: lead.customerId },
        { after: data.values },
      );
      results.push({ id: leadId, status: "updated" });
    } catch (e) {
      if (!e.safe) throw e;
      results.push({ id: leadId, status: "failed", message: e.message });
    }
  }
  changed(req);
  res.json({ results });
});
crmRoutes.get("/leads/:id", async (req, res) => {
  const lead = await ownedLead(req);
  await lead.populate([
    { path: "customerId" },
    { path: "assignedAgentId", select: "fullName" },
  ]);
  res.json(lead);
});
crmRoutes.put("/leads/:id", async (req, res) => {
  const lead = await ownedLead(req);
  const data = leadFields.parse(req.body);
  if (data.campaignId) await allowedCampaign(req, data.campaignId);
  await validateStatus(req, data.status);
  const before = lead.status;
  Object.assign(lead, data);
  await withNumberMutation(
    req,
    await Customer.findById(lead.customerId),
    async () => {
      await lead.save();
      if (data.status === "Do Not Call") {
        await Customer.updateOne(
          { _id: lead.customerId },
          {
            $set: {
              doNotCall: true,
              optOutAt: new Date(),
              optOutReason: "Lead marked Do Not Call",
            },
          },
        );
        await FollowUp.updateMany(
          { leadId: lead._id, status: "pending" },
          { $set: { status: "canceled" } },
        );
      }
    },
  );
  await audit(
    req,
    "lead.updated",
    { leadId: lead._id, customerId: lead.customerId },
    { before, after: lead.status },
  );
  changed(req);
  res.json(lead);
});
crmRoutes.delete("/leads/:id", admin, async (req, res) => {
  const lead = await ownedLead(req);
  if (
    await Call.exists({
      leadId: lead._id,
      $or: [{ active: true }, { deviceActive: true }],
    })
  )
    throw fail(409, "Finish the active call before deleting this lead");
  await withNumberMutation(
    req,
    await Customer.findById(lead.customerId),
    async () => {
      lead.deletedAt = new Date();
      lead.archived = true;
      await lead.save();
    },
  );
  await FollowUp.updateMany(
    { leadId: lead._id, status: "pending" },
    { $set: { status: "canceled" } },
  );
  await audit(
    req,
    "lead.deleted",
    { leadId: lead._id, customerId: lead.customerId },
    { text: "Lead removed; historical call records retained" },
  );
  changed(req);
  res.json({ success: true });
});
crmRoutes.patch("/leads/:id/archive", admin, async (req, res) => {
  const lead = await ownedLead(req);
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
  if (
    await Call.exists({
      leadId: lead._id,
      $or: [{ active: true }, { deviceActive: true }],
    })
  )
    throw fail(409, "End the active call first");
  await withNumberMutation(
    req,
    await Customer.findById(lead.customerId),
    async () => {
      lead.archived = archived;
      await lead.save();
    },
  );
  await audit(
    req,
    "lead.archived",
    { leadId: lead._id, customerId: lead.customerId },
    { archived },
  );
  changed(req);
  res.json(lead);
});
crmRoutes.patch("/leads/:id/assign", manager, async (req, res) => {
  const data = z
    .object({ agentId: id, campaignId: id.optional() })
    .parse(req.body);
  res.json(
    await assignLead(req, await ownedLead(req), data.agentId, data.campaignId),
  );
});
crmRoutes.post("/leads/:id/notes", async (req, res) => {
  const lead = await ownedLead(req);
  const { note } = z.object({ note: text(4000).min(1) }).parse(req.body);
  res
    .status(201)
    .json(
      await audit(
        req,
        "note",
        { leadId: lead._id, customerId: lead.customerId },
        { text: note },
      ),
    );
  changed(req);
});
crmRoutes.get("/leads/:id/activities", async (req, res) => {
  await ownedLead(req);
  res.json(
    await list(Activity, req, { ...tenant(req), leadId: req.params.id }, [
      { path: "actorId", select: "fullName" },
    ]),
  );
});
async function allowedCustomer(req) {
  const customer = await findOwned(Customer, req);
  if (
    req.user.role !== "admin" &&
    !(await Lead.exists({
      ...own(req, "assignedAgentId"),
      customerId: customer._id,
      deletedAt: null,
    }))
  )
    throw fail(404, "Customer not found");
  return customer;
}
crmRoutes.get("/customers", async (req, res) => {
  const query = tenant(req);
  if (req.user.role !== "admin")
    query._id = {
      $in: await Lead.find({
        ...own(req, "assignedAgentId"),
        deletedAt: null,
      }).distinct("customerId"),
    };
  if (req.query.q)
    query.fullName = { $regex: escapeRegex(req.query.q), $options: "i" };
  res.json(await list(Customer, req, query));
});
crmRoutes.get("/customers/:id", async (req, res) =>
  res.json(await allowedCustomer(req)),
);
crmRoutes.put("/customers/:id", async (req, res) => {
  const c = await allowedCustomer(req);
  const data = customerFields.partial().parse(req.body);
  const save = async () => {
    Object.assign(c, data);
    await c.save();
  };
  if (data.phone && data.phone !== c.phone)
    await withNumberMutation(req, { phone: data.phone, _id: c._id }, () =>
      withNumberMutation(req, c, save),
    );
  else await withNumberMutation(req, c, save);
  await audit(req, "customer.updated", { customerId: c._id });
  changed(req);
  res.json(c);
});
crmRoutes.get("/customers/:id/history", async (req, res) => {
  const c = await allowedCustomer(req);
  const filter = {
    ...(req.user.role === "supervisor" ? own(req) : tenant(req)),
    customerId: c._id,
    isDemo: req.app.locals.config.callMode === "demo",
    ...(req.app.locals.config.callMode === "sim"
      ? { source: { $in: ["sim", "android-telecom"] } }
      : {}),
  };
  const calls = await Call.find(filter).sort({ initiatedAt: -1 }).limit(100);
  const followUps = await FollowUp.find({
    ...own(req, "assignedAgentId"),
    customerId: c._id,
  })
    .sort({ dueAt: 1 })
    .limit(100);
  const leadIds = await Lead.find({
    ...own(req, "assignedAgentId"),
    customerId: c._id,
  }).distinct("_id");
  const activities = await Activity.find({
    ...tenant(req),
    customerId: c._id,
    ...(req.user.role === "admin" ? {} : { leadId: { $in: leadIds } }),
  })
    .sort({ createdAt: -1 })
    .limit(100);
  const stats = await Call.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        answered: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $ne: [{ $ifNull: ["$answeredAt", null] }, null] },
                  { $eq: ["$reportedAnswered", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        missed: { $sum: { $cond: [{ $eq: ["$status", "no-answer"] }, 1, 0] } },
        talkSeconds: { $sum: "$talkSeconds" },
      },
    },
  ]);
  res.json({
    customer: c,
    calls,
    followUps,
    activities,
    stats: stats[0] || {
      totalCalls: 0,
      answered: 0,
      missed: 0,
      talkSeconds: 0,
    },
  });
});
crmRoutes.get("/follow-ups", async (req, res) => {
  const f = { ...own(req, "assignedAgentId"), ...dateFilter(req, "dueAt") };
  if (req.query.status) f.status = String(req.query.status);
  if (req.query.agentId && req.user.role === "admin")
    f.assignedAgentId = objectId(req.query.agentId);
  if (req.query.overdue === "true") {
    f.status = "pending";
    f.dueAt = { $lt: new Date() };
  }
  await callbackDateFilter(req, f);
  if (req.query.leadId) f.leadId = objectId(req.query.leadId);
  res.json(
    await list(FollowUp, req, f, [
      { path: "customerId" },
      { path: "assignedAgentId", select: "fullName" },
    ]),
  );
});
crmRoutes.post("/follow-ups", async (req, res) => {
  const data = z
    .object({
      leadId: id,
      dueAt: z.string().datetime({ offset: true }),
      notes: text(2000),
    })
    .parse(req.body);
  const lead = await ownedLead(req, data.leadId);
  if (!lead.assignedAgentId)
    throw fail(400, "Assign the lead before scheduling");
  const f = await withCallbackMutation(req, lead, async () => {
    const existing = await FollowUp.findOne({
      ...tenant(req),
      leadId: lead._id,
      status: "pending",
    });
    if (existing)
      throw fail(
        409,
        "A callback already exists for this lead; reschedule it instead",
      );
    return FollowUp.create({
      ...data,
      ...tenant(req),
      customerId: lead.customerId,
      assignedAgentId: lead.assignedAgentId,
    });
  });
  await audit(
    req,
    "followup.created",
    { leadId: lead._id, customerId: lead.customerId },
    { text: data.notes, dueAt: data.dueAt },
  );
  changed(req);
  res.status(201).json(f);
});
crmRoutes.put("/follow-ups/:id", async (req, res) => {
  const f = await findOwned(FollowUp, req, own(req, "assignedAgentId"));
  Object.assign(
    f,
    z
      .object({
        dueAt: z.string().datetime({ offset: true }),
        notes: text(2000),
      })
      .partial()
      .parse(req.body),
  );
  await f.save();
  changed(req);
  res.json(f);
});
crmRoutes.patch("/follow-ups/:id/complete", async (req, res) => {
  const f = await findOwned(FollowUp, req, own(req, "assignedAgentId"));
  f.status = "completed";
  f.completedAt = new Date();
  await f.save();
  await audit(req, "followup.completed", {
    leadId: f.leadId,
    customerId: f.customerId,
  });
  changed(req);
  res.json(f);
});
crmRoutes.patch("/follow-ups/:id/assign", admin, async (req, res) => {
  const { agentId } = z.object({ agentId: id }).parse(req.body);
  await agent(req, agentId);
  const f = await findOwned(FollowUp, req);
  const lead = await Lead.findById(f.leadId);
  if (String(lead.assignedAgentId) !== agentId)
    throw fail(400, "Reassign the lead first so the agent has customer access");
  f.assignedAgentId = agentId;
  await f.save();
  await audit(
    req,
    "followup.assigned",
    { leadId: f.leadId, customerId: f.customerId },
    { agentId },
  );
  changed(req);
  res.json(f);
});
crmRoutes.get("/notifications", async (req, res) =>
  res.json(
    await list(Notification, req, {
      ...tenant(req),
      recipientId: req.user._id,
    }),
  ),
);
crmRoutes.patch("/notifications/:id/read", async (req, res) => {
  const n = await findOwned(Notification, req, { recipientId: req.user._id });
  n.readAt = new Date();
  await n.save();
  res.json(n);
});
crmRoutes.get("/settings", async (req, res) =>
  res.json(await Settings.findOne(tenant(req))),
);
crmRoutes.put("/settings", admin, async (req, res) => {
  const data = z
    .object({
      name: text(100).min(1),
      timezone: text(100),
      agentCanCreateCustomers: z.boolean(),

      leadStatuses: z.array(text(60).min(1)).min(1).max(30),
    })
    .partial()
    .parse(req.body);
  if (data.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format();
    } catch {
      throw fail(400, "Invalid timezone");
    }
  }
  if (data.leadStatuses) {
    if (
      ["New", "Assigned", "Converted"].some(
        (status) => !data.leadStatuses.includes(status),
      )
    )
      throw fail(400, "Keep the New, Assigned and Converted system statuses");
    const used = await Lead.find(tenant(req)).distinct("status");
    if (used.some((s) => !data.leadStatuses.includes(s)))
      throw fail(409, "Cannot remove a status used by existing leads");
    if (new Set(data.leadStatuses).size !== data.leadStatuses.length)
      throw fail(400, "Statuses must be unique");
  }
  const result = await Settings.findOneAndUpdate(
    tenant(req),
    { $set: data },
    { returnDocument: "after", runValidators: true },
  );
  await audit(req, "settings.updated", {}, data);
  changed(req);
  res.json(result);
});
