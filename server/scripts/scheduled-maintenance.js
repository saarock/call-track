import "dotenv/config";
import { readEnv } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { runDailyReports } from "../services/dailyReports.js";
import { expireRecordings } from "../routes/recordingRoutes.js";

// Safe to invoke from cPanel cron even while the web process is idle.
try {
  const config = readEnv();
  await connectDatabase(config.mongoUri);
  await expireRecordings(config);
  await runDailyReports();
  console.log("Scheduled report and recording maintenance completed.");
} finally { await disconnectDatabase(); }
