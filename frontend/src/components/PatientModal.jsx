import { useState } from "react";
import { api } from "../api.js";

const EMPTY = {
  first_name: "",
  last_name: "",
  birth_date: "",
  gender: "",
  phone: "",
  email: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  blood_type: "",
  allergies: "",
  chronic_conditions: "",
};

export default function PatientModal({ isMedico = true, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("Nombre y apellido son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      const patient = await api.patients.create(form);
      onCreated(patient);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal folder-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tab" style={{ background: "#3D6B5C" }} />
        <h2 className="modal-title">Nuevo paciente</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Nombre*
            <input value={form.first_name} onChange={set("first_name")} autoFocus />
          </label>
          <label>
            Apellido*
            <input value={form.last_name} onChange={set("last_name")} />
          </label>
          <label>
            Fecha de nacimiento
            <input type="date" value={form.birth_date} onChange={set("birth_date")} />
          </label>
          <label>
            Género
            <input value={form.gender} onChange={set("gender")} placeholder="F / M / Otro" />
          </label>
          <label>
            Teléfono
            <input value={form.phone} onChange={set("phone")} />
          </label>
          <label>
            Correo
            <input type="email" value={form.email} onChange={set("email")} />
          </label>
          <label>
            Contacto de emergencia
            <input value={form.emergency_contact_name} onChange={set("emergency_contact_name")} />
          </label>
          <label>
            Teléfono de emergencia
            <input value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} />
          </label>
          <label>
            Tipo de sangre
            <input value={form.blood_type} onChange={set("blood_type")} placeholder="O+" />
          </label>
          {isMedico && (
            <>
              <label className="span-2">
                Alergias
                <input
                  value={form.allergies}
                  onChange={set("allergies")}
                  placeholder="Ej. Penicilina — se mostrará como alerta roja"
                />
              </label>
              <label className="span-2">
                Enfermedades crónicas / antecedentes
                <textarea rows={2} value={form.chronic_conditions} onChange={set("chronic_conditions")} />
              </label>
            </>
          )}

          {error && <p className="form-error span-2">{error}</p>}

          <div className="modal-actions span-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar paciente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
