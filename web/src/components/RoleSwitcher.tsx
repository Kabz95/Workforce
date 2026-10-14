import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useRole } from '../context/RoleContext';
import { ROLE_CATALOG } from '../lib/roleCatalog';
import type { CanonicalRoleId } from '../lib/types';

export default function RoleSwitcher() {
  const {
    activeRole,
    heldGrants,
    catalogEntry,
    switchRole,
    isSensitiveTransition,
    pendingSensitiveRole,
    confirmSensitiveSwitch,
    cancelSensitiveSwitch,
    error,
  } = useRole();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  const onSelectRole = async (role: CanonicalRoleId) => {
    setIsOpen(false);
    await switchRole(role);
  };

  const pendingEntry = pendingSensitiveRole ? ROLE_CATALOG[pendingSensitiveRole] : null;

  return (
    <div className="role-switcher-container" ref={dropdownRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="role-switcher-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Acting capacity: ${catalogEntry.title}. Tap to switch role.`}
      >
        <span className="role-indicator-dot" aria-hidden="true" />
        <span className="role-trigger-label">
          Acting as: <strong>{catalogEntry.title}</strong>
        </span>
        <span className="role-trigger-arrow" aria-hidden="true">
          {isOpen ? '▴' : '▾'}
        </span>
      </button>

      {isOpen && (
        <div
          className="role-switcher-dropdown"
          role="listbox"
          aria-label="Select an acting capacity"
          tabIndex={-1}
        >
          <div className="role-dropdown-header">
            <span className="dropdown-title">Acting Capacity</span>
            <span className="dropdown-subtext">
              One account per person. Choose which held grant to act under this session.
            </span>
          </div>

          <div className="role-options-list">
            {heldGrants.map((grant) => {
              const info = ROLE_CATALOG[grant.role] || {
                title: grant.role,
                charter: 'Active role assignment',
              };
              const isSelected = grant.role === activeRole;

              return (
                <button
                  key={`${grant.role}-${grant.id}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`role-option-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectRole(grant.role)}
                >
                  <div className="role-option-title-row">
                    <span className="role-option-name">{info.title}</span>
                    {isSelected && <span className="active-badge" aria-label="Currently active">Active</span>}
                  </div>
                  <div className="role-option-charter">{info.charter}</div>
                  <div className="role-option-scope">
                    Scope: <code>{grant.jurisdictionScope}</code> · Circle: {grant.circle}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="notice error role-error" role="alert">
          {error}
        </div>
      )}

      {/* Sensitive Transition Boundary Modal */}
      {isSensitiveTransition && pendingEntry && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="boundary-modal-title"
        >
          <div className="modal-card">
            <h2 id="boundary-modal-title">
              Role Boundary Reminder: {pendingEntry.title}
            </h2>
            <div className="gold-rule" />
            <p className="modal-charter">
              <strong>Charter:</strong> {pendingEntry.charter}
            </p>

            <div className="boundary-warning-box">
              <h3>Boundaries for this role:</h3>
              <ul>
                {pendingEntry.boundaries.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>

            <p className="muted">
              Switching into this role changes your acting context. Previous query caches are
              invalidated, in-flight work is halted, and your actions will be audited under this role grant.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={cancelSensitiveSwitch}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={confirmSensitiveSwitch}
                autoFocus
              >
                I Understand — Switch Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
