import { Router } from "express";
import { db, logAudit } from "../db.js";

export const consultationsRouter = Router();

function computeBmi(weight_kg, height_cm) {
  if (!weight_kg || !height_cm) return null;
  const heightM = height_cm / 100;
  if (heightM <= 0) return null;
  return Math.round((weight_kg / (heightM * heightM)) * 10) / 10;
}

// GET /api/patients/:patientId/consultations -> historial cronológico (más reciente primero), solo de la clínica del usuario
consultationsRouter.get("/patients/:patientId/consultations", (req, res) => {
  const patient = db.prepare(`SELECT id FROM patients WHERE id = ? AND clinic_id = ?`).get(req.params.patientId, req.user.clinic_id);
  if (!patient) return res.status(404).json({ error: "Paciente no encontrado" });

  const rows = db
    .prepare(`SELECT * FROM consultations WHERE patient_id = ? AND clinic_id = ? ORDER BY created_at DESC`)
    .all(req.params.patientId, req.user.clinic_id);
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

  const patient = db.prepare(`SELECT id FROM patients WHERE id = ? AND clinic_id = ?`).get(patient_id, req.user.clinic_id);
  if (!patient) return res.status(400).json({ error: "El paciente no existe" });

  if (appointment_id) {
    const appt = db.prepare(`SELECT id FROM appointments WHERE id = ? AND clinic_id = ?`).get(appointment_id, req.user.clinic_id);
    if (!appt) return res.status(400).json({ error: "La cita no existe en esta clínica" });
  }

  const bmi = computeBmi(weight_kg, height_cm);

  const result = db
    .prepare(
      `INSERT INTO consultations
        (clinic_id, patient_id, appointment_id, subjective, blood_pressure, heart_rate,
         temperature_c, weight_kg, height_cm, bmi, diagnosis_code, diagnosis_label, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.clinic_id,
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

  logAudit({ clinicId: req.user.clinic_id, actor: req.user.username, action: "create", entity: "consultation", entityId: result.lastInsertRowid });

  // Si la nota viene ligada a una cita, la marcamos como Finalizada.
  if (appointment_id) {
    db.prepare(`UPDATE appointments SET status = 'finalizada', updated_at = datetime('now') WHERE id = ?`).run(appointment_id);
  }

  const consultation = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json(consultation);
});

// PUT /api/consultations/:id -> editar una nota ya guardada (por si se escribió con un error)
consultationsRouter.put("/consultations/:id", (req, res) => {
  const existing = db
    .prepare(`SELECT * FROM consultations WHERE id = ? AND clinic_id = ?`)
    .get(req.params.id, req.user.clinic_id);
  if (!existing) return res.status(404).json({ error: "Nota no encontrada" });

  const {
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

  const bmi = computeBmi(weight_kg, height_cm);

  db.prepare(
    `UPDATE consultations SET
      subjective = ?, blood_pressure = ?, heart_rate = ?, temperature_c = ?,
      weight_kg = ?, height_cm = ?, bmi = ?, diagnosis_code = ?, diagnosis_label = ?, plan = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    subjective ?? null,
    blood_pressure ?? null,
    heart_rate ?? null,
    temperature_c ?? null,
    weight_kg ?? null,
    height_cm ?? null,
    bmi,
    diagnosis_code ?? null,
    diagnosis_label ?? null,
    plan ?? null,
    req.params.id
  );

  logAudit({ clinicId: req.user.clinic_id, actor: req.user.username, action: "update", entity: "consultation", entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(req.params.id));
});
