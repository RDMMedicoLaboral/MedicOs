import { useState } from "react";
import { api, setToken } from "../api.js";

export default function LoginScreen({ needsSetup, onAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = needsSetup
        ? await api.auth.setup({ username, password, full_name: fullName })
        : await api.auth.login({ username, password });
      setToken(result.token);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="folder-card auth-card">
        <div className="modal-tab" style={{ background: "#3D6B5C" }} />
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark">Rx</span>
          <div>
            <div className="brand-name">Consultorio</div>
            <div className="brand-sub">Expediente &amp; Agenda</div>
          </div>
        </div>

        {needsSetup ? (
          <>
            <h2 className="modal-title">Configura la primera cuenta</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
              Esta cuenta tendrá rol <strong>Médico</strong> (acceso total). Después podrás crear
              cuentas de Secretaria desde "Gestionar usuarios".
            </p>
          </>
        ) : (
          <h2 className="modal-title">Iniciar sesión</h2>
        )}

        <form onSubmit={handleSubmit} className="form-grid">
          {needsSetup && (
            <label className="span-2">
              Nombre completo
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dra. Ana Torres" autoFocus />
            </label>
          )}
          <label className="span-2">
            Usuario
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!needsSetup} />
          </label>
          <label className="span-2">
            Contraseña
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          {error && <p className="form-error span-2">{error}</p>}

          <div className="modal-actions span-2" style={{ justifyContent: "stretch" }}>
            <button type="submit" className="btn-primary full" disabled={loading}>
              {loading ? "Un momento…" : needsSetup ? "Crear cuenta y entrar" : "Entrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
