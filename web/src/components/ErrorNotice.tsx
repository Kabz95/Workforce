import { friendlyError } from '../lib/types';

export default function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="notice error">{friendlyError(error)}</div>;
}
