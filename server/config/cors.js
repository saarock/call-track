// Keep HTTP requests and Socket.IO polling on the same browser-origin policy.
const DEV_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function createCorsOptions({
  origins = [],
  nodeEnv = process.env.NODE_ENV || "development",
} = {}) {
  const values = Array.isArray(origins) ? origins : String(origins).split(",");
  const allowed = new Set(
    values.flatMap((value) => {
      try {
        const url = new URL(value.trim());
        return ["http:", "https:"].includes(url.protocol) ? [url.origin] : [];
      } catch {
        return [];
      }
    }),
  );

  return {
    origin(origin, callback) {
      // Native clients and server requests have no browser Origin header.
      if (
        !origin ||
        allowed.has(origin) ||
        (nodeEnv !== "production" && DEV_ORIGIN.test(origin))
      ) {
        return callback(null, true);
      }
      const error = new Error("Origin not allowed by CallTrack CORS policy");
      error.status = 403;
      return callback(error);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    optionsSuccessStatus: 204,
    maxAge: 600,
  };
}
