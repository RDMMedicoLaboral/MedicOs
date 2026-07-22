import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

// ---------- Conexión a PostgreSQL (Neon, u otro proveedor compatible) ----------
// DATABASE_URL es obligatoria: la app ya no usa un archivo local (SQLite),
// porque los discos de los planes gratis de hosting (ej. Render) se borran
// en cada despliegue. Postgres administrado (ej. Neon, plan gratis
// permanente) resuelve esto de raíz: los datos viven fuera del servidor
// web y sobreviven a cualquier despliegue/reinicio.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "Falta la variable de entorno DATABASE_URL (cadena de conexión de PostgreSQL). " +
      "Ver README para cómo crear una base gratis en Neon."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // La mayoría de proveedores gratis (Neon incluido) exigen SSL pero usan
  // certificados que Node no valida por default con la configuración más
  // estricta; esto es el ajuste estándar recomendado por Neon para Node.
  ssl: { rejectUnauthorized: false },
});

// ---------- Shim de compatibilidad ----------
// El resto del backend fue escrito originalmente contra la API síncrona de
// better-sqlite3: `db.prepare(sql).get(a, b)`, `.all(a, b)`, `.run(a, b)`,
// con placeholders `?` y `result.lastInsertRowid`. Para no tener que
// reescribir cada consulta a mano, este shim traduce esa misma forma de
// escribir código hacia PostgreSQL (async, placeholders `$1 $2...`,
// `RETURNING id` en vez de lastInsertRowid), MANTENIENDO cada .get/.all/.run
// como una función async — los archivos de rutas solo necesitan `await`
// antes de cada llamada (y ser funciones `async`), sin tocar el SQL.
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Tablas cuya llave primaria NO se llama "id" (usan clinic_id como PK,
// son "una fila por clínica"): a esas nunca hay que pedirles RETURNING id.
const TABLES_WITHOUT_ID_PK = /into\s+(doctor_profile|reminder_settings)\b/i;

function ensureReturningId(sql) {
  const trimmed = sql.trim();
  if (/^insert/i.test(trimmed) && !/returning/i.test(trimmed) && !TABLES_WITHOUT_ID_PK.test(trimmed)) {
    return `${sql} RETURNING id`;
  }
  return sql;
}

export const db = {
  prepare(sql) {
    const pgSql = toPgPlaceholders(sql);
    const pgSqlWithReturning = ensureReturningId(pgSql);
    return {
      async get(...params) {
        const res = await pool.query(pgSql, params);
        return res.rows[0] || undefined;
      },
      async all(...params) {
        const res = await pool.query(pgSql, params);
        return res.rows;
      },
      async run(...params) {
        const res = await pool.query(pgSqlWithReturning, params);
        return {
          changes: res.rowCount,
          lastInsertRowid: res.rows[0]?.id,
        };
      },
    };
  },
  async exec(sql) {
    await pool.query(sql);
  },
  // db.transaction(fn) en better-sqlite3 regresa una función síncrona que
  // ejecuta fn dentro de una transacción. Aquí lo simplificamos: como
  // fn ya no puede ser síncrona (necesita await en cada .run()), quien la
  // use debe llamarla con `await` y fn debe ser async. Se usa solo para
  // sembrar catálogos al arrancar (no es una ruta HTTP), así que no hay
  // problema de que sea async.
  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await fn(...args);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    };
  },
};

