import { Router } from "express";
import { healthController } from "../controllers/healthController.js";
export function healthRoutes(isDatabaseReady) {
  const router = Router();
  router.get("/health/live", (_req, res) => res.json({ status: "alive" }));
  router.get("/health", healthController(isDatabaseReady));
  return router;
}
