import { Router } from "express";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "./db";

export const oauthRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev-only";
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "15m";
const REFRESH_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

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

async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  profile: { username?: string; displayName?: string; email?: string }
) {
  // Check if OAuth account already linked
  const existing = await prisma.oAuthAccount.findUnique({
    where: { provider_providerId: { provider, providerId } },
    include: { user: true },
  });

  if (existing) {
    return existing.user;
  }

  // Try to link to existing user by email
  const email = profile.email || null;
  let user = email ? await prisma.user.findUnique({ where: { email } }) : null;

  if (!user) {
    // Create new user
    const baseUsername = profile.username || profile.displayName || `${provider}_user`;
    let username = baseUsername;
    let counter = 1;

    // Ensure unique username
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${baseUsername}_${counter}`;
      counter++;
    }

    user = await prisma.user.create({
      data: { username, email, passwordHash: null },
    });
  }

  // Link OAuth account
  await prisma.oAuthAccount.create({
    data: { provider, providerId, userId: user.id },
  });

  return user;
}

// ── GitHub Strategy ─────────────────────────────────────────────────────────
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL || "http://localhost:8787/api/auth/github/callback",
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: any,
        done: (err: any, user?: any) => void
      ) => {
        try {
          const email = profile.emails?.[0]?.value || null;
          const user = await findOrCreateOAuthUser("github", profile.id, {
            username: profile.username,
            displayName: profile.displayName,
            email,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );

  oauthRouter.get("/github", passport.authenticate("github", { scope: ["user:email"], session: false }));

  oauthRouter.get(
    "/github/callback",
    passport.authenticate("github", { failureRedirect: `${FRONTEND_URL}/login?error=github_failed`, session: false }),
    async (req, res) => {
      try {
        const user = req.user as { id: number; username: string };
        const accessToken = signAccessToken({ userId: user.id, username: user.username });
        const refreshToken = await createRefreshToken(user.id);
        // Redirect to frontend with tokens in URL fragment (safer than query params)
        res.redirect(`${FRONTEND_URL}/auth/callback#accessToken=${accessToken}&refreshToken=${refreshToken}`);
      } catch {
        res.redirect(`${FRONTEND_URL}/login?error=token_failed`);
      }
    }
  );
}

// ── Google Strategy ─────────────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:8787/api/auth/google/callback",
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: any,
        done: (err: any, user?: any) => void
      ) => {
        try {
          const email = profile.emails?.[0]?.value || null;
          const user = await findOrCreateOAuthUser("google", profile.id, {
            displayName: profile.displayName,
            email,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );

  oauthRouter.get("/google", passport.authenticate("google", { scope: ["profile", "email"], session: false }));

  oauthRouter.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: `${FRONTEND_URL}/login?error=google_failed`, session: false }),
    async (req, res) => {
      try {
        const user = req.user as { id: number; username: string };
        const accessToken = signAccessToken({ userId: user.id, username: user.username });
        const refreshToken = await createRefreshToken(user.id);
        res.redirect(`${FRONTEND_URL}/auth/callback#accessToken=${accessToken}&refreshToken=${refreshToken}`);
      } catch {
        res.redirect(`${FRONTEND_URL}/login?error=token_failed`);
      }
    }
  );
}
