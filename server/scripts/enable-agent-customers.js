import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { readEnv } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { Settings, Activity } from "../models/index.js";

// Explicit, reversible company preference change. Back up only the affected values.
try {
  await connectDatabase(readEnv().mongoUri);
  const settings = await Settings.find({}).select("companyId agentCanCreateCustomers").lean();
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ companies: settings.length, disabled: settings.filter(s => !s.agentCanCreateCustomers).length, mode: "dry-run" }));
  } else {
    const backup = process.argv[process.argv.indexOf("--backup") + 1];
    if (!backup || !path.isAbsolute(backup)) throw new Error("Supply --backup with an absolute private JSON file path.");
    await fs.writeFile(backup, JSON.stringify(settings, null, 2), { flag: "wx" });
    for (const s of settings.filter(s => !s.agentCanCreateCustomers)) {
      await Settings.updateOne({ _id: s._id }, { $set: { agentCanCreateCustomers: true } });
      await Activity.create({ companyId: s.companyId, type: "settings.updated", text: "Agent customer creation enabled by explicit company request", details: { before: { agentCanCreateCustomers: s.agentCanCreateCustomers }, after: { agentCanCreateCustomers: true } } });
    }
    console.log("Agent customer creation enabled. Previous preferences saved in the private backup.");
  }
} finally { await disconnectDatabase(); }
