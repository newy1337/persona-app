import { Component } from 'react';
import styles from './AppLayout.module.scss';

/**
 * Ошибка в одной странице не должна гасить всю панель вместе с шапкой:
 * показываем, что случилось, и даём перезагрузить страницу.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.crash} role="alert">
        <h2 className={styles.crashTitle}>Страница не открылась</h2>
        <p className={styles.crashText}>{error?.message || String(error)}</p>
        <button type="button" className={styles.crashBtn} onClick={() => window.location.reload()}>
          Перезагрузить
        </button>
      </div>
    );
  }
}
