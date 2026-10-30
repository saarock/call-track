import { Router } from "express";
import { z } from "zod";
import { Campaign } from "../models/campaign.js";
import { User, Lead, Call, Activity } from "../models/index.js";
import { admin, manager } from "../middleware/auth.js";
import { id, text, tenant, own, objectId, fail, list } from "../utils/http.js";
import { audit, changed } from "../services/events.js";
export const campaignRoutes = Router();
export function campaignScope(req) {
  if (req.user.role === "admin") return tenant(req);
  if (req.user.role === "supervisor")
    return {
      ...tenant(req),
      $or: [
        { supervisorIds: req.user._id },
        { _id: { $in: req.user.assignedCampaignIds || [] } },
      ],
    };
  return { ...tenant(req), agentIds: req.user._id };
}
export async function allowedCampaign(req, value, { active = false } = {}) {
  const campaign = await Campaign.findOne({
    _id: objectId(value),
    deletedAt: null,
    ...campaignScope(req),
    ...(active ? { status: "active" } : {}),
  });
  if (!campaign)
    throw fail(404, "Campaign not found or not available to this account");
  return campaign;
}
async function validateMembers(req, data) {
  for (const [key, role] of [
    ["agentIds", "agent"],
    ["supervisorIds", "supervisor"],
  ])
    if (data[key]) {
      if (new Set(data[key]).size !== data[key].length)
        throw fail(400, "Duplicate campaign members");
      const ids = data[key];
      const users = await User.find({
        _id: { $in: ids },
        ...tenant(req),
        active: true,
        deletedAt: null,
        role,
      }).select("_id");
      if (users.length !== ids.length)
        throw fail(400, "Choose active company " + role + " accounts");
      if (
        req.user.role === "supervisor" &&
        key === "agentIds" &&
        ids.some(
          (value) =>
            !(req.user.supervisedAgentIds || []).some(
              (uid) => String(uid) === value,
            ),
        )
      )
        throw fail(403, "Choose agents assigned to your supervision");
    }
  if (req.user.role === "supervisor" && data.supervisorIds)
    throw fail(403, "Only an administrator can assign supervisors");
}
const fields = z.object({
  name: text(100).min(1),
  description: text(2000).optional(),
  serviceType: text(100).optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
  agentIds: z.array(id).max(500).optional(),
  supervisorIds: z.array(id).max(100).optional(),
});
campaignRoutes.get("/campaigns", async (req, res) => {
  const result = await list(Campaign, req, {
    ...campaignScope(req),
    deletedAt: null,
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  });
  result.items = await Promise.all(
    result.items.map(async (item) => {
      const filter = {
        ...(req.user.role === "admin"
          ? tenant(req)
          : {
              ...tenant(req),
              $or: [
                {
                  assignedAgentId:
                    req.user.role === "supervisor"
                      ? { $in: req.user.supervisedAgentIds || [] }
                      : req.user._id,
                },
                { assignedAgentId: null },
              ],
            }),
        campaignId: item._id,
        archived: false,
        deletedAt: null,
      };
      const [total, remaining, called] = await Promise.all([
        Lead.countDocuments(filter),
        Lead.countDocuments({ ...filter, dialingClosed: false }),
        Call.countDocuments({
          ...own(req),
          campaignId: item._id,
          source: "android-telecom",
        }),
      ]);
      return { ...item, counts: { total, remaining, called } };
    }),
  );
  res.json(result);
});
campaignRoutes.post("/campaigns", admin, async (req, res) => {
  const data = fields.parse(req.body);
  await validateMembers(req, data);
  const campaign = await Campaign.create({ ...data, ...tenant(req) });
  await audit(
    req,
    "campaign.created",
    {},
    { campaignId: String(campaign._id), name: campaign.name },
  );
  changed(req);
  res.status(201).json(campaign);
});
campaignRoutes.put("/campaigns/:id", manager, async (req, res) => {
  const data = fields.partial().parse(req.body);
  await validateMembers(req, data);
  const campaign = await allowedCampaign(req, req.params.id);
  if (req.user.role === "supervisor" && data.agentIds)
    data.agentIds = [
      ...new Set([
        ...campaign.agentIds
          .filter(
            (value) =>
              !(req.user.supervisedAgentIds || []).some(
                (id) => String(id) === String(value),
              ),
          )
          .map(String),
        ...data.agentIds,
      ]),
    ];
  Object.assign(campaign, data);
  await campaign.save();
  await audit(
    req,
    "campaign.updated",
    {},
    { campaignId: String(campaign._id) },
  );
  changed(req);
  res.json(campaign);
});
campaignRoutes.post("/campaigns/:id/assign", manager, async (req, res) => {
  const data = z.object({ agentIds: z.array(id).max(500) }).parse(req.body);
  await validateMembers(req, data);
  const campaign = await allowedCampaign(req, req.params.id);
  campaign.agentIds =
    req.user.role === "supervisor"
      ? [
          ...new Set([
            ...campaign.agentIds
              .filter(
                (value) =>
                  !(req.user.supervisedAgentIds || []).some(
                    (id) => String(id) === String(value),
                  ),
              )
              .map(String),
            ...data.agentIds,
          ]),
        ]
      : data.agentIds;
  await campaign.save();
  await audit(
    req,
    "campaign.agents.assigned",
    {},
    { campaignId: String(campaign._id), agentIds: data.agentIds },
  );
  changed(req);
  res.json(campaign);
});
campaignRoutes.get("/campaigns/:id/queue", async (req, res) => {
  const campaign = await allowedCampaign(req, req.params.id);
  const leads = await Lead.find({
    ...(req.user.role === "agent"
      ? {
          ...tenant(req),
          $or: [{ assignedAgentId: req.user._id }, { assignedAgentId: null }],
        }
      : req.user.role === "supervisor"
        ? {
            ...tenant(req),
            $or: [
              { assignedAgentId: { $in: req.user.supervisedAgentIds || [] } },
              { assignedAgentId: null },
            ],
          }
        : own(req, "assignedAgentId")),
    campaignId: campaign._id,
    archived: false,
    deletedAt: null,
  })
    .populate("customerId")
    .sort({ assignedAt: 1, createdAt: 1 })
    .limit(1000)
    .lean();
  res.json({
    items: leads.map((lead, i) => ({
      position: i + 1,
      leadId: lead._id,
      customerName: lead.customerId?.fullName,
      phone: lead.customerId?.phone,
      status: lead.status,
      assignedAgentId: lead.assignedAgentId,
      doNotCall: lead.customerId?.doNotCall,
    })),
    total: leads.length,
  });
});
campaignRoutes.get("/audit-logs", manager, async (req, res) => {
  const filter = {
    ...tenant(req),
    ...(req.user.role === "supervisor"
      ? {
          actorId: {
            $in: [req.user._id, ...(req.user.supervisedAgentIds || [])],
          },
        }
      : {}),
  };
  res.json(
    await list(Activity, req, filter, [
      { path: "actorId", select: "fullName role" },
    ]),
  );
});
