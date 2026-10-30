export function healthController(isDatabaseReady) {
  return async (_req, res) => {
    let connected = false;
    try {
      connected = await isDatabaseReady();
    } catch {}
    res.status(connected ? 200 : 503).json({
      service: "CallTrack CRM",
      status: connected ? "ready" : "unavailable",
      database: connected ? "connected" : "disconnected",
      serverTime: new Date().toISOString(),
    });
  };
}
