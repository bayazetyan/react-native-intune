import { describe, expect, it, jest, beforeEach } from '@jest/globals';

/**
 * What unit tests can actually cover here: the JS narrowing layer. Enrollment cannot be
 * tested without a licensed, policy-targeted account in a real tenant, and pretending
 * otherwise would imply coverage this suite does not have.
 */

// Jest requires the `mock` prefix for anything a jest.mock factory closes over, and
// the require() below runs after this is initialised — an ESM import would be hoisted
// above it and hit the temporal dead zone.
const mockNative = {
  configure: jest.fn(async () => undefined),
  enroll: jest.fn(async () => ({}) as object),
  getState: jest.fn(async () => ({}) as object),
  resolveToken: jest.fn(),
  rejectToken: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

jest.mock('../NativeIntune', () => ({ __esModule: true, default: mockNative }));

const Intune = require('../index') as typeof import('../index');
const { EnrollmentStatus, ResetStage } = Intune;

beforeEach(() => {
  jest.clearAllMocks();
});

const VALID_ACCOUNT_ID = '3ec2c00f-b125-4519-acf0-302ac3761822';

describe('enrollment status narrowing', () => {
  it('maps a status this version does not know to Unknown instead of throwing', async () => {
    // A future SDK adding a status must not crash a shipped app (CLAUDE.md, SPEC §13.7).
    mockNative.enroll.mockResolvedValueOnce({
      status: 'somethingMicrosoftAddedLater',
      nativeCode: 'BrandNewCode',
    });

    const result = await Intune.enroll({ accountId: VALID_ACCOUNT_ID });

    expect(result.status).toBe(EnrollmentStatus.Unknown);
    // The raw code still survives, which is what makes a support log useful.
    expect(result.nativeCode).toBe('BrandNewCode');
  });

  it('keeps notLicensed and notTargeted distinct from failed', async () => {
    for (const status of ['notLicensed', 'notTargeted', 'failed'] as const) {
      mockNative.enroll.mockResolvedValueOnce({ status });
      const result = await Intune.enroll({ accountId: VALID_ACCOUNT_ID });
      expect(result.status).toBe(status);
    }
  });

  it('fills in a missing field rather than producing undefined', async () => {
    mockNative.enroll.mockResolvedValueOnce({ status: 'succeeded' });

    const result = await Intune.enroll({ accountId: VALID_ACCOUNT_ID });

    expect(result).toEqual({
      status: EnrollmentStatus.Succeeded,
      accountId: null,
      nativeCode: '',
      nativeMessage: '',
      restartRequired: false,
    });
  });
});

describe('accountId validation', () => {
  it('rejects a UPN with E_INVALID_ACCOUNT_ID and never reaches native', async () => {
    // UPN-based SDK APIs are deprecated, so the module takes the object ID only
    // (SPEC §13.2). Catching it here beats an opaque SDK failure later.
    await expect(
      Intune.enroll({ accountId: 'user@contoso.com' })
    ).rejects.toMatchObject({
      code: 'E_INVALID_ACCOUNT_ID',
    });
    expect(mockNative.enroll).not.toHaveBeenCalled();
  });

  it('accepts an Entra object ID', async () => {
    mockNative.enroll.mockResolvedValueOnce({ status: 'succeeded' });
    await Intune.enroll({ accountId: VALID_ACCOUNT_ID });
    expect(mockNative.enroll).toHaveBeenCalledWith({
      accountId: VALID_ACCOUNT_ID,
    });
  });
});

describe('enroll', () => {
  it('passes a native rejection code through unchanged', async () => {
    // Android cannot enroll without the account's UPN, and the named code is what makes
    // that legible instead of an opaque SDK failure (SPEC §6.3).
    const rejection = Object.assign(new Error('needs a UPN'), {
      code: 'E_UPN_REQUIRED',
    });
    mockNative.enroll.mockRejectedValueOnce(rejection);

    await expect(
      Intune.enroll({ accountId: VALID_ACCOUNT_ID })
    ).rejects.toMatchObject({ code: 'E_UPN_REQUIRED' });
  });

  it('decodes a timed-out enrollment as pending rather than a failure', async () => {
    // The SDK has not failed, it has not answered — it keeps retrying on its own
    // schedule. Reporting `failed` here would block a user the service never rejected.
    mockNative.enroll.mockResolvedValueOnce({
      status: 'pending',
      accountId: VALID_ACCOUNT_ID,
      nativeCode: 'RNIntuneTimeout',
      nativeMessage: 'The SDK did not report a result within the timeout.',
      restartRequired: false,
    });

    const result = await Intune.enroll({ accountId: VALID_ACCOUNT_ID });

    expect(result.status).toBe(EnrollmentStatus.Pending);
    expect(result.nativeCode).toBe('RNIntuneTimeout');
  });
});

describe('setTokenProvider', () => {
  it('accepts a provider and clears it again without touching native', () => {
    // The provider is JS-side state; the native side only ever sees resolveToken /
    // rejectToken in response to its own request (SPEC §13.4).
    const provider = jest.fn(async () => 'token');
    expect(() => Intune.setTokenProvider(provider)).not.toThrow();
    expect(() => Intune.setTokenProvider(null)).not.toThrow();
    expect(mockNative.resolveToken).not.toHaveBeenCalled();
    expect(mockNative.rejectToken).not.toHaveBeenCalled();
  });
});

describe('getState', () => {
  it('narrows a known reset stage and nulls an unknown one', async () => {
    mockNative.getState.mockResolvedValueOnce({
      configured: true,
      configuredTenantId: 'tenant',
      pendingReset: 'cleaningAuth',
    });
    await expect(Intune.getState()).resolves.toMatchObject({
      pendingReset: ResetStage.CleaningAuth,
    });

    mockNative.getState.mockResolvedValueOnce({ pendingReset: 'notAStage' });
    await expect(Intune.getState()).resolves.toMatchObject({
      pendingReset: null,
    });
  });

  it('reports an unconfigured module without throwing', async () => {
    mockNative.getState.mockResolvedValueOnce({});
    await expect(Intune.getState()).resolves.toEqual({
      configured: false,
      configuredTenantId: null,
      registeredAccountIds: [],
      enrolledAccountId: null,
      status: null,
      pendingReset: null,
    });
  });
});

describe('configure', () => {
  it('resolves every optional to a concrete value so native never guesses a default', async () => {
    await Intune.configure({
      clientId: 'client',
      tenantId: 'tenant',
      authority: 'https://login.microsoftonline.com/tenant',
      redirectUri: 'msauth.app://auth',
    });

    expect(mockNative.configure).toHaveBeenCalledWith({
      clientId: 'client',
      tenantId: 'tenant',
      authority: 'https://login.microsoftonline.com/tenant',
      redirectUri: 'msauth.app://auth',
      authMode: 'builtin',
      verboseLogging: false,
      restartHandledByApp: false,
      maxFileProtectionLevel: 'complete',
      strictMode: __DEV__,
      keychainGroupOverride: '',
      telemetryEnabled: true,
    });
  });
});
