import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  connectDatabase,
  databaseReady,
  disconnectDatabase,
} from "../config/database.js";
import { createApp } from "../app.js";
test(
  "real MongoDB ping drives readiness and disconnect drives 503",
  { timeout: 120000 },
  async () => {
    const mongo = await MongoMemoryServer.create({
      instance: { launchTimeout: 120000, args: process.platform === "win32" ? [] : ["--nounixsocket"],
      },
    });
    try {
      await connectDatabase(mongo.getUri("calltrack_test"));
      assert.equal(await databaseReady(), true);
      const app = createApp({ isDatabaseReady: databaseReady });
      await request(app).get("/api/health").expect(200);
      await disconnectDatabase();
      await request(app).get("/api/health").expect(503);
    } finally {
      await disconnectDatabase();
      await mongo.stop();
    }
  },
);
