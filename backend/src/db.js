import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "agenda.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- Migración de esquema (una sola vez) ----------
// Este proyecto pasó de "un solo consultorio" a "multi-clínica" (columna
// clinic_id en varias tablas). No hay lógica de migración incremental
// (ALTER TABLE) para el MVP: si detectamos que existe una base de datos
// con el esquema VIEJO (tabla `patients` sin la columna `clinic_id`),
// simplemente la reiniciamos por completo. Esto es seguro porque, en esta
// etapa, solo hay datos de prueba — nunca se usó con pacientes reales.
// Si en el futuro hay datos reales que proteger, esto debe reemplazarse
// por migraciones explícitas (o por la migración a PostgreSQL ya prevista
// en el README).
function needsFullReset() {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='patients'`)
    .get();
  if (!tableExists) return false;
  const columns = db.prepare(`PRAGMA table_info(patients)`).all();
  const hasClinicId = columns.some((c) => c.name === "clinic_id");
  return !hasClinicId;
}

if (needsFullReset()) {
  console.warn(
    "[db] Detectado esquema anterior a multi-clínica (sin clinic_id). " +
      "Reiniciando la base de datos por completo (solo afecta datos de prueba)."
  );
  const oldTables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all();
  db.pragma("foreign_keys = OFF");
  for (const { name } of oldTables) {
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  db.pragma("foreign_keys = ON");
}

// NOTA: Para producción, migrar a PostgreSQL (recomendado en el documento
// original) por el cifrado en reposo (AES-256), backups gestionados y
// concurrencia. El esquema de abajo es intencionalmente compatible con
// Postgres (tipos simples, sin funciones específicas de SQLite) para que
// la migración sea casi un copy-paste de los CREATE TABLE.

db.exec(`
-- Cada consultorio/médico que compra la plataforma es una "clínica".
-- TODO lo demás (usuarios, pacientes, citas, expedientes, recetas,
-- configuración) cuelga de una clínica y nunca se comparte entre clínicas.
CREATE TABLE IF NOT EXISTS clinics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  gender TEXT,
  phone TEXT,
  email TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  blood_type TEXT,
  allergies TEXT,            -- texto libre; se muestra como alerta roja en UI
  chronic_conditions TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,         -- ISO 8601
  duration_minutes INTEGER NOT NULL DEFAULT 20,
  visit_type TEXT NOT NULL DEFAULT 'subsecuente', -- 'primera_vez' | 'subsecuente'
  status TEXT NOT NULL DEFAULT 'programada',
  -- programada | confirmada | en_sala_espera | en_consulta | finalizada | cancelada | no_asistio
  reason TEXT,
  notes TEXT,
  reminder_sent_at TEXT,      -- cuándo se envió el recordatorio (NULL = no enviado)
  reminder_channel TEXT,      -- 'whatsapp' | 'sms' | 'simulado'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);

-- Notas de evolución, formato SOAP (Subjetivo / Objetivo / Análisis / Plan).
-- Una fila = una consulta. Vinculada opcionalmente a la cita que la originó.
CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  -- S: Subjetivo
  subjective TEXT,
  -- O: Objetivo (signos vitales)
  blood_pressure TEXT,       -- ej. "120/80"
  heart_rate INTEGER,        -- lpm
  temperature_c REAL,
  weight_kg REAL,
  height_cm REAL,
  bmi REAL,                  -- calculado: weight_kg / (height_cm/100)^2
  -- A: Análisis / diagnóstico
  diagnosis_code TEXT,       -- código CIE-11
  diagnosis_label TEXT,      -- descripción del código
  -- P: Plan
  plan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consultations_clinic ON consultations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);

