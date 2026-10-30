export function phoneIdentity(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .replace(/^977(?=\d{10}$)/, "");
}
export function attemptMatches(event, attempt) {
  if (
    !attempt ||
    event.direction !== "outgoing" ||
    !phoneIdentity(event.normalizedPhone || event.phone) ||
    phoneIdentity(attempt.phone) !==
      phoneIdentity(event.normalizedPhone || event.phone)
  )
    return false;
  if (event.attemptId)
    return (
      event.attemptId === attempt.attemptId &&
      (!event.reservationId || event.reservationId === attempt.reservationId)
    );
  if (attempt.deviceCallId) return attempt.deviceCallId === event.callId;
  const elapsed = +new Date(event.startedAt) - +new Date(attempt.preparedAt);
  return Number.isFinite(elapsed) && elapsed >= -15000 && elapsed <= 120000;
}
export function sameCallDraft(item, call) {
  return Boolean(
    (call._id && item.serverCallId === call._id) ||
    (call.deviceCallId && item.device?.callId === call.deviceCallId) ||
    (call.attemptId && item.attemptId === call.attemptId) ||
    (call.reportKey && item.reportId === call.reportKey),
  );
}
export function reportIdentity(call) {
  return call.reportKey || call.attemptId || call.deviceCallId || null;
}
