import { Router } from "express";
import { db, logAudit } from "../db.js";

export const consultationsRouter = Router();

function computeBmi(weight_kg, height_cm) {
  if (!weight_kg || !height_cm) return null;
  const heightM = height_cm / 100;
  if (heightM <= 0) return null;
  return Math.round((weight_kg / (heightM * heightM)) * 10) / 10;
}

// GET /api/patients/:patientId/consultations -> historial cronológico (más reciente primero)
consultationsRouter.get("/patients/:patientId/consultations", (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM consultations WHERE patient_id = ? ORDER BY created_at DESC`
    )
    .all(req.params.patientId);
  res.json(rows);
});

// POST /api/consultations -> crear nota SOAP
consultationsRouter.post("/consultations", (req, res) => {
  const {
    patient_id,
    appointment_id,
    subjective,
    blood_pressure,
    heart_rate,
    temperature_c,
    weight_kg,
    height_cm,
    diagnosis_code,
    diagnosis_label,
    plan,
  } = req.body;

  if (!patient_id) return res.status(400).json({ error: "patient_id es obligatorio" });

  const patient = db.prepare(`SELECT id FROM patients WHERE id = ?`).get(patient_id);
  if (!patient) return res.status(400).json({ error: "El paciente no existe" });

  const bmi = computeBmi(weight_kg, height_cm);

  const result = db
    .prepare(
      `INSERT INTO consultations
        (patient_id, appointment_id, subjective, blood_pressure, heart_rate,
         temperature_c, weight_kg, height_cm, bmi, diagnosis_code, diagnosis_label, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      patient_id,
      appointment_id ?? null,
      subjective ?? null,
      blood_pressure ?? null,
      heart_rate ?? null,
      temperature_c ?? null,
      weight_kg ?? null,
      height_cm ?? null,
      bmi,
      diagnosis_code ?? null,
      diagnosis_label ?? null,
      plan ?? null
    );

  logAudit({ actor: req.user.username, action: "create", entity: "consultation", entityId: result.lastInsertRowid });

  // Si la nota viene ligada a una cita, la marcamos como Finalizada.
  if (appointment_id) {
    db.prepare(`UPDATE appointments SET status = 'finalizada', updated_at = datetime('now') WHERE id = ?`).run(
      appointment_id
    );
  }

  const consultation = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json(consultation);
});
