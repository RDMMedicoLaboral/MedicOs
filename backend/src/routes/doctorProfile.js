import { Router } from "express";
import { db } from "../db.js";
import { requireRole } from "../auth.js";

export const doctorProfileRouter = Router();

doctorProfileRouter.get("/", async (req, res) => {
  const profile = await db.prepare(`SELECT * FROM doctor_profile WHERE clinic_id = ?`).get(req.user.clinic_id);
  res.json(
    profile || {
      clinic_id: req.user.clinic_id,
      full_name: "",
      personal_id: "",
      professional_license: "",
      specialty: "",
      email: "",
      city: "",
      clinic_name: "",
      clinic_address: "",
      clinic_phone: "",
    }
  );
});

doctorProfileRouter.put("/", requireRole("medico"), async (req, res) => {
  const {
    full_name,
    personal_id,
    professional_license,
    specialty,
    email,
    city,
    clinic_name,
    clinic_address,
    clinic_phone,
  } = req.body;
  await db
    .prepare(
      `INSERT INTO doctor_profile
        (clinic_id, full_name, personal_id, professional_license, specialty, email, city, clinic_name, clinic_address, clinic_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clinic_id) DO UPDATE SET
         full_name = excluded.full_name,
         personal_id = excluded.personal_id,
         professional_license = excluded.professional_license,
         specialty = excluded.specialty,
         email = excluded.email,
         city = excluded.city,
         clinic_name = excluded.clinic_name,
         clinic_address = excluded.clinic_address,
         clinic_phone = excluded.clinic_phone`
    )
    .run(
      req.user.clinic_id,
      full_name ?? "",
      personal_id ?? "",
      professional_license ?? "",
      specialty ?? "",
      email ?? "",
      city ?? "",
      clinic_name ?? "",
      clinic_address ?? "",
      clinic_phone ?? ""
    );
  res.json(await db.prepare(`SELECT * FROM doctor_profile WHERE clinic_id = ?`).get(req.user.clinic_id));
});
