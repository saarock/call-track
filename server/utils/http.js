import mongoose from "mongoose";
import { z } from "zod";
import { normalizePhone } from "./phone.js";
export const fail = (status, message) =>
  Object.assign(new Error(message), { status, safe: true });
export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID");
export const phone = z.preprocess(
  normalizePhone,
  z
    .string()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      "Use an international number, e.g. +9779800000000",
    )
    .refine(
      (value) =>
        !value.startsWith("+977") ||
        /^\+977(?:9[678]\d{8}|[1-8]\d{7,8})$/.test(value),
      "Enter a valid Nepal mobile or landline number",
    ),
);
export const text = (max = 2000) => z.string().trim().max(max);
export const parse = (schema, input) => schema.parse(input);
export function objectId(value) {
  if (!mongoose.isObjectIdOrHexString(value))
    throw fail(400, "Invalid record ID");
  return new mongoose.Types.ObjectId(value);
}
export const tenant = (req) => ({ companyId: req.user.companyId });
export const own = (req, field = "agentId") => ({
  ...tenant(req),
  ...(req.user.role === "admin"
    ? {}
    : req.user.role === "supervisor"
      ? { [field]: { $in: req.user.supervisedAgentIds || [] } }
      : { [field]: req.user._id }),
});
export async function findOwned(Model, req, query = {}) {
  const record = await Model.findOne({
    _id: objectId(req.params.id),
    ...query,
    ...tenant(req),
  });
  if (!record) throw fail(404, "Record not found");
  return record;
}
export function page(req) {
  const value = parse(
    z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
    req.query,
  );
  return {
    skip: (value.page - 1) * value.limit,
    limit: value.limit,
    page: value.page,
  };
}
export async function list(Model, req, filter, populate = []) {
  const paging = page(req);
  const [items, total] = await Promise.all([
    Model.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate(populate)
      .lean(),
    Model.countDocuments(filter),
  ]);
  return {
    items,
    total,
    page: paging.page,
    hasMore: paging.skip + items.length < total,
  };
}
export function dateFilter(req, field = "initiatedAt") {
  if (!req.query.from && !req.query.to) return {};
  const from = req.query.from && new Date(req.query.from),
    to = req.query.to && new Date(req.query.to);
  if (
    (from && !Number.isFinite(+from)) ||
    (to && !Number.isFinite(+to)) ||
    (from && to && from >= to)
  )
    throw fail(400, "Invalid date interval");
  return {
    [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) },
  };
}
export const escapeRegex = (value) =>
  String(value)
    .slice(0, 100)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
