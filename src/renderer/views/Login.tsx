import React, { useState } from 'react';
import { FormField } from '../components/FormSection';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { translations, Language } from '../translations';
import { ipcErrorMessage } from '../ipcError';

interface LoginProps {
  onSignedIn: () => void;
  /** Why the user is looking at this screen — e.g. the session expired. */
  notice?: string | null;
  /** The language saved on this computer — App reads it before anyone signs in. */
  language?: Language;
}

const Login: React.FC<LoginProps> = ({ onSignedIn, notice, language = 'pl' }) => {
  const t = translations[language];
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
      setError(ipcErrorMessage(err, t.loginUnknownError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <form onSubmit={handleSubmit} className="login-card">
        <div className="login-card__logo">
          <Logo />
        </div>
        <div className="login-card__head">
          <h2 className="login-card__title">{t.loginTitle}</h2>
          <p className="login-card__text">{t.loginText}</p>
        </div>
        {notice && (
          <div className="callout callout--warning" role="status">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{notice}</div>
          </div>
        )}
        <FormField label={t.loginEmail} htmlFor="login-email">
          <div className="input-icon">
            <Icon name="mail" size={15} />
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
        </FormField>
        <FormField label={t.loginPassword} htmlFor="login-password" error={error}>
          <div className="input-icon">
            <Icon name="shield" size={15} />
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={submitting}
            />
          </div>
        </FormField>
        <button type="submit" className="button button-success login-card__submit" disabled={submitting}>
          <Icon name={submitting ? 'loader' : 'arrow-right'} size={14} className={submitting ? 'icon-spin' : undefined} />{' '}
          {submitting ? t.loginSubmitting : t.loginSubmit}
        </button>
      </form>
    </div>
  );
};

export default Login;
