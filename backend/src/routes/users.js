import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, logAudit, suggestAvailableUsername } from "../db.js";

export const usersRouter = Router();

// GET /api/users/suggest-username?desired=sofia -> propone un usuario libre
usersRouter.get("/suggest-username", async (req, res) => {
  const desired = String(req.query.desired || "").trim();
  if (!desired) return res.json({ suggestion: "" });
  res.json({ suggestion: await suggestAvailableUsername(desired) });
});

usersRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare(`SELECT id, username, full_name, role, created_at FROM users WHERE clinic_id = ? ORDER BY role, full_name`)
    .all(req.user.clinic_id);
  res.json(rows);
});

usersRouter.post("/", async (req, res) => {
  const { username, password, full_name } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "username, password y full_name son obligatorios" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }

  const existing = await db.prepare(`SELECT id FROM users WHERE username = ?`).get(username.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({
      error: "Ese nombre de usuario ya existe",
      suggestion: await suggestAvailableUsername(username),
    });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const result = await db
    .prepare(`INSERT INTO users (clinic_id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, 'secretaria')`)
    .run(req.user.clinic_id, username.trim().toLowerCase(), password_hash, full_name);

  await logAudit({
    clinicId: req.user.clinic_id,
    actor: req.user.username,
    action: "create",
    entity: "user",
    entityId: result.lastInsertRowid,
    detail: { role: "secretaria" },
  });

  res.status(201).json(
    await db.prepare(`SELECT id, username, full_name, role, created_at FROM users WHERE id = ?`).get(result.lastInsertRowid)
  );
});

usersRouter.delete("/:id", async (req, res) => {
  const target = await db.prepare(`SELECT * FROM users WHERE id = ? AND clinic_id = ?`).get(req.params.id, req.user.clinic_id);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.role === "medico") return res.status(400).json({ error: "No puedes eliminar una cuenta de médico" });

  await db.prepare(`DELETE FROM users WHERE id = ?`).run(req.params.id);
  await logAudit({ clinicId: req.user.clinic_id, actor: req.user.username, action: "delete", entity: "user", entityId: req.params.id });
  res.status(204).end();
});
