import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { User, Settings, Call } from "../models/index.js";
import { auth, issueToken, safeUser } from "../middleware/auth.js";
import { fail } from "../utils/http.js";
export function authRoutes(config) {
  const r = Router();
  r.post(
    "/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 15,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    async (req, res) => {
      const data = z
        .object({
          email: z.string().email().max(200),
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const user = await User.findOne({
        email: data.email.trim().toLowerCase(),
      }).select("+passwordHash +tokenVersion");
      const match =
        user && (await bcrypt.compare(data.password, user.passwordHash));
      if (!match || !user.active) throw fail(401, "Invalid email or password");
      user.lastLoginAt = new Date();
      await user.save();
      res.json({
        token: issueToken(user, config.jwtSecret),
        user: safeUser(user),
      });
    },
  );
  r.use(auth(config.jwtSecret));
  r.get("/me", async (req, res) =>
    res.json({
      user: safeUser(req.user),
      settings: await Settings.findOne({ companyId: req.user.companyId }),
      callMode: config.callMode,
    }),
  );
  r.post("/logout", async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    req.app.locals.live?.revoke(req.user._id);
    res.json({ ok: true });
  });
  r.put("/password", async (req, res) => {
    const data = z
      .object({
        currentPassword: z.string().max(200),
        newPassword: z.string().min(12).max(72),
      })
      .parse(req.body);
    const user = await User.findById(req.user._id).select(
      "+passwordHash +tokenVersion",
    );
    if (!(await bcrypt.compare(data.currentPassword, user.passwordHash)))
      throw fail(400, "Current password is incorrect");
    user.passwordHash = await bcrypt.hash(data.newPassword, 12);
    user.tokenVersion += 1;
    await user.save();
    req.app.locals.live?.revoke(user._id);
    res.json({ ok: true });
  });
  return r;
}
