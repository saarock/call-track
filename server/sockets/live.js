import { Server } from "socket.io";
import { createCorsOptions } from "../config/cors.js";
import { verifyUser } from "../middleware/auth.js";
import { User, Call, FollowUp } from "../models/index.js";
export function setupLive(httpServer, config) {
  const io = new Server(httpServer, {
    cors: createCorsOptions(config),
    pingInterval: 10000,
    pingTimeout: 15000,
  });
  const connections = new Map();
  const online = (id) => (connections.get(String(id))?.size || 0) > 0;
  const changed = (companyId) =>
    io
      .to(`company:${companyId}`)
      .emit("changed", { serverTime: new Date().toISOString() });
  function revoke(userId) {
    io.in(`user:${userId}`).emit("session:expired");
    io.in(`user:${userId}`).disconnectSockets(true);
  }
  io.use(async (socket, next) => {
    try {
      socket.user = await verifyUser(
        socket.handshake.auth?.token || "",
        config.jwtSecret,
      );
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const key = String(socket.user._id);
    if (!connections.has(key)) connections.set(key, new Set());
    connections.get(key).add(socket.id);
    socket.join(`user:${key}`);
    socket.join(`company:${socket.user.companyId}`);
    changed(socket.user.companyId);
    socket.on("disconnect", () => {
      const set = connections.get(key);
      set?.delete(socket.id);
      if (!set?.size) connections.delete(key);
      changed(socket.user.companyId);
    });
  });
  // Periodically recheck expiry and revocation; no client can choose a user or room.
  const check = setInterval(async () => {
    for (const socket of io.sockets.sockets.values()) {
      try {
        await verifyUser(socket.handshake.auth?.token || "", config.jwtSecret);
      } catch {
        socket.emit("session:expired");
        socket.disconnect(true);
      }
    }
  }, 30000);
  check.unref();
  async function snapshot(user) {
    const filter = {
      companyId: user.companyId,
      ...(user.role === "admin"
        ? {}
        : user.role === "supervisor"
          ? { _id: { $in: user.supervisedAgentIds || [] } }
          : { _id: user._id }),
    };
    const users = await User.find(filter).select("-__v").lean();
    const calls = await Call.find({
      companyId: user.companyId,
      $or: [{ active: true }, { deviceActive: true }],
      isDemo: config.callMode === "demo",
      ...(config.callMode === "sim"
        ? { source: { $in: ["sim", "android-telecom"] } }
        : {}),
      ...(user.role === "admin"
        ? {}
        : user.role === "supervisor"
          ? { agentId: { $in: user.supervisedAgentIds || [] } }
          : { agentId: user._id }),
    })
      .populate("customerId")
      .populate("leadId", "status")
      .populate("campaignId", "name")
      .lean();
    const rows = await Promise.all(
      users.map(async (u) => {
        const agentCalls = calls.filter(
          (c) => String(c.agentId) === String(u._id),
        );
        const call =
          agentCalls.find(
            (c) => c.source === "android-telecom" && c.deviceState === "ACTIVE",
          ) ||
          agentCalls.find((c) => c.source === "android-telecom") ||
          agentCalls[0];
        const lastCall = await Call.findOne({
          companyId: user.companyId,
          agentId: u._id,
          active: false,
          deviceActive: { $ne: true },
          isDemo: config.callMode === "demo",
          ...(config.callMode === "sim"
            ? { source: { $in: ["sim", "android-telecom"] } }
            : {}),
        })
          .sort({ updatedAt: -1 })
          .select("endedAt reportedAt")
          .lean();
        return {
          ...u,
          online: online(u._id),
          phoneStateVerified:
            call?.source === "android-telecom" &&
            Date.now() - new Date(call.deviceObservedAt) < 45000,
          phoneObservedAt: call?.deviceObservedAt || null,
          status: call
            ? call.source === "android-telecom"
              ? Date.now() - new Date(call.deviceObservedAt) < 45000
                ? call.deviceState === "ACTIVE"
                  ? "On call (Android)"
                  : call.deviceState === "HOLDING"
                    ? "On hold (Android)"
                    : call.deviceState === "RINGING"
                      ? "Incoming call (Android)"
                      : "Dialing (Android)"
                : "Phone state needs refresh"
              : call.source === "sim"
                ? "Awaiting report (unverified)"
                : call.status === "in-progress"
                  ? "On Call"
                  : "Ringing"
            : online(u._id)
              ? u.availability
              : "Offline",
          call: call || null,
          lastCallAt: lastCall?.reportedAt || lastCall?.endedAt,
        };
      }),
    );
    return { items: rows, serverTime: new Date().toISOString() };
  }
  return {
    io,
    changed,
    revoke,
    online,
    snapshot,
    close: () => {
      clearInterval(check);
      io.close();
    },
  };
}
