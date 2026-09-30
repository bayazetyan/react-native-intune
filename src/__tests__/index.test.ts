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
  getPolicy: jest.fn(async () => ({}) as object),
  reset: jest.fn(async () => undefined),
  completeReset: jest.fn(async () => undefined),
  resolveToken: jest.fn(),
  rejectToken: jest.fn(),
  getBrokerStatus: jest.fn(async () => ({}) as object),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

jest.mock('../NativeIntune', () => ({ __esModule: true, default: mockNative }));

const Intune = require('../index') as typeof import('../index');
const { EnrollmentStatus, ResetStage } = Intune;

beforeEach(() => {
  jest.clearAllMocks();
});

// Synthetic on purpose. The test only needs a well-formed GUID, and one that looks
// like a real account identifier invites the question of whose it is.
const VALID_ACCOUNT_ID = '11111111-2222-3333-4444-555555555555';

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
    // '' rather than undefined: the Codegen spec has no optionals, so "not known" has to
    // be a value the native side can recognise (SPEC §6.3).
    expect(mockNative.enroll).toHaveBeenCalledWith({
      accountId: VALID_ACCOUNT_ID,
      upn: '',
    });
  });

  it('passes a UPN through when one is supplied', async () => {
    mockNative.enroll.mockResolvedValueOnce({ status: 'succeeded' });
    await Intune.enroll({
      accountId: VALID_ACCOUNT_ID,
      upn: 'user@contoso.com',
    });
    expect(mockNative.enroll).toHaveBeenCalledWith({
      accountId: VALID_ACCOUNT_ID,
      upn: 'user@contoso.com',
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

describe('reset', () => {
  it('unregisters before clearing local data, not after', async () => {
    // The counterintuitive order, and the one SPEC §7 requires: the unregister has to
    // precede any token purge, and on Android the process is expected to die during it.
    const order: string[] = [];
    mockNative.getState.mockResolvedValueOnce({
      enrolledAccountId: VALID_ACCOUNT_ID,
    });
    mockNative.reset.mockImplementationOnce(async () => {
      order.push('native reset');
    });
    mockNative.completeReset.mockImplementationOnce(async () => {
      order.push('completeReset');
    });
    Intune.setResetHandler(async () => {
      order.push('handler');
    });

    await Intune.reset({ wipe: true, reason: 'logout' });

    expect(order).toEqual(['native reset', 'handler', 'completeReset']);
    Intune.setResetHandler(null);
  });

  it('leaves the journal open when the app cannot clear its own data', async () => {
    // Not caught on purpose: an unfinished reset must be retried next launch rather than
    // marked done, because the SDK resumes enrollment retries on its own schedule.
    mockNative.getState.mockResolvedValueOnce({});
    Intune.setResetHandler(async () => {
      throw new Error('storage locked');
    });

    await expect(
      Intune.reset({ wipe: true, reason: 'logout' })
    ).rejects.toThrow('storage locked');
    expect(mockNative.completeReset).not.toHaveBeenCalled();
    Intune.setResetHandler(null);
  });
});

describe('getPolicy', () => {
  it('defaults to permissive when the SDK reports nothing', async () => {
    // Reporting `false` would hide controls nothing is restricting.
    mockNative.getPolicy.mockResolvedValueOnce({});
    await expect(Intune.getPolicy()).resolves.toEqual({
      isManaged: false,
      canSaveToLocal: true,
      canSaveToPersonal: true,
      canOpenFromUnmanaged: true,
      screenshotAllowed: true,
      raw: {},
    });
  });
});

describe('getBrokerStatus', () => {
  /**
   * Regression test for a wrong boolean in a public API field, found on a device.
   *
   * `a || b` has type `int` in C, so boxing it natively produced an NSNumber holding an
   * integer, and it arrived here as the number `1`. A strict `typeof === 'boolean'` check
   * turned that into the fallback, so `brokerAvailable` read `false` on a device with
   * Authenticator installed — arithmetically impossible, since the native side computes
   * it as an OR of the two.
   */
  it('accepts 1 and 0 from the bridge, not only real booleans', async () => {
    mockNative.getBrokerStatus.mockResolvedValueOnce({
      brokerAvailable: 1,
      companyPortalInstalled: 0,
      authenticatorInstalled: true,
      required: 0,
    });
    await expect(Intune.getBrokerStatus()).resolves.toEqual({
      brokerAvailable: true,
      companyPortalInstalled: false,
      authenticatorInstalled: true,
      required: false,
    });
  });

  it('still falls back for values that are neither', async () => {
    mockNative.getBrokerStatus.mockResolvedValueOnce({
      brokerAvailable: 'yes',
      companyPortalInstalled: null,
      authenticatorInstalled: undefined,
      required: 2,
    });
    const status = await Intune.getBrokerStatus();
    expect(status.brokerAvailable).toBe(false);
    expect(status.companyPortalInstalled).toBe(false);
    expect(status.authenticatorInstalled).toBe(false);
    // `required` defaults by platform, and the test environment reports ios.
    expect(status.required).toBe(false);
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
      pendingResetReason: null,
    });
  });

  /**
   * The reason matters on exactly one path, and it is the important one: a wipe the
   * administrator started kills the process before the handler can run, so the resume is
   * the only place the app can tell the user what happened. Flattening it to `'resume'`
   * loses that.
   */
  it('surfaces why an unfinished reset started, so a resume can pass it on', async () => {
    mockNative.getState.mockResolvedValueOnce({
      configured: true,
      pendingReset: 'unregistering',
      pendingResetReason: 'remoteWipe',
    });
    const state = await Intune.getState();
    expect(state.pendingReset).toBe(ResetStage.Unregistering);
    expect(state.pendingResetReason).toBe('remoteWipe');
  });

  /**
   * The journal is on the device, so an app updated in the middle of a reset reads a
   * reason the previous version wrote. The service-initiated wipe is the case that
   * matters: it is written before the process dies, and read at the next launch — which
   * may be the first launch of the new version.
   */
  it('reads a reason written in the pre-1.0 spelling', async () => {
    mockNative.getState.mockResolvedValueOnce({
      configured: true,
      pendingReset: 'unregistering',
      pendingResetReason: 'remote_wipe',
    });
    expect((await Intune.getState()).pendingResetReason).toBe('remoteWipe');
  });

  it('nulls a reset reason it does not recognise rather than guessing', async () => {
    mockNative.getState.mockResolvedValueOnce({
      pendingReset: 'unregistering',
      pendingResetReason: 'something_new',
    });
    await expect(Intune.getState()).resolves.toMatchObject({
      pendingResetReason: null,
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
      // '' means "leave the SDK's default alone", which is not the same as a colour.
      brandingBackground: '',
      brandingForeground: '',
      brandingAccent: '',
      brandingSecondaryBackground: '',
      brandingSecondaryForeground: '',
    });
  });

  it('flattens branding, sending only what was asked for', async () => {
    await Intune.configure({
      clientId: 'client',
      tenantId: 'tenant',
      authority: 'https://login.microsoftonline.com/tenant',
      redirectUri: 'msauth.app://auth',
      branding: { background: '#1B5E20', accent: '#FFC107' },
    });

    expect(mockNative.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        brandingBackground: '#1B5E20',
        brandingAccent: '#FFC107',
        // Untouched keys stay empty rather than becoming a colour of their own.
        brandingForeground: '',
        brandingSecondaryBackground: '',
        brandingSecondaryForeground: '',
      })
    );
  });
});
