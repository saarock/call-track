import "dotenv/config";
export function readEnv(source = process.env) {
  const port = Number(source.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  if (!/^mongodb(\+srv)?:\/\//.test(source.MONGODB_URI || ""))
    throw new Error("MONGODB_URI is required");
  const nodeEnv = source.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv))
    throw new Error("Invalid NODE_ENV");
  if (
    !source.JWT_SECRET ||
    source.JWT_SECRET.length < 32 ||
    source.JWT_SECRET.startsWith("replace-with-")
  )
    throw new Error("JWT_SECRET must contain at least 32 random characters");
  const callMode = source.CALL_MODE || "sim";
  if (!["sim", "demo"].includes(callMode))
    throw new Error("CALL_MODE must be sim or demo");
  const trustProxyHops = Number(source.TRUST_PROXY_HOPS || 0);
  if (![0, 1].includes(trustProxyHops))
    throw new Error("TRUST_PROXY_HOPS must be 0 or 1");
  return {
    trustProxyHops,
    webDirectory: source.WEB_DIRECTORY || null,
    recordingEncryptionKey: source.RECORDING_ENCRYPTION_KEY || null,
    recordingDirectory: source.RECORDING_DIRECTORY || null,
    port,
    host: source.HOST || "0.0.0.0",
    nodeEnv,
    mongoUri: source.MONGODB_URI,
    jwtSecret: source.JWT_SECRET,
    callMode,
    origins: (source.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
