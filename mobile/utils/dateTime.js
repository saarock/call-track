export function localTime(value) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "Asia/Kathmandu",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + "T00:00:00+05:45");
  return (
    Number.isFinite(stamp) &&
    new Date(stamp + 345 * 60000).toISOString().slice(0, 10) === value
  );
}
