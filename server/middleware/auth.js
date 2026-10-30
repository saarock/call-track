import jwt from "jsonwebtoken";
import { User } from "../models/index.js";
import { fail } from "../utils/http.js";
export function issueToken(user, secret) {
  return jwt.sign({ ver: user.tokenVersion }, secret, {
    subject: String(user._id),
    expiresIn: "8h",
    issuer: "calltrack",
    audience: "calltrack-mobile",
    algorithm: "HS256",
  });
}
export async function verifyUser(token, secret) {
  let payload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "calltrack",
      audience: "calltrack-mobile",
    });
  } catch {
    throw fail(401, "Session expired. Please sign in again.");
  }
  const user = await User.findById(payload.sub).select("+tokenVersion");
  if (!user || !user.active || user.tokenVersion !== payload.ver)
    throw fail(401, "Session expired. Please sign in again.");
  return user;
}
export const auth = (secret) => async (req, _res, next) => {
  try {
    req.user = await verifyUser(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
      secret,
    );
    next();
  } catch (error) {
    next(error);
  }
};
export function admin(req, _res, next) {
  next(
    req.user.role === "admin" ? undefined : fail(403, "Admin access required"),
  );
}
export function safeUser(user) {
  const result = user.toObject ? user.toObject() : { ...user };
  delete result.passwordHash;
  delete result.tokenVersion;
  return result;
}

export function manager(req, _res, next) {
  next(
    ["admin", "supervisor"].includes(req.user.role)
      ? undefined
      : fail(403, "Management access required"),
  );
}
export function managedAgentIds(req) {
  return req.user.role === "admin"
    ? null
    : req.user.role === "supervisor"
      ? req.user.supervisedAgentIds || []
      : [req.user._id];
}
