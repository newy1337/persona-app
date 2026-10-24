import { Component } from 'react';
import { Button } from '@/components/ui/button';

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
      <div className="container pt-10" role="alert">
        <div className="mx-auto max-w-lg rounded-lg border bg-card p-6 text-center">
          <h2 className="text-lg font-semibold">Страница не открылась</h2>
          <p className="mt-2 text-sm break-words text-muted-foreground">{error?.message || String(error)}</p>
          <Button type="button" className="mt-4" onClick={() => window.location.reload()}>
            Перезагрузить
          </Button>
        </div>
      </div>
    );
  }
}
