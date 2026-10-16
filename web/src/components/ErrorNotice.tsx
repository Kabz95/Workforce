import { friendlyError } from '../lib/types';

export default function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="notice error" role="alert" data-testid="error-notice">{friendlyError(error)}</div>;
}