// ---------- Esquema ----------
// NOTA: created_at/updated_at se guardan como TEXT con formato
// "YYYY-MM-DD HH:MM:SS" (vía to_char(now(), ...)) — el mismo formato que
// generaba SQLite — para que todo el código existente que hace
// `fecha.replace(' ', 'T')` siga funcionando sin cambios.
const NOW_TEXT = `to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;

async function ensureColumn(table, column, definition) {
  // Postgres soporta "ADD COLUMN IF NOT EXISTS" nativamente — más simple
  // y seguro que inspeccionar el esquema a mano.
  await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );

    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
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
      allergies TEXT,
      chronic_conditions TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
    CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);

    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      start_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 20,
      visit_type TEXT NOT NULL DEFAULT 'subsecuente',
      status TEXT NOT NULL DEFAULT 'programada',
      reason TEXT,
      notes TEXT,
      reminder_sent_at TEXT,
      reminder_channel TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_clinic ON appointments(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);

    CREATE TABLE IF NOT EXISTS consultations (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      subjective TEXT,
      blood_pressure TEXT,
      heart_rate INTEGER,
      temperature_c REAL,
      weight_kg REAL,
      height_cm REAL,
      bmi REAL,
      diagnosis_code TEXT,
      diagnosis_label TEXT,
      plan TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
    CREATE INDEX IF NOT EXISTS idx_consultations_clinic ON consultations(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);

    CREATE TABLE IF NOT EXISTS cie11_catalog (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medications_catalog (
      id SERIAL PRIMARY KEY,
      generic_name TEXT NOT NULL,
      commercial_names TEXT,
      presentation TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctor_profile (
      clinic_id INTEGER PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
      full_name TEXT,
      professional_license TEXT,
      specialty TEXT,
      clinic_name TEXT,
      clinic_address TEXT,
      clinic_phone TEXT
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id SERIAL PRIMARY KEY,
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
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
    CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic ON prescriptions(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_qr ON prescriptions(qr_token);

    CREATE TABLE IF NOT EXISTS certificates (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
      diagnosis_code TEXT,
      diagnosis_label TEXT,
      clinical_picture TEXT,
      presents_symptoms INTEGER NOT NULL DEFAULT 1,
      certificate_type TEXT NOT NULL DEFAULT 'enfermedad',
      description TEXT,
      days_granted INTEGER NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      patient_full_name TEXT,
      patient_address TEXT,
      patient_phone TEXT,
      patient_email TEXT,
      patient_institution TEXT,
      patient_job_title TEXT,
      patient_id_number TEXT,
      patient_clinical_history_number TEXT,
      doctor_name TEXT,
      doctor_personal_id TEXT,
      doctor_license TEXT,
      doctor_specialty TEXT,
      doctor_email TEXT,
      clinic_name TEXT,
      clinic_address TEXT,
      clinic_phone TEXT,
      issue_place TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
    CREATE INDEX IF NOT EXISTS idx_certificates_clinic ON certificates(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_certificates_patient ON certificates(patient_id);

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('medico', 'secretaria')),
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
    CREATE INDEX IF NOT EXISTS idx_users_clinic ON users(clinic_id);

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

    CREATE TABLE IF NOT EXISTS reminder_log (
      id SERIAL PRIMARY KEY,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      channel TEXT,
      body TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER,
      actor TEXT NOT NULL DEFAULT 'sistema',
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
    );
  `);

  // Columnas agregadas después del lanzamiento inicial (aditivas, seguras).
  await ensureColumn("doctor_profile", "personal_id", "TEXT");
  await ensureColumn("doctor_profile", "email", "TEXT");
  await ensureColumn("doctor_profile", "city", "TEXT");
  await ensureColumn("patients", "id_number", "TEXT");
  await ensureColumn("patients", "address", "TEXT");
  await ensureColumn("patients", "workplace", "TEXT");
  await ensureColumn("patients", "job_title", "TEXT");
  await ensureColumn("patients", "clinical_history_number", "TEXT");
  await ensureColumn("prescriptions", "updated_at", "TEXT");
  await ensureColumn("certificates", "updated_at", "TEXT");

  // ---------- Catálogo CIE-10 (siembra idempotente, se puede ampliar en
  // despliegues futuros sin duplicar ni perder nada) ----------
  const cie10Seed = [
    ["A09", "Diarrea y gastroenteritis de presunto origen infeccioso"],
    ["A09.1", "Diarrea y gastroenteritis de origen infeccioso"],
    ["A15", "Tuberculosis respiratoria"],
    ["A90", "Dengue"],
    ["B01", "Varicela"],
    ["B02", "Herpes zóster"],
    ["B34.9", "Infección viral, no especificada"],
    ["B86", "Escabiosis"],
    ["D12", "Pólipo del colon"],
    ["D50", "Anemia por deficiencia de hierro"],
    ["E03.9", "Hipotiroidismo, no especificado"],
    ["E05.9", "Hipertiroidismo, no especificado"],
    ["E10", "Diabetes mellitus tipo 1"],
    ["E11", "Diabetes mellitus tipo 2"],
    ["E66.9", "Obesidad, no especificada"],
    ["E78.5", "Hiperlipidemia, no especificada"],
    ["F32.9", "Episodio depresivo, no especificado"],
    ["F41.1", "Trastorno de ansiedad generalizada"],
    ["F41.9", "Trastorno de ansiedad, no especificado"],
    ["F43.1", "Trastorno de estrés postraumático"],
    ["F51.0", "Insomnio no orgánico"],
    ["G43.9", "Migraña, no especificada"],
    ["G44.2", "Cefalea tensional"],
    ["G47.0", "Trastornos del inicio y mantenimiento del sueño"],
    ["H10.9", "Conjuntivitis, no especificada"],
    ["H60.9", "Otitis externa, no especificada"],
    ["H66.9", "Otitis media, no especificada"],
    ["H81.0", "Enfermedad de Ménière"],
    ["I10", "Hipertensión esencial (primaria)"],
    ["I20.9", "Angina de pecho, no especificada"],
    ["I25.9", "Enfermedad isquémica crónica del corazón"],
    ["I48", "Fibrilación y aleteo auricular"],
    ["I50.9", "Insuficiencia cardíaca, no especificada"],
    ["I83.9", "Várices de miembros inferiores"],
    ["J00", "Rinofaringitis aguda (resfriado común)"],
    ["J01.9", "Sinusitis aguda, no especificada"],
    ["J02.9", "Faringitis aguda, no especificada"],
    ["J03.9", "Amigdalitis aguda, no especificada"],
    ["J06.9", "Infección aguda de las vías respiratorias superiores"],
    ["J11.1", "Influenza con otras manifestaciones respiratorias"],
    ["J18.9", "Neumonía, no especificada"],
    ["J20.9", "Bronquitis aguda, no especificada"],
    ["J30.4", "Rinitis alérgica, no especificada"],
    ["J35.0", "Amigdalitis crónica"],
    ["J40", "Bronquitis, no especificada como aguda o crónica"],
    ["J44.9", "Enfermedad pulmonar obstructiva crónica, no especificada"],
    ["J45.9", "Asma, no especificada"],
    ["K02.9", "Caries dental, no especificada"],
    ["K21.0", "Enfermedad por reflujo gastroesofágico con esofagitis"],
    ["K21.9", "Enfermedad por reflujo gastroesofágico sin esofagitis"],
    ["K29.7", "Gastritis, no especificada"],
    ["K30", "Dispepsia funcional"],
    ["K35.8", "Apendicitis aguda, otra y no especificada"],
    ["K52.9", "Gastroenteritis y colitis no infecciosa"],
    ["K59.0", "Estreñimiento"],
    ["K59.1", "Diarrea funcional"],
    ["K64.9", "Hemorroides, no especificadas"],
    ["L02.9", "Absceso cutáneo, no especificado"],
    ["L03.9", "Celulitis, no especificada"],
    ["L20.9", "Dermatitis atópica, no especificada"],
    ["L23.9", "Dermatitis alérgica de contacto"],
    ["L30.9", "Dermatitis, no especificada"],
    ["L50.9", "Urticaria, no especificada"],
    ["L70.0", "Acné vulgar"],
    ["M25.5", "Dolor articular"],
    ["M54.2", "Cervicalgia"],
    ["M54.5", "Lumbago no especificado"],
    ["M54.9", "Dorsalgia, no especificada"],
    ["M17.9", "Gonartrosis (artrosis de rodilla), no especificada"],
    ["M19.9", "Artrosis, no especificada"],
    ["M79.1", "Mialgia"],
    ["M79.7", "Fibromialgia"],
    ["N30.9", "Cistitis, no especificada"],
    ["N39.0", "Infección de vías urinarias, sitio no especificado"],
    ["N20.0", "Cálculo del riñón"],
    ["N76.0", "Vaginitis aguda"],
    ["N40", "Hiperplasia de la próstata"],
    ["O21.0", "Hiperémesis gravídica leve"],
    ["O26.9", "Atención por afección relacionada con el embarazo"],
    ["Z34.9", "Supervisión de embarazo normal"],
    ["R05", "Tos"],
    ["R06.0", "Disnea"],
    ["R10.4", "Dolor abdominal, otro y no especificado"],
    ["R11", "Náusea y vómito"],
    ["R42", "Mareo y desvanecimiento"],
    ["R50.9", "Fiebre, no especificada"],
    ["R51", "Cefalea"],
    ["R53", "Malestar y fatiga"],
    ["S00.9", "Traumatismo superficial de la cabeza"],
    ["S06.0", "Conmoción cerebral"],
    ["S13.4", "Esguince cervical"],
    ["S60.9", "Traumatismo superficial de la muñeca y de la mano"],
    ["S93.4", "Esguince de tobillo"],
    ["T14.9", "Traumatismo, no especificado"],
    ["Z00.0", "Examen médico general"],
    ["Z01.0", "Examen de ojos y de la visión"],
    ["Z23", "Necesidad de inmunización, dosis única"],
    ["Z71.1", "Consulta por preocupación de enfermedad no confirmada"],
    ["Z76.3", "Acompañante de persona enferma"],
  ];
  for (const [code, label] of cie10Seed) {
    await pool.query(`INSERT INTO cie11_catalog (code, label) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [
      code,
      label,
    ]);
  }

  const medsSeed = [
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
  const medsCount = await pool.query(`SELECT COUNT(*)::int AS n FROM medications_catalog`);
  if (medsCount.rows[0].n === 0) {
    for (const [generic_name, commercial_names, presentation] of medsSeed) {
      await pool.query(
        `INSERT INTO medications_catalog (generic_name, commercial_names, presentation) VALUES ($1, $2, $3)`,
        [generic_name, commercial_names, presentation]
      );
    }
  }
}

export async function logAudit({ clinicId = null, actor = "sistema", action, entity, entityId, detail }) {
  await pool.query(
    `INSERT INTO audit_log (clinic_id, actor, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
    [clinicId, actor, action, entity, entityId ?? null, detail ? JSON.stringify(detail) : null]
  );
}

export function newQrToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Convierte "Sofía Barberán" o "sofia" en un slug simple ("sofia.barberan",
// "sofia"), y si ya existe le agrega un sufijo numérico (sofia2, sofia3...)
// hasta encontrar uno libre en TODA la plataforma (username es único
// globalmente porque el login no pide "clínica").
export async function suggestAvailableUsername(desired) {
  const base =
    desired
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, ".")
      .replace(/\.+/g, ".")
      .replace(/^\.|\.$/g, "") || "usuario";

  const exists = async (u) => {
    const res = await pool.query(`SELECT id FROM users WHERE username = $1`, [u]);
    return res.rows.length > 0;
  };

  if (!(await exists(base))) return base;
  let i = 2;
  while (await exists(`${base}${i}`)) i++;
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
