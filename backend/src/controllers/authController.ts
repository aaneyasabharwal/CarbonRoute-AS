import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../models/db';
import { AuthRequest, issueAccessToken } from '../middleware/auth';

export const login = (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide both username (or email) and password.',
    });
  }

  const user = db.getUserByUsername(username);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials.',
    });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.passwordHash);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials.',
    });
  }

  const token = issueAccessToken(user);

  db.addAuditLog('USER_LOGIN', 'User', user.id, `User ${user.username} logged in`, user.username);

  return res.json({
    success: true,
    message: 'Login successful.',
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  });
};

export const getMe = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated.',
    });
  }

  return res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
    },
  });
};

export const logout = (req: AuthRequest, res: Response) => {
  if (req.user) {
    // Revoke this token so it cannot be reused after signing out (M1.2).
    const payload = req.tokenPayload;
    if (payload?.jti) db.revokeToken(payload.jti, req.user.id, (payload.exp ?? Math.floor(Date.now() / 1000) + 7 * 86400) * 1000);
    db.addAuditLog('USER_LOGOUT', 'User', req.user.id, `User ${req.user.username} logged out`, req.user.username);
  }
  return res.json({
    success: true,
    message: 'Logged out successfully.',
  });
};
