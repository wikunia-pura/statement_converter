import React, { useState } from 'react';
import Icon from '../components/Icon';

interface LoginProps {
  onSignedIn: () => void;
  /** Why the user is looking at this screen — e.g. the session expired. */
  notice?: string | null;
}

const Login: React.FC<LoginProps> = ({ onSignedIn, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await window.electronAPI.authSignIn(email, password);
      if (result.ok) {
        onSignedIn();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nieznany błąd logowania.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '32px',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <h2 style={{ margin: 0 }}>Zaloguj się</h2>
        {notice && (
          <div
            role="status"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid var(--warning-border)',
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <span style={{ flexShrink: 0, lineHeight: 0, paddingTop: 2 }}>
              <Icon name="alert-triangle" size={16} />
            </span>
            <span>{notice}</span>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            disabled={submitting}
          />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">Hasło</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={submitting}
          />
        </div>
        {error && (
          <div style={{ color: 'var(--danger, #c53030)', fontSize: 14 }}>{error}</div>
        )}
        <button type="submit" className="button button-primary" disabled={submitting}>
          <Icon name="arrow-right" size={14} />{' '}{submitting ? 'Logowanie…' : 'Zaloguj'}
        </button>
      </form>
    </div>
  );
};

export default Login;
