import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

export function isCloudMode() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      orgId: user.org_id,
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function newOrgId() {
  return crypto.randomUUID();
}

export function registerAuthRoutes(app, pool) {
  app.post('/api/auth/register', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        res.status(400).json({ error: '请填写邮箱和密码' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: '密码至少 6 位' });
        return;
      }
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        res.status(409).json({ error: '该邮箱已注册' });
        return;
      }
      const orgId = newOrgId();
      const passwordHash = await hashPassword(password);
      const inserted = await pool.query(
        `INSERT INTO users (email, password_hash, org_id, role)
         VALUES ($1, $2, $3, 'owner')
         RETURNING id, email, org_id, role`,
        [email, passwordHash, orgId]
      );
      const user = inserted.rows[0];
      const token = signToken(user);
      res.json({
        token,
        user: { id: user.id, email: user.email, orgId: user.org_id, role: user.role },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        res.status(400).json({ error: '请填写邮箱和密码' });
        return;
      }
      const result = await pool.query(
        'SELECT id, email, password_hash, org_id, role FROM users WHERE email = $1',
        [email]
      );
      const user = result.rows[0];
      if (!user || !(await comparePassword(password, user.password_hash))) {
        res.status(401).json({ error: '邮箱或密码错误' });
        return;
      }
      const token = signToken(user);
      res.json({
        token,
        user: { id: user.id, email: user.email, orgId: user.org_id, role: user.role },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({
      user: {
        id: req.userId,
        email: req.userEmail,
        orgId: req.orgId,
        role: req.userRole,
      },
    });
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  try {
    const payload = verifyToken(match[1]);
    req.userId = payload.sub;
    req.orgId = payload.orgId;
    req.userRole = payload.role;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

export function requireWriteRole(req, res, next) {
  if (req.userRole === 'viewer') {
    res.status(403).json({ error: '当前账号为只读权限' });
    return;
  }
  next();
}

/** In cloud mode protect data routes; local SQLite mode passes through */
export function maybeRequireAuth(req, res, next) {
  if (!isCloudMode()) {
    next();
    return;
  }
  requireAuth(req, res, next);
}

export function maybeRequireWrite(req, res, next) {
  if (!isCloudMode()) {
    next();
    return;
  }
  requireWriteRole(req, res, next);
}
