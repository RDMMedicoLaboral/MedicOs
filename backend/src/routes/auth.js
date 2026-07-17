import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, logAudit } from "../db.js";
import { signToken, requireAuth } from "../auth.js";

export const authRouter = Router();

// POST /api/auth/login
authRouter.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username y password son obligatorios" });

  const row = db
    .prepare(
      `SELECT u.*, c.name AS clinic_name FROM users u
       JOIN clinics c ON c.id = u.clinic_id
       WHERE u.username = ?`
    )
    .get(username.trim().toLowerCase());

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }

  const user = {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    clinic_id: row.clinic_id,
    clinic_name: row.clinic_name,
  };
  logAudit({ clinicId: user.clinic_id, actor: user.username, action: "login", entity: "user", entityId: user.id });
  res.json({ token: signToken(user), user });
});

// GET /api/auth/me -> valida el token y regresa el usuario actual
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
