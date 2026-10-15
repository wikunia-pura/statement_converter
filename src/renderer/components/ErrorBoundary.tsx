import React from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';

interface Props {
  language: Language;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A view that throws while rendering takes only itself down.
 *
 * Without a boundary React unmounts the whole tree on an uncaught render error,
 * and the window goes white: the sidebar with it, so there is no way to another
 * view, and every unsaved piece of work in the shell — a mailing being written,
 * files queued in the Converter — with it. Here the failed view is replaced by
 * a message with the error and "Przeładuj widok"; the rest of the app stays.
 *
 * The app shell keys it by view (and tab), so moving elsewhere starts clean.
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] view crashed:', error, info.componentStack);
  }

  private reload = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = translations[this.props.language];
    return (
      <div className="content-body">
        <div className="callout callout--danger view-error" role="alert">
          <Icon name="alert-triangle" size={18} />
          <div className="callout__body">
            <span className="callout__title">{t.errBoundaryTitle}</span>
            <p className="view-error__text">{t.errBoundaryText}</p>
            <pre className="view-error__message">{error.message || String(error)}</pre>
            <button type="button" className="button button-secondary" onClick={this.reload}>
              <Icon name="refresh" size={14} /> {t.errBoundaryReload}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