-- Catálogo GLOBAL (compartido entre todas las clínicas) con formato de
-- CIE-11 (código + descripción), solo para demostrar el flujo de
-- autocompletado del buscador de diagnóstico. No contiene datos de
-- pacientes, así que no hay problema en compartirlo entre clínicas.
-- IMPORTANTE: estos códigos son ilustrativos. Antes de usar el sistema en un
-- entorno clínico real, sustituir esta tabla por una integración con la API
-- oficial de la OMS (ICD-11 API, https://icd.who.int/icdapi), que requiere
-- credenciales propias y devuelve el catálogo vigente y completo.
CREATE TABLE IF NOT EXISTS cie11_catalog (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

-- Catálogo GLOBAL de ejemplo de medicamentos (vademécum simplificado, se
-- comparte entre clínicas por la misma razón que el catálogo CIE-11).
CREATE TABLE IF NOT EXISTS medications_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generic_name TEXT NOT NULL,
  commercial_names TEXT,     -- separados por coma
  presentation TEXT NOT NULL -- ej. "Tabletas 500 mg"
);

-- Perfil del médico que emite las recetas: una fila POR CLÍNICA.
CREATE TABLE IF NOT EXISTS doctor_profile (
  clinic_id INTEGER PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  full_name TEXT,
  professional_license TEXT, -- cédula profesional
  specialty TEXT,
  clinic_name TEXT,
  clinic_address TEXT,
  clinic_phone TEXT
);

-- Recetas electrónicas. Los medicamentos se guardan como JSON (lista de
-- {generic_name, commercial_name, presentation, dose, frequency, duration})
-- porque son inmutables una vez emitida la receta (no deben cambiar aunque
-- el catálogo se actualice después).
CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
  qr_token TEXT NOT NULL UNIQUE,
  items_json TEXT NOT NULL,
  instructions TEXT,
  doctor_name TEXT,
  doctor_license TEXT,
  doctor_specialty TEXT,
  clinic_name TEXT,
  clinic_address TEXT,
  clinic_phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic ON prescriptions(clinic_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_qr ON prescriptions(qr_token);

-- Usuarios del sistema. Dos roles, siempre dentro de UNA clínica:
--   medico     -> acceso total dentro de su propia clínica.
--   secretaria -> solo agenda y datos de contacto de SU clínica; nunca
--                 historial médico, diagnósticos ni recetas.
-- Las cuentas nuevas las crea el administrador de la plataforma (tú), no
-- hay registro público — ver routes/admin.js.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('medico', 'secretaria')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_clinic ON users(clinic_id);

-- Configuración de recordatorios automáticos: una fila POR CLÍNICA.
-- provider: 'simulado' (no envía nada real, solo lo registra — es el modo
-- por defecto para poder probar el flujo sin contratar nada) | 'twilio_whatsapp' | 'twilio_sms'.
CREATE TABLE IF NOT EXISTS reminder_settings (
  clinic_id INTEGER PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'simulado',
  twilio_account_sid TEXT,
  twilio_auth_token TEXT,
  twilio_from_number TEXT,
  message_template TEXT NOT NULL DEFAULT
    'Hola {paciente}, le recordamos su cita el {fecha} a las {hora} en {consultorio}. Responda 1 para CONFIRMAR o 2 para CANCELAR.',
  hours_before INTEGER NOT NULL DEFAULT 24,
  enabled INTEGER NOT NULL DEFAULT 0
);

-- Registro de cada envío/respuesta de recordatorio, para trazabilidad.
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,   -- 'out' (recordatorio enviado) | 'in' (respuesta del paciente)
  channel TEXT,
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bitácora de auditoría mínima (quién/cuándo/qué), tal como exige el
-- documento fuente. En el MVP se registra desde las rutas.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER,
  actor TEXT NOT NULL DEFAULT 'sistema',
  action TEXT NOT NULL,       -- create | update | delete | status_change
  entity TEXT NOT NULL,       -- patient | appointment
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const cie11SeedCount = db.prepare(`SELECT COUNT(*) AS n FROM cie11_catalog`).get().n;
if (cie11SeedCount === 0) {
  // Catálogo mínimo de ejemplo (NO oficial) solo para demostrar el buscador.
  const seed = [
    ["5A11", "Diabetes mellitus tipo 2"],
    ["5A10", "Diabetes mellitus tipo 1"],
    ["BA00", "Hipertensión esencial"],
    ["CA22", "Asma"],
    ["8A80.0", "Migraña sin aura"],
    ["MG30", "Fiebre, no especificada"],
    ["MD90", "Dolor abdominal"],
    ["ME84", "Cefalea"],
    ["CA40", "Bronquitis aguda"],
    ["1A00", "Cólera"],
    ["1C62", "Infección de vías urinarias"],
    ["DA63", "Gastritis"],
    ["FA20", "Osteoartritis de rodilla"],
    ["BD10", "Insuficiencia cardiaca"],
    ["6A70", "Trastorno depresivo"],
    ["6B00", "Trastorno de ansiedad generalizada"],
    ["CA23", "Enfermedad pulmonar obstructiva crónica"],
    ["EK90", "Dermatitis, no especificada"],
    ["9A00", "Conjuntivitis"],
    ["AB70", "Faringitis aguda"],
  ];
  const insert = db.prepare(`INSERT INTO cie11_catalog (code, label) VALUES (?, ?)`);
  const insertMany = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  insertMany(seed);
}

const medsSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM medications_catalog`).get().n;
if (medsSeedCount === 0) {
  // Vademécum mínimo de ejemplo (NO exhaustivo, NO oficial) solo para
  // demostrar el autocompletado del recetario.
  const seed = [
    ["Paracetamol", "Tempra, Tylenol", "Tabletas 500 mg"],
    ["Paracetamol", "Tempra, Tylenol", "Jarabe 120 mg/5 ml"],
    ["Ibuprofeno", "Advil, Motrin", "Tabletas 400 mg"],
    ["Ibuprofeno", "Advil, Motrin", "Suspensión 100 mg/5 ml"],
    ["Amoxicilina", "Amoxil", "Cápsulas 500 mg"],
    ["Amoxicilina", "Amoxil", "Suspensión 250 mg/5 ml"],
    ["Losartán", "Cozaar", "Tabletas 50 mg"],
    ["Metformina", "Glucophage", "Tabletas 850 mg"],
    ["Omeprazol", "Losec", "Cápsulas 20 mg"],
    ["Loratadina", "Clarityne", "Tabletas 10 mg"],
    ["Salbutamol", "Ventolin", "Inhalador 100 mcg"],
    ["Diclofenaco", "Voltaren", "Tabletas 50 mg"],
    ["Enalapril", "Renitec", "Tabletas 10 mg"],
    ["Atorvastatina", "Lipitor", "Tabletas 20 mg"],
    ["Cetirizina", "Zyrtec", "Tabletas 10 mg"],
    ["Azitromicina", "Zithromax", "Tabletas 500 mg"],
    ["Ácido acetilsalicílico", "Aspirina", "Tabletas 100 mg"],
    ["Metamizol", "Neomelubrina", "Tabletas 500 mg"],
    ["Dexametasona", "Decadron", "Tabletas 0.5 mg"],
    ["Complejo B", "Neurobion", "Tabletas"],
  ];
  const insert = db.prepare(
    `INSERT INTO medications_catalog (generic_name, commercial_names, presentation) VALUES (?, ?, ?)`
  );
  const insertMany = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  insertMany(seed);
}

export function logAudit({ clinicId = null, actor = "sistema", action, entity, entityId, detail }) {
  db.prepare(
    `INSERT INTO audit_log (clinic_id, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(clinicId, actor, action, entity, entityId ?? null, detail ? JSON.stringify(detail) : null);
}

export function newQrToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Convierte "Sofía Barberán" o "sofia" en un slug simple ("sofia.barberan",
// "sofia"), y si ya existe le agrega un sufijo numérico (sofia2, sofia3...)
// hasta encontrar uno libre en TODA la plataforma (username es único
// globalmente porque el login no pide "clínica").
export function suggestAvailableUsername(desired) {
  const base = desired
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "") || "usuario";

  const exists = (u) => Boolean(db.prepare(`SELECT id FROM users WHERE username = ?`).get(u));

  if (!exists(base)) return base;
  let i = 2;
  while (exists(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export const VALID_STATUSES = [
  "programada",
  "confirmada",
  "en_sala_espera",
  "en_consulta",
  "finalizada",
  "cancelada",
  "no_asistio",
];
