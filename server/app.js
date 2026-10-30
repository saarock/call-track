import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import cors from "cors";
import { createCorsOptions } from "./config/cors.js";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

import { healthRoutes } from "./routes/healthRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { crmRoutes } from "./routes/crmRoutes.js";
import { callRoutes } from "./routes/callRoutes.js";
import { reportRoutes } from "./routes/reportRoutes.js";
import { dialerRoutes } from "./routes/dialerRoutes.js";
import { campaignRoutes } from "./routes/campaignRoutes.js";
import { powerRoutes } from "./routes/powerRoutes.js";
import { recordingRoutes } from "./routes/recordingRoutes.js";
import { appUpdateRoutes } from "./routes/appUpdateRoutes.js";
import { operationsRoutes } from "./routes/operationsRoutes.js";

import { auth } from "./middleware/auth.js";
import { notFound, errorHandler } from "./middleware/errors.js";

// Create Express application
export function createApp({ origins, isDatabaseReady, config }) {
  const app = express();

  app.locals.config = config;

  // Disable Express identification header
  app.disable("x-powered-by");
  if (config?.trustProxyHops === 1) app.set("trust proxy", 1);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          mediaSrc: ["'self'", "blob:"],
          connectSrc: [
            "'self'",
            ...(config?.origins || []),
            ...(config?.origins || []).map((origin) =>
              origin.replace(/^http/, "ws"),
            ),
          ],
        },
      },
      // Lets a browser app on another origin read API responses
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // Handle preflights before authentication, including JSON and bearer headers.
  app.use(
    cors(
      createCorsOptions({
        origins: origins ?? config?.origins ?? [],
        nodeEnv: config?.nodeEnv,
      }),
    ),
  );
  // Rate limiting
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "Too many requests. Try again shortly.",
      },
    }),
  );

  // JSON body parser
  app.use(express.json({ limit: "512kb" }));

  // Health routes (public)
  app.use("/api", healthRoutes(isDatabaseReady));

  if (config) {
    // Public authentication routes
    app.use("/api/auth", authRoutes(config));

    // Protect remaining API endpoints
    app.use("/api", auth(config.jwtSecret));

    // Real-time monitoring
    app.get("/api/monitor", async (req, res, next) => {
      try {
        const live = app.locals.live;

        if (!live || typeof live.snapshot !== "function") {
          return res.status(503).json({
            success: false,
            message: "Live monitoring is unavailable.",
          });
        }

        const snapshot = await live.snapshot(req.user);
        return res.json(snapshot);
      } catch (error) {
        return next(error);
      }
    });

    app.use("/api", dialerRoutes);
    app.use("/api", powerRoutes);
    app.use("/api", campaignRoutes);
    app.use("/api", operationsRoutes);
    app.use("/api", appUpdateRoutes());
    app.use("/api", recordingRoutes(config));

    // User management
    app.use("/api/users", userRoutes);

    // Customers, leads and other CRM routes
    app.use("/api", crmRoutes);

    // Call history, tracking and recordings
    app.use("/api", callRoutes(config));

    // Reports
    app.use("/api/reports", reportRoutes(config));
  }

  // Optional static Expo export for a single cPanel/Passenger application.
  if (config?.webDirectory) {
    const directory = path.resolve(config.webDirectory);
    if (!existsSync(path.join(directory, "index.html")))
      throw new Error("WEB_DIRECTORY must contain an exported index.html");
    app.use(
      express.static(directory, {
        index: false,
        dotfiles: "deny",
        maxAge: "1h",
      }),
    );
    app.use((req, res, next) => {
      if (
        req.method !== "GET" ||
        req.path.startsWith("/api") ||
        req.path.startsWith("/socket.io") ||
        path.extname(req.path) ||
        req.path.split("/").some((segment) => segment.startsWith(".")) ||
        !req.accepts("html")
      )
        return next();
      res
        .set("Cache-Control", "no-store")
        .sendFile(path.join(directory, "index.html"));
    });
  }
  // Handle unknown routes
  app.use(notFound);

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
