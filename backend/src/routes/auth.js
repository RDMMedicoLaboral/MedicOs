import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, logAudit } from "../db.js";
import { signToken, requireAuth } from "../auth.js";

export const authRouter = Router();

function userCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
}

// GET /api/auth/status -> le dice al frontend si hay que mostrar la
// pantalla de configuración inicial (primer médico) o la de login.
authRouter.get("/status", (_req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

// POST /api/auth/setup -> crea la primera cuenta (siempre rol médico).
// Solo funciona si todavía no existe ningún usuario.
authRouter.post("/setup", (req, res) => {
  if (userCount() > 0) {
    return res.status(400).json({ error: "El sistema ya está configurado" });
  }
  const { username, password, full_name } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "username, password y full_name son obligatorios" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'medico')`)
    .run(username.trim().toLowerCase(), password_hash, full_name);

  const user = db.prepare(`SELECT id, username, full_name, role FROM users WHERE id = ?`).get(result.lastInsertRowid);
  logAudit({ actor: user.username, action: "create", entity: "user", entityId: user.id, detail: { role: "medico" } });
  res.status(201).json({ token: signToken(user), user });
});

// POST /api/auth/login
authRouter.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username y password son obligatorios" });

  const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username.trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }

  const user = { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
  logAudit({ actor: user.username, action: "login", entity: "user", entityId: user.id });
  res.json({ token: signToken(user), user });
});

// GET /api/auth/me -> valida el token y regresa el usuario actual
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
