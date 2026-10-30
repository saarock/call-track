
import mongoose from "mongoose";
import dns from "node:dns";

// Disable Mongoose command buffering
mongoose.set("bufferCommands", false);

// Configure DNS for MongoDB Atlas SRV connections
function configureMongoDNS(uri) {
  if (uri.startsWith("mongodb+srv://")) {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
    console.log("MongoDB DNS resolvers configured.");
  }
}

// Connect to MongoDB
export async function connectDatabase(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error(
      "MongoDB connection URI is missing. Check your .env file."
    );
  }

  configureMongoDNS(uri);

  try {
    console.log("Connecting to MongoDB Atlas...");

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      autoIndex: process.env.NODE_ENV !== "production",
    });

    await mongoose.connection.db.admin().ping();

    console.log("MongoDB connected successfully.");

    return mongoose.connection;
  } catch (error) {
    console.error("MongoDB connection failed:", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    await mongoose.disconnect();

    throw error;
  }
}

// Check MongoDB connection health
export async function databaseReady() {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }

  try {
    await mongoose.connection.db.admin().ping({
      maxTimeMS: 2000,
    });

    return true;
  } catch {
    return false;
  }
}

// Disconnect MongoDB
export async function disconnectDatabase() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("MongoDB disconnected successfully.");
    }
  } catch (error) {
    console.error("MongoDB disconnect failed:", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    throw error;
  }
}
