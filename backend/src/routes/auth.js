import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  isAdmin: z.boolean().optional(),
});

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string(),
});

// Create user — admin only. Public self-registration is disabled: only an
// authenticated admin may provision new accounts for this internal CRM.
router.post('/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, name, isAdmin } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name, isAdmin: isAdmin ?? false },
    });

    // No token returned: the admin stays logged in as themselves.
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: user.isAdmin }, process.env.JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
