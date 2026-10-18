/**
 * Compile-time regression tests for F1: updateForm / updatePathwayStep
 * patch types must exclude `sharedWith` / `ownerId` / `tenantId`.
 *
 * This file is type-checked by `tsc -b` (web build) but never imported
 * at runtime. Each `@ts-expect-error` MUST error — if a patch type
 * ever widens to allow one of these fields, the directive becomes
 * unused and the build fails, which is the signal.
 */
import { updateForm, updatePathwayStep } from './queries';

// Positive: ordinary editable fields still compile.
void updateForm('id', { notes: 'ok' });
void updatePathwayStep('id', { status: 'done' });

// @ts-expect-error F1: sharedWith is server-managed (grantAccess only).
void updateForm('id', { sharedWith: ['uid-1'] });
// @ts-expect-error F1: ownerId is immutable.
void updateForm('id', { ownerId: 'uid-1' });
// @ts-expect-error F1: tenantId is immutable.
void updateForm('id', { tenantId: 'hub-1' });
// @ts-expect-error F1: sharedWith is server-managed (grantAccess only).
void updatePathwayStep('id', { sharedWith: ['uid-1'] });
// @ts-expect-error F1: ownerId is immutable.
void updatePathwayStep('id', { ownerId: 'uid-1' });
// @ts-expect-error F1: tenantId is immutable.
void updatePathwayStep('id', { tenantId: 'hub-1' });
