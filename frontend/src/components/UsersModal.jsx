import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function UsersModal({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: "", password: "", full_name: "" });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setUsers(await api.users.list());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.users.create(form);
      setForm({ username: "", password: "", full_name: "" });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar esta cuenta de secretaria?")) return;
    await api.users.remove(id);
    load();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal folder-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tab" style={{ background: "#5B6B5F" }} />
        <h2 className="modal-title">Usuarios del sistema</h2>

        {loading ? (
          <p className="hint">Cargando…</p>
        ) : (
          <ul className="user-list">
            {users.map((u) => (
              <li key={u.id}>
                <div>
                  <strong>{u.full_name}</strong>
                  <span className="user-role-tag">{u.role === "medico" ? "Médico" : "Secretaria"}</span>
                  <div className="hint">@{u.username}</div>
                </div>
                {u.role === "secretaria" && (
                  <button type="button" className="link-btn" onClick={() => handleDelete(u.id)}>
                    Eliminar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3 className="history-title">Nueva cuenta de secretaria</h3>
        <form onSubmit={handleCreate} className="form-grid">
          <label className="span-2">
            Nombre completo
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Sofía López"
            />
          </label>
          <label>
            Usuario
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Mín. 6 caracteres"
            />
          </label>

          {error && <p className="form-error span-2">{error}</p>}

          <div className="modal-actions span-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cerrar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Creando…" : "Crear cuenta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
