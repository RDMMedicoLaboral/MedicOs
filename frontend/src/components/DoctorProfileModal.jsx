import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function DoctorProfileModal({ onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.doctorProfile.get().then(setForm);
  }, []);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.doctorProfile.update(form);
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal folder-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tab" style={{ background: "#5B6B5F" }} />
        <h2 className="modal-title">Perfil del médico</h2>
        <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
          Estos datos aparecen en el encabezado de cada receta y certificado médico que generes.
        </p>
        <form onSubmit={handleSubmit} className="form-grid">
          <label className="span-2">
            Nombre completo
            <input value={form.full_name} onChange={set("full_name")} placeholder="Dra. Ana Torres" autoFocus />
          </label>
          <label>
            C.I. (cédula personal)
            <input value={form.personal_id} onChange={set("personal_id")} />
          </label>
          <label>
            Cédula profesional / Reg. SENESCYT
            <input value={form.professional_license} onChange={set("professional_license")} />
          </label>
          <label>
            Especialidad
            <input value={form.specialty} onChange={set("specialty")} placeholder="Medicina General" />
          </label>
          <label>
            Correo electrónico
            <input type="email" value={form.email} onChange={set("email")} />
          </label>
          <label className="span-2">
            Nombre del consultorio
            <input value={form.clinic_name} onChange={set("clinic_name")} />
          </label>
          <label className="span-2">
            Dirección
            <input value={form.clinic_address} onChange={set("clinic_address")} />
          </label>
          <label>
            Teléfono
            <input value={form.clinic_phone} onChange={set("clinic_phone")} />
          </label>
          <label>
            Ciudad (lugar de emisión)
            <input value={form.city} onChange={set("city")} placeholder="Manta" />
          </label>

          <div className="modal-actions span-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar perfil"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
