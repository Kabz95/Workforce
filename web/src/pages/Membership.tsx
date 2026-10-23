import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listScopeGrants, type ScopeGrantsResult } from '../lib/queries';
import {
  formatTimestampOrMs,
  ROLE_LABELS,
  type RoleGrant,
} from '../lib/types';
import { registerAbortController } from '../lib/roleState';
import ErrorNotice from '../components/ErrorNotice';

/**
 * Membership & grants — the read-only oversight view for grant
 * authorities (hubCoordinator, steeringCircle, council,
 * backboneLead) and the privacy lead.
 *
 * Data comes from the listScopeGrants callable: the server verifies
 * the caller's LIVE grant and scopes the listing (hub roles see
 * their own tenant; council/backboneLead see across hubs). The
 * client cannot read this set directly — the Firestore rules pin
 * authoriser list reads to the claim tenant and do not include
 * steeringCircle at all.
 *
 * This page is a VIEW. Grant administration (invite / create /
 * resolve / revoke) stays on its own kernel commands; there are
 * deliberately no action controls here.
 */

type GrantRow = RoleGrant & { id: string };

function GrantTable({ grants, showTenant }: { grants: GrantRow[]; showTenant: boolean }) {
  if (grants.length === 0) return <p className="muted">None.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Grantee</th>
          <th>Scope</th>
          {showTenant && <th>Hub</th>}
          <th>Status</th>
          <th>Valid</th>
          <th>Basis</th>
          <th>Review</th>
        </tr>
      </thead>
      <tbody>
        {grants.map((g) => (
          <tr key={g.id}>
            <td>{ROLE_LABELS[g.role] ?? g.role}</td>
            <td>
              {g.granteeEmail ?? g.granteeId}
              {g.granteeEmail && (
                <>
                  <br />
                  <span className="muted">{g.granteeId || 'not yet claimed'}</span>
                </>
              )}
            </td>
            <td>{g.scopeType}: {g.scopeId}</td>
            {showTenant && <td>{g.tenantId}</td>}
            <td><span className="pill">{g.status}</span></td>
            <td>
              {formatTimestampOrMs(g.validFrom)} – {formatTimestampOrMs(g.validUntil)}
            </td>
            <td>{g.basis || '—'}</td>
            <td>
              {g.needsReview ? (
                <span className="pill">needs review{g.reviewReason ? ` — ${g.reviewReason}` : ''}</span>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Membership() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [result, setResult] = useState<ScopeGrantsResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    void listScopeGrants({
      actingGrantId: actingGrant?.id ?? null,
      actingRole,
      purpose: 'membership oversight',
    })
      .then((r) => {
        if (!cancelled && !controller.signal.aborted) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
      unregister();
    };
    // actingGrant identity changes on capacity switch; reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, actingGrant?.id, actingRole]);

  const grants: GrantRow[] = result?.grants ?? [];
  const pending = grants.filter((g) => g.status === 'pending');
  const proposed = grants.filter((g) => g.status === 'proposed');
  const active = grants.filter((g) => g.status === 'active');
  const inactive = grants.filter((g) =>
    ['suspended', 'expired', 'revoked'].includes(g.status),
  );
  const network = result?.scope === 'network';

  return (
    <div data-testid="membership-page">
      <h1>Membership &amp; grants</h1>
      <div className="gold-rule" />
      <p className="muted">
        {result
          ? network
            ? 'Network scope: grants across all hubs, verified against your live grant. Read-only — grant changes go through the governance commands.'
            : `Hub scope: grants in ${result.tenantId ?? tenantId}, verified against your live grant. Read-only — grant changes go through the governance commands.`
          : 'Loading grants…'}
      </p>
      <ErrorNotice error={error} />

      <section className="card" data-testid="membership-pending">
        <h2>Pending invitations ({pending.length})</h2>
        <p className="muted">
          Invitations issued by email. They confer nothing until the invitee
          signs in and claims them.
        </p>
        <GrantTable grants={pending} showTenant={network} />
      </section>

      <section className="card" data-testid="membership-proposed">
        <h2>Proposed grants ({proposed.length})</h2>
        <p className="muted">
          Role requests awaiting an authoriser&apos;s decision. Requests
          flagged for review can only be resolved by Council.
        </p>
        <GrantTable grants={proposed} showTenant={network} />
      </section>

      <section className="card" data-testid="membership-active">
        <h2>Active grants ({active.length})</h2>
        <GrantTable grants={active} showTenant={network} />
      </section>

      <section className="card" data-testid="membership-inactive">
        <h2>Suspended, expired &amp; revoked ({inactive.length})</h2>
        <GrantTable grants={inactive} showTenant={network} />
      </section>

      <section className="card">
        <h2>Boundaries</h2>
        <p className="muted">
          This view shows grant metadata only: who holds which role, in what
          scope, on what basis. It never shows worker records, and viewing it
          is recorded in the access log.
        </p>
      </section>
    </div>
  );
}
