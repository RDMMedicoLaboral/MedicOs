import { Router } from "express";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { db, logAudit, newQrToken } from "../db.js";

export const prescriptionsRouter = Router();

function getDoctorProfile(clinicId) {
  return (
    db.prepare(`SELECT * FROM doctor_profile WHERE clinic_id = ?`).get(clinicId) || {
      full_name: "",
      professional_license: "",
      specialty: "",
      clinic_name: "",
      clinic_address: "",
      clinic_phone: "",
    }
  );
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

// POST /api/prescriptions -> crea la receta (toma snapshot del perfil del médico de la clínica)
prescriptionsRouter.post("/", (req, res) => {
  const { patient_id, consultation_id, items, instructions } = req.body;

  if (!patient_id) return res.status(400).json({ error: "patient_id es obligatorio" });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Agrega al menos un medicamento" });
  }

  const patient = db.prepare(`SELECT id FROM patients WHERE id = ? AND clinic_id = ?`).get(patient_id, req.user.clinic_id);
  if (!patient) return res.status(400).json({ error: "El paciente no existe" });

  const doctor = getDoctorProfile(req.user.clinic_id);
  const qr_token = newQrToken();

  const result = db
    .prepare(
      `INSERT INTO prescriptions
        (clinic_id, patient_id, consultation_id, qr_token, items_json, instructions,
         doctor_name, doctor_license, doctor_specialty, clinic_name, clinic_address, clinic_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.clinic_id,
      patient_id,
      consultation_id ?? null,
      qr_token,
      JSON.stringify(items),
      instructions ?? null,
      doctor.full_name,
      doctor.professional_license,
      doctor.specialty,
      doctor.clinic_name,
      doctor.clinic_address,
      doctor.clinic_phone
    );

  logAudit({ clinicId: req.user.clinic_id, actor: req.user.username, action: "create", entity: "prescription", entityId: result.lastInsertRowid });

  const prescription = db.prepare(`SELECT * FROM prescriptions WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ...prescription, items: JSON.parse(prescription.items_json) });
});

// GET /api/prescriptions/patient/:patientId -> historial de recetas del paciente, dentro de la clínica
prescriptionsRouter.get("/patient/:patientId", (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM prescriptions WHERE patient_id = ? AND clinic_id = ? ORDER BY created_at DESC`)
    .all(req.params.patientId, req.user.clinic_id);
  res.json(rows.map((r) => ({ ...r, items: JSON.parse(r.items_json) })));
});

// GET /api/prescriptions/:id/pdf -> genera y transmite el PDF con QR (validado por clínica)
prescriptionsRouter.get("/:id/pdf", async (req, res) => {
  const rx = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND clinic_id = ?`).get(req.params.id, req.user.clinic_id);
  if (!rx) return res.status(404).json({ error: "Receta no encontrada" });

  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(rx.patient_id);
  const items = JSON.parse(rx.items_json);
  const verifyUrl = `${req.protocol}://${req.get("host")}/api/verify/${rx.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receta-${rx.id}.pdf"`);

  const doc = new PDFDocument({ size: "A5", margin: 40 });
  doc.pipe(res);

  // Encabezado
  doc.font("Helvetica-Bold").fontSize(16).text(rx.clinic_name || "Consultorio médico");
  doc.font("Helvetica").fontSize(10).fillColor("#555");
  if (rx.clinic_address) doc.text(rx.clinic_address);
  if (rx.clinic_phone) doc.text(`Tel: ${rx.clinic_phone}`);
  doc.moveDown(0.5);
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(11).text(rx.doctor_name || "");
  doc.font("Helvetica").fontSize(9).fillColor("#555");
  const doctorLine = [rx.doctor_specialty, rx.doctor_license ? `Cédula ${rx.doctor_license}` : null]
    .filter(Boolean)
    .join(" · ");
  if (doctorLine) doc.text(doctorLine);
  doc.moveDown();

  doc.strokeColor("#ccc").moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
  doc.moveDown();

  // Paciente
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(10).text("Paciente:", { continued: true });
  doc.font("Helvetica").text(` ${patient.first_name} ${patient.last_name}`);
  const age = calcAge(patient.birth_date);
  doc.font("Helvetica").fontSize(9).fillColor("#555");
  const patientMeta = [age !== null ? `${age} años` : null, patient.allergies ? `Alergias: ${patient.allergies}` : null]
    .filter(Boolean)
    .join(" · ");
  if (patientMeta) doc.text(patientMeta);
  doc.fillColor("#000").fontSize(9).text(`Fecha: ${new Date(rx.created_at.replace(" ", "T")).toLocaleDateString("es-MX")}`);
  doc.moveDown();

  // Medicamentos (Rx)
  doc.font("Helvetica-Bold").fontSize(13).text("Rx", { underline: false });
  doc.moveDown(0.3);
  items.forEach((item, i) => {
    doc.font("Helvetica-Bold").fontSize(10).text(`${i + 1}. ${item.generic_name}${item.commercial_name ? ` (${item.commercial_name})` : ""}`);
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    const line = [item.presentation, item.dose, item.frequency, item.duration].filter(Boolean).join(" · ");
    if (line) doc.text(line, { indent: 12 });
    doc.fillColor("#000");
    doc.moveDown(0.4);
  });

  if (rx.instructions) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(10).text("Indicaciones adicionales:");
    doc.font("Helvetica").fontSize(9).text(rx.instructions);
  }

  // QR de validación, anclado abajo
  const qrSize = 90;
  const qrX = doc.page.width - doc.page.margins.right - qrSize;
  const qrY = doc.page.height - doc.page.margins.bottom - qrSize - 24;
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font("Helvetica").fontSize(7).fillColor("#777").text("Verificar autenticidad", qrX - 20, qrY + qrSize + 4, {
    width: qrSize + 40,
    align: "center",
  });

  doc.end();
});
