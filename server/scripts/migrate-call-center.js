import "dotenv/config";
import mongoose from "mongoose";
import { normalizePhone } from "../utils/phone.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { readEnv } from "../config/env.js";
const apply = process.argv.includes("--apply");
try {
  await connectDatabase(readEnv().mongoUri);
  const { Customer, Lead, Settings, leadStatuses, ensureIndexes } =
    await import("../models/index.js");
  const customers = await Customer.find({}).select("companyId phone").lean();
  const canonical = new Map(),
    collisions = [],
    updates = [];
  for (const customer of customers) {
    const phone = normalizePhone(customer.phone),
      key = String(customer.companyId) + ":" + phone;
    if (canonical.has(key))
      collisions.push({
        customerId: String(customer._id),
        conflictsWith: canonical.get(key),
      });
    else canonical.set(key, String(customer._id));
    if (phone !== customer.phone) updates.push({ _id: customer._id, phone });
  }
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        collections: await mongoose.connection.db
          .listCollections({}, { nameOnly: true })
          .toArray()
          .then((items) => items.map((x) => x.name)),
        customersInspected: customers.length,
        phonesToNormalize: updates.length,
        canonicalCollisionCount: collisions.length,
      },
      null,
      2,
    ),
  );
  if (collisions.length)
    throw new Error(
      "Canonical duplicate contacts need manual reconciliation. No migration writes were made.",
    );
  if (apply) {
    if (updates.length)
      await Customer.bulkWrite(
        updates.map((c) => ({
          updateOne: {
            filter: { _id: c._id },
            update: { $set: { phone: c.phone } },
          },
        })),
      );
    await Settings.updateMany(
      {},
      { $addToSet: { leadStatuses: { $each: leadStatuses } } },
    );
    await Lead.updateMany(
      { deletedAt: { $exists: false } },
      { $set: { deletedAt: null } },
    );
    await ensureIndexes();
    console.log(
      "Additive migration complete. Existing customer and call history retained.",
    );
  } else
    console.log(
      "Dry-run complete. Run again with --apply after backing up MongoDB.",
    );
} finally {
  await disconnectDatabase();
}
