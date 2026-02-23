import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "./db";

export const authRouter = Router();

// Retrieve from env or fallback for dev
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev-only";

authRouter.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password || username.length < 3 || password.length < 6) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password format" } });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      res.status(400).json({ error: { code: "USER_EXISTS", message: "Username already taken" } });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
      },
    });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to register user" } });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" } });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" } });
      return;
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to login user" } });
  }
});

import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  user?: { userId: number; username: string };
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  
  if (!token) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing JWT token" } });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid or expired JWT token" } });
      return;
    }
    req.user = user as { userId: number; username: string };
    next();
  });
};

authRouter.get("/me", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
      return;
    }
    res.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch user profile" } });
  }
});
