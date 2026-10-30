import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { z } from "zod";
import { readEnv } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";

try {
  const config = readEnv();
  const input = z
    .object({
      email: z.string().email(),
      password: z.string().min(12).max(72),
      name: z.string().min(1),
    })
    .parse({
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      name: process.env.SEED_COMPANY_NAME || "CallTrack Workspace",
    });
  await connectDatabase(config.mongoUri);
  const { User, Settings, ensureIndexes } = await import("../models/index.js");
  await ensureIndexes();
  if (await User.exists({ email: input.email.toLowerCase() }))
    throw new Error("Account already exists; seed never resets passwords");
  const companyId = new mongoose.Types.ObjectId();
  await Settings.create({ _id: companyId, companyId, name: input.name });
  await User.create({
    companyId,
    fullName: "Workspace Admin",
    email: input.email,
    agentCode: "ADMIN",
    role: "admin",
    passwordHash: await bcrypt.hash(input.password, 12),
  });
  console.log(
    `Admin created; company ID: ${companyId}. Remove seed password from your environment now.`,
  );
} catch (error) {
  console.error(
    error.name === "ZodError"
      ? "Set SEED_ADMIN_EMAIL and a 12–72 character SEED_ADMIN_PASSWORD"
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
