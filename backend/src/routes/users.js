import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, logAudit } from "../db.js";

export const usersRouter = Router();

// GET /api/users -> lista de cuentas (sin password_hash)
usersRouter.get("/", (_req, res) => {
  const rows = db.prepare(`SELECT id, username, full_name, role, created_at FROM users ORDER BY role, full_name`).all();
  res.json(rows);
});

// POST /api/users -> crear cuenta de secretaria (los médicos solo se crean en /auth/setup)
usersRouter.post("/", (req, res) => {
  const { username, password, full_name } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "username, password y full_name son obligatorios" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }

  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username.trim().toLowerCase());
  if (existing) return res.status(400).json({ error: "Ese nombre de usuario ya existe" });

  const password_hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'secretaria')`)
    .run(username.trim().toLowerCase(), password_hash, full_name);

  logAudit({ actor: req.user.username, action: "create", entity: "user", entityId: result.lastInsertRowid, detail: { role: "secretaria" } });

  res.status(201).json(
    db.prepare(`SELECT id, username, full_name, role, created_at FROM users WHERE id = ?`).get(result.lastInsertRowid)
  );
});

// DELETE /api/users/:id -> eliminar cuenta de secretaria (no permite borrarte a ti mismo ni a médicos)
usersRouter.delete("/:id", (req, res) => {
  const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.role === "medico") return res.status(400).json({ error: "No puedes eliminar una cuenta de médico" });

  db.prepare(`DELETE FROM users WHERE id = ?`).run(req.params.id);
  logAudit({ actor: req.user.username, action: "delete", entity: "user", entityId: req.params.id });
  res.status(204).end();
});
