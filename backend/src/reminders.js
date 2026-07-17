import { db } from "./db.js";

const DEFAULT_TEMPLATE =
  "Hola {paciente}, le recordamos su cita el {fecha} a las {hora} en {consultorio}. Responda 1 para CONFIRMAR o 2 para CANCELAR.";

function getSettings(clinicId) {
  return (
    db.prepare(`SELECT * FROM reminder_settings WHERE clinic_id = ?`).get(clinicId) || {
      clinic_id: clinicId,
      provider: "simulado",
      twilio_account_sid: "",
      twilio_auth_token: "",
      twilio_from_number: "",
      message_template: DEFAULT_TEMPLATE,
      hours_before: 24,
      enabled: 0,
    }
  );
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

// Envía (o simula) el recordatorio de UNA cita. clinicId se usa para
// verificar que la cita pertenezca a esa clínica antes de tocar nada.
// Regresa { ok, channel, simulated, error? }.
export async function sendReminderForAppointment(appointmentId, clinicId) {
  const appt = db
    .prepare(
      `SELECT a.*, p.first_name, p.last_name, p.phone
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.id = ? AND a.clinic_id = ?`
    )
    .get(appointmentId, clinicId);
  if (!appt) return { ok: false, error: "Cita no encontrada" };
  if (!appt.phone) return { ok: false, error: "El paciente no tiene teléfono registrado" };

  const settings = getSettings(clinicId);
  const doctor = db.prepare(`SELECT clinic_name FROM doctor_profile WHERE clinic_id = ?`).get(clinicId);
  const message = renderTemplate(settings.message_template, {
    paciente: `${appt.first_name} ${appt.last_name}`,
    fecha: formatDate(appt.start_time),
    hora: formatTime(appt.start_time),
    consultorio: doctor?.clinic_name || "el consultorio",
  });

  let result;
  if (settings.provider === "twilio_whatsapp" || settings.provider === "twilio_sms") {
    result = await sendViaTwilio(settings, appt.phone, message, settings.provider === "twilio_whatsapp");
  } else {
    // Modo simulado: no se envía nada real, solo se registra en consola y en el log.
    console.log(`[recordatorio SIMULADO clínica ${clinicId} -> ${appt.phone}] ${message}`);
    result = { ok: true, simulated: true };
  }

  if (result.ok) {
    db.prepare(
      `UPDATE appointments SET reminder_sent_at = datetime('now'), reminder_channel = ? WHERE id = ?`
    ).run(result.simulated ? "simulado" : settings.provider, appointmentId);
    db.prepare(
      `INSERT INTO reminder_log (appointment_id, direction, channel, body) VALUES (?, 'out', ?, ?)`
    ).run(appointmentId, result.simulated ? "simulado" : settings.provider, message);
  }

  return { ok: result.ok, channel: settings.provider, simulated: Boolean(result.simulated), error: result.error, message };
}

async function sendViaTwilio(settings, phone, message, isWhatsapp) {
  if (!settings.twilio_account_sid || !settings.twilio_auth_token || !settings.twilio_from_number) {
    return { ok: false, error: "Faltan credenciales de Twilio en la configuración" };
  }
  try {
    const { default: twilio } = await import("twilio");
    const client = twilio(settings.twilio_account_sid, settings.twilio_auth_token);
    const prefix = isWhatsapp ? "whatsapp:" : "";
    await client.messages.create({
      from: `${prefix}${settings.twilio_from_number}`,
      to: `${prefix}${phone}`,
      body: message,
    });
    return { ok: true, simulated: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Revisa, para CADA clínica que tenga los recordatorios activados, las
// citas 'programada' cuyo horario cae dentro de su ventana de anticipación
// configurada y todavía no tienen recordatorio enviado, y lo dispara.
// Se llama periódicamente desde server.js mientras el proceso esté vivo.
export async function checkAndSendDueReminders() {
  const activeSettings = db.prepare(`SELECT * FROM reminder_settings WHERE enabled = 1`).all();

  for (const settings of activeSettings) {
    const windowStart = new Date(Date.now() + (settings.hours_before - 0.5) * 3600 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + (settings.hours_before + 0.5) * 3600 * 1000).toISOString();

    const due = db
      .prepare(
        `SELECT id FROM appointments
         WHERE clinic_id = ? AND status = 'programada' AND reminder_sent_at IS NULL
         AND start_time BETWEEN ? AND ?`
      )
      .all(settings.clinic_id, windowStart, windowEnd);

    for (const row of due) {
      await sendReminderForAppointment(row.id, settings.clinic_id);
    }
  }
}

export { getSettings };
