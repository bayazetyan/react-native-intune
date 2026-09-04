/**
 * Turning what the bridge hands us into the public types.
 *
 * Everything crossing the bridge is `Object` because Codegen accepts nothing richer, so
 * this is where it becomes typed. Two rules hold throughout:
 *
 *   - **A value we do not recognise never throws.** An SDK update that adds a status
 *     must not crash a shipped app, so unknown strings fall back rather than raise.
 *   - **A missing field gets a deliberate default**, chosen per field. For policy that
 *     means permissive, not `false`: reporting `false` would hide functionality nothing
 *     is restricting.
 */

import { Platform } from 'react-native';

import {
  EnrollmentStatus,
  ResetStage,
  type AuthAccount,
  type AuthResult,
  type BrokerStatus,
  type EnrollmentResult,
  type IntuneState,
  type PolicySnapshot,
} from '../types';

// ---------------------------------------------------------------- primitives

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

export function strRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

// ---------------------------------------------------------------- enums

const ENROLLMENT_STATUSES = new Set<string>(Object.values(EnrollmentStatus));

export function toEnrollmentStatus(value: unknown): EnrollmentStatus {
  return typeof value === 'string' && ENROLLMENT_STATUSES.has(value)
    ? (value as EnrollmentStatus)
    : EnrollmentStatus.Unknown;
}

const RESET_STAGES = new Set<string>(Object.values(ResetStage));

export function toResetStage(value: unknown): ResetStage | null {
  return typeof value === 'string' && RESET_STAGES.has(value)
    ? (value as ResetStage)
    : null;
}

// ---------------------------------------------------------------- objects

export function toEnrollmentResult(raw: object): EnrollmentResult {
  const r = raw as Record<string, unknown>;
  return {
    status: toEnrollmentStatus(r.status),
    accountId: nullableStr(r.accountId),
    nativeCode: str(r.nativeCode),
    nativeMessage: str(r.nativeMessage),
    restartRequired: bool(r.restartRequired),
  };
}

export function toIntuneState(raw: object): IntuneState {
  const r = raw as Record<string, unknown>;
  return {
    configured: bool(r.configured),
    configuredTenantId: nullableStr(r.configuredTenantId),
    registeredAccountIds: strArray(r.registeredAccountIds),
    enrolledAccountId: nullableStr(r.enrolledAccountId),
    status: r.status == null ? null : toEnrollmentStatus(r.status),
    pendingReset: toResetStage(r.pendingReset),
  };
}

export function toPolicySnapshot(raw: object): PolicySnapshot {
  const r = raw as Record<string, unknown>;
  return {
    isManaged: bool(r.isManaged),
    // Permissive defaults: an unmanaged app restricts nothing.
    canSaveToLocal: bool(r.canSaveToLocal, true),
    canSaveToPersonal: bool(r.canSaveToPersonal, true),
    canOpenFromUnmanaged: bool(r.canOpenFromUnmanaged, true),
    screenshotAllowed: bool(r.screenshotAllowed, true),
    raw: strRecord(r.raw),
  };
}

export function toBrokerStatus(raw: object): BrokerStatus {
  const r = raw as Record<string, unknown>;
  return {
    brokerAvailable: bool(r.brokerAvailable),
    companyPortalInstalled: bool(r.companyPortalInstalled),
    authenticatorInstalled: bool(r.authenticatorInstalled),
    // Android cannot enroll without a broker; iOS can.
    required: bool(r.required, Platform.OS === 'android'),
  };
}

export function toAuthResult(raw: object): AuthResult {
  const r = raw as Record<string, unknown>;
  return {
    accountId: str(r.accountId),
    tenantId: str(r.tenantId),
    username: str(r.username),
    accessToken: str(r.accessToken),
    idToken: nullableStr(r.idToken),
    expiresOn: typeof r.expiresOn === 'number' ? r.expiresOn : 0,
    scopes: strArray(r.scopes),
  };
}

export function toAuthAccount(raw: object): AuthAccount {
  const r = raw as Record<string, unknown>;
  return {
    accountId: str(r.accountId),
    tenantId: str(r.tenantId),
    username: str(r.username),
  };
}
