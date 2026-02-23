import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "./db";
import { sendResetEmail } from "./mailer";
import type { Request, Response, NextFunction } from "express";

export const authRouter = Router();

// ── Config ──────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev-only";
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "15m";
const REFRESH_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Helpers ─────────────────────────────────────────────────────────────────
function signAccessToken(payload: { userId: number; username: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" as any });
}

async function createRefreshToken(userId: number): Promise<string> {
  const token = crypto.randomBytes(64).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS);
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
  return token;
}

async function issueTokenPair(user: { id: number; username: string }) {
  const accessToken = signAccessToken({ userId: user.id, username: user.username });
  const refreshToken = await createRefreshToken(user.id);
  return { accessToken, refreshToken };
}

// ── Register ────────────────────────────────────────────────────────────────
authRouter.post("/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password || username.length < 3 || password.length < 6) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "用户名至少3位，密码至少6位" } });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      res.status(400).json({ error: { code: "USER_EXISTS", message: "用户名已被占用" } });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash, email: email || null },
    });

    const tokens = await issueTokenPair(user);
    res.json({ ...tokens, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "注册失败" } });
  }
});

// ── Login ───────────────────────────────────────────────────────────────────
authRouter.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.passwordHash) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" } });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" } });
      return;
    }

    const tokens = await issueTokenPair(user);
    res.json({ ...tokens, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "登录失败" } });
  }
});

// ── Refresh Token ───────────────────────────────────────────────────────────
authRouter.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: { code: "MISSING_TOKEN", message: "缺少 refreshToken" } });
      return;
    }

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      res.status(401).json({ error: { code: "INVALID_REFRESH", message: "refreshToken 无效或已过期" } });
      return;
    }

    // Rotate: revoke old token
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      res.status(401).json({ error: { code: "USER_NOT_FOUND", message: "用户不存在" } });
      return;
    }

    const tokens = await issueTokenPair(user);
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "刷新 token 失败" } });
  }
});

// ── Logout ──────────────────────────────────────────────────────────────────
authRouter.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revoked: true },
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "登出失败" } });
  }
});

// ── Forgot Password ─────────────────────────────────────────────────────────
authRouter.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: { code: "MISSING_EMAIL", message: "请提供邮箱地址" } });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal whether user exists
      res.json({ success: true, message: "如果该邮箱已注册，验证码已发送" });
      return;
    }

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate old codes
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    await prisma.passwordResetToken.create({
      data: { code, userId: user.id, expiresAt },
    });

    await sendResetEmail(email, code);

    res.json({ success: true, message: "验证码已发送至您的邮箱" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "发送验证码失败" } });
  }
});

// ── Reset Password ──────────────────────────────────────────────────────────
authRouter.post("/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "邮箱、验证码和新密码（至少6位）均为必填" } });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(400).json({ error: { code: "INVALID_CODE", message: "验证码无效" } });
      return;
    }

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id, code, used: false, expiresAt: { gt: new Date() } },
    });

    if (!resetToken) {
      res.status(400).json({ error: { code: "INVALID_CODE", message: "验证码无效或已过期" } });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { used: true } }),
      // Revoke all refresh tokens for security
      prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } }),
    ]);

    res.json({ success: true, message: "密码已重置，请重新登录" });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "重置密码失败" } });
  }
});

// ── Middleware ───────────────────────────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  user?: { userId: number; username: string };
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "缺少 JWT token" } });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "JWT token 无效或已过期" } });
      return;
    }
    req.user = decoded as { userId: number; username: string };
    next();
  });
};

// ── /me ─────────────────────────────────────────────────────────────────────
authRouter.get("/me", authenticateToken as any, async (req: any, res: Response) => {
  try {
    const authUser = req.user as { userId: number; username: string };
    const user = await prisma.user.findUnique({ where: { id: authUser.userId } });
    if (!user) {
      res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "用户不存在" } });
      return;
    }
    res.json({ user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "获取用户信息失败" } });
  }
});
