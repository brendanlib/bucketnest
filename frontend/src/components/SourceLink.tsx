import { useRegistration } from '../api/hooks';

/** "Open source": where anyone using this server can get its code (AGPL-3.0 §13). */
export function SourceLink({ className = 'source-link' }: { className?: string }) {
  const info = useRegistration();
  if (!info.data) return null;
  return (
    <p className={className}>
      Free and open source (AGPL-3.0) ·{' '}
      <a href={info.data.sourceUrl} target="_blank" rel="noreferrer">
        Source code
      </a>
    </p>
  );
}
