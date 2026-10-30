import { Activity, Notification } from "../models/index.js";
export async function audit(req, type, record = {}, details = {}) {
  return Activity.create({
    companyId: req.user.companyId,
    actorId: req.user._id,
    type,
    leadId: record.leadId,
    customerId: record.customerId,
    callId: record.callId,
    text: details.text,
    details,
  });
}
export async function notify(companyId, recipientId, text, leadId) {
  return Notification.create({ companyId, recipientId, text, leadId });
}
export function changed(req) {
  req.app.locals.live?.changed(req.user.companyId);
}
