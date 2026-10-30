import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { readEnv } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";

// Logical BSON-preserving backup. Keep the destination private and outside web roots.
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory))
  throw new Error("Supply a new absolute private backup directory.");
try {
  await fs.mkdir(directory); // Refuse to overwrite an existing backup.
  await connectDatabase(readEnv().mongoUri);
  const database = mongoose.connection.db;
  const { EJSON } = mongoose.mongo.BSON;
  const manifest = { createdAt: new Date(), database: database.databaseName, format: "canonical-ejson-ndjson", collections: [] };
  for (const entry of await database.listCollections({}, { nameOnly: true }).toArray()) {
    if (entry.name.startsWith("system.")) continue;
    const filename = Buffer.from(entry.name).toString("hex") + ".ndjson";
    const file = await fs.open(path.join(directory, filename), "wx");
    let count = 0;
    try {
      for await (const document of database.collection(entry.name).find({}).batchSize(100)) {
        await file.write(EJSON.stringify(document, { relaxed: false }) + "\n");
        count++;
      }
    } finally { await file.close(); }
    const indexes = await database.collection(entry.name).listIndexes().toArray();
    manifest.collections.push({ name: entry.name, filename, count, indexes });
  }
  await fs.writeFile(path.join(directory, "manifest.json"), EJSON.stringify(manifest, { relaxed: false }), { flag: "wx" });
  console.log(JSON.stringify({ backupComplete: true, collections: manifest.collections.length, documents: manifest.collections.reduce((n, c) => n + c.count, 0) }));
} finally { await disconnectDatabase(); }
