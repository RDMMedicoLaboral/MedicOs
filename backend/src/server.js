import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "./db.js"; // inicializa el esquema al arrancar
import { requireAuth, requireRole } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { verifyRouter } from "./routes/verify.js";
import { usersRouter } from "./routes/users.js";
import { patientsRouter } from "./routes/patients.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { consultationsRouter } from "./routes/consultations.js";
import { cie11Router } from "./routes/cie11.js";
import { medicationsRouter } from "./routes/medications.js";
import { doctorProfileRouter } from "./routes/doctorProfile.js";
import { prescriptionsRouter } from "./routes/prescriptions.js";
import { remindersRouter, remindersWebhookRouter } from "./routes/reminders.js";
import { checkAndSendDueReminders } from "./reminders.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio manda application/x-www-form-urlencoded

// Log simple de acceso (usuario si ya se autenticó, IP y ruta) — la
// bitácora de auditoría fina por entidad vive en la tabla audit_log.
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} desde ${req.ip}`);
  next();
});

// ---------- Rutas públicas (sin sesión) ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/verify", verifyRouter); // lo escanea el QR de la receta
app.use("/api/reminders", remindersWebhookRouter); // lo llama Twilio (respuestas 1/2)

// ---------- A partir de aquí, todo requiere sesión ----------
app.use("/api", requireAuth);

// Agenda y pacientes: ambos roles (secretaria y médico). El filtrado de
// campos clínicos para la secretaria ocurre dentro de patientsRouter.
app.use("/api/patients", patientsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api", remindersRouter); // configuración + envío manual de recordatorios

// Perfil del médico: lectura para ambos roles, escritura solo médico
// (se controla dentro de doctorProfileRouter).
app.use("/api/doctor-profile", doctorProfileRouter);

// Exclusivo del médico: expediente clínico, recetas y sus catálogos.
app.use("/api/cie11", requireRole("medico"), cie11Router);
app.use("/api/medications", requireRole("medico"), medicationsRouter);
app.use("/api/prescriptions", requireRole("medico"), prescriptionsRouter);
app.use("/api", requireRole("medico"), consultationsRouter);

// Gestión de cuentas de secretaria: exclusivo del médico.
app.use("/api/users", requireRole("medico"), usersRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ---------- Servir el frontend compilado (despliegue de un solo servicio) ----------
// En desarrollo (Codespaces) el frontend corre aparte con Vite en el puerto
// 5173 y esto no aplica. En producción (Render, etc.) se compila el
// frontend antes de arrancar y este mismo servicio lo sirve, evitando
// tener que desplegar dos servicios separados.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`API de Agenda escuchando en http://localhost:${PORT}`);
});

// Revisa cada 15 minutos si hay citas que ya entraron en la ventana de
// recordatorio (por defecto 24h antes) y las envía. Además corre una vez
// poco después de arrancar. Limitación del MVP: solo funciona mientras
// este proceso esté vivo; en producción conviene un cron/worker aparte.
setInterval(() => {
  checkAndSendDueReminders().catch((err) => console.error("Error en checkAndSendDueReminders:", err));
}, 15 * 60 * 1000);
setTimeout(() => {
  checkAndSendDueReminders().catch((err) => console.error("Error en checkAndSendDueReminders:", err));
}, 5000);
