import { readEnv } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
try {
  await connectDatabase(readEnv().mongoUri);
  console.log("MongoDB connection and ping succeeded");
} catch {
  console.error(
    "MongoDB check failed; inspect your configuration and database service",
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
