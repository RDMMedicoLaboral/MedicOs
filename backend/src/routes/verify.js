import { Router } from "express";
import { db } from "../db.js";

export const verifyRouter = Router();

// GET /api/verify/:token -> validación pública de receta (para farmacias u
// otros sistemas). Deliberadamente sin autenticación: es lo que se escanea
// desde el código QR impreso en la receta.
verifyRouter.get("/:token", (req, res) => {
  const rx = db.prepare(`SELECT * FROM prescriptions WHERE qr_token = ?`).get(req.params.token);
  if (!rx) return res.status(404).json({ valid: false, error: "Receta no encontrada" });

  const patient = db.prepare(`SELECT first_name, last_name FROM patients WHERE id = ?`).get(rx.patient_id);

  res.json({
    valid: true,
    issued_at: rx.created_at,
    patient_name: patient ? `${patient.first_name} ${patient.last_name}` : null,
    doctor_name: rx.doctor_name,
    doctor_license: rx.doctor_license,
    clinic_name: rx.clinic_name,
    items: JSON.parse(rx.items_json),
  });
});
