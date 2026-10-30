import { Router } from "express";
import { z } from "zod";
import { id, phone, text, tenant } from "../utils/http.js";
import { admin, manager } from "../middleware/auth.js";
import { DialerReservation } from "../models/power.js";
import {
  sessionView,
  startSession,
  reserveNext,
  authorizeAttempt,
  controlSession,
  heartbeat,
  attemptFailed,
  releaseReviewedReservation,
} from "../services/powerDialer.js";
export const powerRoutes = Router();
const uuid = z.string().uuid();
powerRoutes.get("/power/session", async (req, res) =>
  res.json(await sessionView(req)),
);
powerRoutes.post("/power/start", async (req, res) => {
  const data = z
    .object({ sessionId: uuid, campaignId: id.optional() })
    .parse(req.body);
  res.json(await startSession(req, data.sessionId, data.campaignId));
});
powerRoutes.post("/power/next", async (req, res) => {
  const data = z
    .object({ sessionId: uuid, requestId: uuid, leadId: id.optional() })
    .parse(req.body);
  res.json(await reserveNext(req, data));
});
powerRoutes.post("/power/reserve", async (req, res) => {
  const data = z
    .object({
      requestId: uuid,
      leadId: id.optional(),
      phone: phone.optional(),
      customerName: text(100).optional(),
    })
    .refine((value) => value.leadId || value.phone, "Choose a lead or number")
    .parse(req.body);
  res.json(await reserveNext(req, data, true));
});
powerRoutes.post("/power/attempt", async (req, res) => {
  const data = z
    .object({ sessionId: uuid.optional(), reservationId: id, attemptId: uuid })
    .parse(req.body);
  res.json(await authorizeAttempt(req, data));
});
powerRoutes.post("/power/control", async (req, res) => {
  const data = z
    .object({
      sessionId: uuid,
      action: z.enum(["pause", "resume", "stop", "skip"]),
      reservationId: id.optional(),
    })
    .parse(req.body);
  res.json(await controlSession(req, data));
});
powerRoutes.post("/power/heartbeat", async (req, res) => {
  const data = z
    .object({ sessionId: uuid, reservationId: id.optional() })
    .parse(req.body);
  res.json(await heartbeat(req, data));
});
powerRoutes.post("/power/attempt-failed", async (req, res) => {
  const data = z.object({ reservationId: id, attemptId: uuid }).parse(req.body);
  res.json(await attemptFailed(req, data));
});
powerRoutes.get("/power/reservations", manager, async (req, res) => {
  const items = await DialerReservation.find({
    kind: "call",
    ...tenant(req),
    ...(req.user.role === "supervisor"
      ? { agentId: { $in: req.user.supervisedAgentIds || [] } }
      : {}),
    active: true,
  })
    .sort({ createdAt: 1 })
    .limit(500)
    .populate("agentId", "fullName agentCode");
  res.json({ items });
});
powerRoutes.post("/power/review-release", admin, async (req, res) => {
  const data = z
    .object({
      reservationId: id,
      confirmPhoneIdle: z.literal(true),
      reason: text(1000).min(5),
    })
    .parse(req.body);
  res.json(await releaseReviewedReservation(req, data));
});
