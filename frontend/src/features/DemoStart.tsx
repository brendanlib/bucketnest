import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { keys } from '../api/hooks';
import type { Me } from '../api/types';
import { AuthCard } from './auth';
import { strings } from '../locales/en-AU';

/** /demo: builds this visitor's sample household (a few seconds), then opens the dashboard. */
export function DemoStart() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // once, even in React's development double-run
    started.current = true;
    api
      .post<Me>('/demo/start')
      .then((me) => {
        qc.clear();
        qc.setQueryData(keys.me, me);
        navigate('/dashboard', { replace: true });
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This server isn’t a demo server.'
            : err instanceof ApiError
              ? err.message
              : 'The demo couldn’t start. Try again in a minute.',
        );
      });
  }, [qc, navigate]);

  return (
    <AuthCard title={error ? 'The demo didn’t start' : `Setting up your ${strings.appName} demo…`}>
      {error ? (
        <div className="stack">
          <p className="muted">{error}</p>
          <Link to="/login" className="btn">
            Back
          </Link>
        </div>
      ) : (
        <div className="stack" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <p className="muted">Filling a sample household with a year of pay, bills and spending. This takes a few seconds.</p>
        </div>
      )}
    </AuthCard>
  );
}
