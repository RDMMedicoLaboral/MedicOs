import { Router } from "express";
import { db } from "../db.js";
import { requireRole } from "../auth.js";

export const doctorProfileRouter = Router();

doctorProfileRouter.get("/", (_req, res) => {
  const profile = db.prepare(`SELECT * FROM doctor_profile WHERE id = 1`).get();
  res.json(
    profile || {
      id: 1,
      full_name: "",
      professional_license: "",
      specialty: "",
      clinic_name: "",
      clinic_address: "",
      clinic_phone: "",
    }
  );
});

doctorProfileRouter.put("/", requireRole("medico"), (req, res) => {
  const { full_name, professional_license, specialty, clinic_name, clinic_address, clinic_phone } = req.body;
  db.prepare(
    `INSERT INTO doctor_profile (id, full_name, professional_license, specialty, clinic_name, clinic_address, clinic_phone)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = excluded.full_name,
       professional_license = excluded.professional_license,
       specialty = excluded.specialty,
       clinic_name = excluded.clinic_name,
       clinic_address = excluded.clinic_address,
       clinic_phone = excluded.clinic_phone`
  ).run(
    full_name ?? "",
    professional_license ?? "",
    specialty ?? "",
    clinic_name ?? "",
    clinic_address ?? "",
    clinic_phone ?? ""
  );
  res.json(db.prepare(`SELECT * FROM doctor_profile WHERE id = 1`).get());
});
