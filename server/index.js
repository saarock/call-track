
import { createServer } from "node:http";
import mongoose from "mongoose";

import { readEnv } from "./config/env.js";

import {
  connectDatabase,
  databaseReady,
  disconnectDatabase,
} from "./config/database.js";

let server = null;
let live = null;
let stopJobs = null;
let stopping = false;
let currentStage = "initialization";

// Prevent connection strings appearing in logs
function safeText(value) {
  return String(value ?? "Unknown error").replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi,
    "[MongoDB URI REDACTED]"
  );
}

// Log errors for debugging
function logError(error) {
  console.error("Error name:", error?.name ?? "UnknownError");
  console.error("Error code:", error?.code ?? "N/A");
  console.error("Error message:", safeText(error?.message));

  if (error?.stack) {
    console.error("Stack trace:", safeText(error.stack));
  }
}

// Graceful shutdown
async function shutdown(code = 0) {
  if (stopping) return;

  stopping = true;

  console.log("\nShutting down CallTrack server...");

  let exitCode = code;

  const timeout = setTimeout(() => {
    console.error("Shutdown timed out.");
    process.exit(1);
  }, 10000);

  timeout.unref();

  try {
    if (typeof stopJobs === "function") {
      try {
        await stopJobs();
        console.log("Background jobs stopped.");
      } catch (error) {
        exitCode = 1;
        logError(error);
      }
    }

    if (live) {
      try {
        await new Promise((resolve, reject) => {
          live.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        console.log("Live tracking stopped.");
      } catch (error) {
        exitCode = 1;
        logError(error);
      }
    }

    if (server?.listening) {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        console.log("HTTP server stopped.");
      } catch (error) {
        exitCode = 1;
        logError(error);
      }
    }

    await disconnectDatabase();

    console.log("MongoDB shutdown completed.");
  } catch (error) {
    exitCode = 1;
    logError(error);
  } finally {
    clearTimeout(timeout);
    process.exitCode = exitCode;
  }
}

// Main startup
async function startServer() {
  try {
    // 1. Read environment configuration
    currentStage = "environment configuration";

    console.log("Loading environment configuration...");

    const config = readEnv();

    console.log("Environment configuration loaded.");

    // 2. Connect to MongoDB first
    currentStage = "MongoDB connection";

    console.log("Connecting to MongoDB...");

    await connectDatabase(config.mongoUri);

    if (
      mongoose.connection.readyState !== 1 ||
      !mongoose.connection.db
    ) {
      throw new Error(
        "MongoDB connection is not ready."
      );
    }

    console.log("MongoDB connected successfully.");
    console.log(
      "Database:",
      mongoose.connection.db.databaseName
    );

    // 3. IMPORTANT:
    // Load models only AFTER MongoDB is connected.
    // This avoids premature Mongoose initialization.
    currentStage = "model loading";

    console.log("Loading Mongoose models...");

    const { ensureIndexes } = await import(
      "./models/index.js"
    );

    console.log("Mongoose models loaded.");

    // 4. Load modules that may import models
    console.log("Loading application modules...");

    const { createApp } = await import("./app.js");
    const { setupLive } = await import("./sockets/live.js");
    const { startJobs } = await import("./services/jobs.js");

    console.log("Application modules loaded.");

    // 5. Check model connections
    currentStage = "model verification";

    for (const model of Object.values(
      mongoose.connection.models
    )) {
      if (
        model.db?.readyState !== 1 ||
        !model.db?.db
      ) {
        throw new Error(
          `Model ${model.modelName} has no active database connection.`
        );
      }

      console.log(`Model ready: ${model.modelName}`);
    }

    // 6. Initialize database indexes
    currentStage = "MongoDB index initialization";

    console.log("Checking MongoDB indexes...");

    await ensureIndexes(mongoose.connection.db);

    console.log("MongoDB indexes ready.");

    // 7. Create Express application
    currentStage = "Express initialization";

    console.log("Creating Express application...");

    const app = createApp({
      origins: config.origins,
      isDatabaseReady: databaseReady,
      config,
    });

    // 8. Create HTTP server
    server = createServer(app);

    // 9. Setup Socket.IO
    currentStage = "live tracking initialization";

    console.log("Setting up live call tracking...");

    live = setupLive(server, config);

    app.locals.live = live;

    console.log("Live call tracking initialized.");

    // 10. Start background jobs
    currentStage = "background jobs initialization";

    console.log("Starting background jobs...");

    stopJobs = startJobs(config, live);

    console.log("Background jobs initialized.");

    // 11. Start HTTP server
    currentStage = "HTTP server startup";

    await new Promise((resolve, reject) => {
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };

      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };

      server.once("listening", onListening);
      server.once("error", onError);

      try {
        server.listen(config.port, config.host);
      } catch (error) {
        server.off("listening", onListening);
        server.off("error", onError);
        reject(error);
      }
    });

    server.on("error", (error) => {
      console.error("HTTP server error:");
      logError(error);
      void shutdown(1);
    });

    currentStage = "running";

    console.log("\n================================");
    console.log("       CALLTRACK CRM");
    console.log("================================");
    console.log("Server: RUNNING");
    console.log(`Host: ${config.host}`);
    console.log(`Port: ${config.port}`);
    console.log(`Calling Mode: ${config.callMode}`);
    console.log("MongoDB: Connected");
    console.log("Indexes: Ready");
    console.log("Live Tracking: Initialized");
    console.log("Background Jobs: Initialized");
    console.log("================================\n");

  } catch (error) {
    console.error("\nCALLTRACK STARTUP FAILED");
    console.error("Failed stage:", currentStage);

    logError(error);

    await shutdown(1);
  }
}

// Termination handlers
process.on("SIGINT", () => {
  void shutdown(0);
});
 
process.on("SIGTERM", () => {
  void shutdown(0);
});

// Run server
await startServer();
