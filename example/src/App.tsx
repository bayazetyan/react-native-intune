import { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import tenant from '../tenant.json';
import Intune, {
  type BrokerStatus,
  type Diagnostics,
  type IntuneState,
  type PolicySnapshot,
} from 'react-native-intune';

/**
 * Live test screen, pointed at whichever tenant `tenant.json` names.
 *
 * That file is gitignored and created from `tenant.example.json` by `yarn ensure-tenant`,
 * which runs before start, ios and android — so a fresh clone bundles, and the only thing
 * a contributor does is fill in two GUIDs from their own Entra app registration. See
 * docs/tenant-setup.md to create one.
 *
 * Read through a JSON import rather than an env var because Metro resolves imports
 * statically: the file has to exist at bundle time, which is exactly what the script
 * guarantees.
 */
const REDIRECT_URI = Platform.select({
  ios: tenant.redirectUriIos,
  default: tenant.redirectUriAndroid,
});

/**
 * Who restarts the app when the SDK says one is needed — which it does when policy
 * arrives for the first time.
 *
 * `false` lets the SDK do it, and that is what a host app usually wants: it is one line
 * of configuration instead of a restart path to write and get wrong. `true` makes it the
 * app's job, and the module reports it through `restartRequired` so the app can save work
 * first. Flip this to exercise the other branch — both are meant to work.
 */
const RESTART_HANDLED_BY_APP = false;

export default function App() {
  const [supported, setSupported] = useState('…');
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [state, setState] = useState<IntuneState | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [policy, setPolicy] = useState<PolicySnapshot | null>(null);
  const [configureResult, setConfigureResult] = useState('not called');
  const [enrollResult, setEnrollResult] = useState('not called');
  const [tokenAsked, setTokenAsked] = useState('never');
  // Service-initiated events. They arrive with no app call at all, so a console log is
  // not enough to observe them — on iOS the bundle is embedded and there is no console.
  const [lastWipe, setLastWipe] = useState('never');
  const [lastRestart, setLastRestart] = useState('never');
  const [authResult, setAuthResult] = useState('not called');
  const [authUser, setAuthUser] = useState('—');
  const [authAccountId, setAuthAccountId] = useState('—');
  const [cachedAccounts, setCachedAccounts] = useState('not called');
  const [upn, setUpn] = useState(tenant.testUpn ?? '');

  const refresh = useCallback(async () => {
    try {
      setState(await Intune.getState());
    } catch (e) {
      setConfigureResult(`getState: ${describe(e)}`);
    }
    try {
      setDiagnostics(await Intune.getDiagnostics());
    } catch {
      setDiagnostics(null);
    }
    try {
      setPolicy(await Intune.getPolicy());
    } catch {
      setPolicy(null);
    }
  }, []);

  const runConfigure = useCallback(async () => {
    setConfigureResult('…');
    try {
      await Intune.configure({
        clientId: tenant.clientId,
        tenantId: tenant.tenantId,
        authority: `https://login.microsoftonline.com/${tenant.tenantId}`,
        redirectUri: REDIRECT_URI,
        verboseLogging: true,
        restartHandledByApp: RESTART_HANDLED_BY_APP,
      });
      setConfigureResult('resolved');
    } catch (e) {
      setConfigureResult(describe(e));
    }
    await refresh();
  }, [refresh]);

  /** Must reject with E_RESET_REQUIRED — silently reconfiguring would leave the old
   * tenant enrolled. */
  const runTenantSwitch = useCallback(async () => {
    setConfigureResult('…');
    try {
      await Intune.configure({
        clientId: tenant.clientId,
        tenantId: '00000000-0000-0000-0000-000000000002',
        authority: 'https://login.microsoftonline.com/other',
        redirectUri: REDIRECT_URI,
      });
      setConfigureResult('resolved (expected E_RESET_REQUIRED!)');
    } catch (e) {
      setConfigureResult(describe(e));
    }
    await refresh();
  }, [refresh]);

  /**
   * The SDK runs the sign-in itself and shows its own screen, so this reaches a real
   * enrollment without the module's MSAL layer (spike S-3) existing yet. iOS only.
   */
  const runEnrollInteractive = useCallback(async () => {
    setEnrollResult('signing in…');
    try {
      const r = await Intune.enrollInteractive({ upn });
      // Resolves for every outcome — a non-success status is data, not an exception.
      setEnrollResult(`${r.status} (${r.nativeCode})`);
    } catch (e) {
      setEnrollResult(describe(e));
    }
    await refresh();
  }, [refresh, upn]);

  /**
   * The path a production app takes, and the one `enrollInteractive` has been standing in
   * for: the module signs in, hands back an account id, and `enroll` uses it.
   *
   * The interesting part is what is *absent* — no token provider is registered for this,
   * and none should be needed. The SDK acquires the MAM token itself from the MSAL cache
   * signIn just populated (SPEC §5.1.3). A second password prompt here would mean the two
   * are not sharing a keychain group.
   */
  const runSignInAndEnroll = useCallback(async () => {
    setAuthResult('signing in…');
    setEnrollResult('waiting for sign-in');
    try {
      const auth = await Intune.signIn({
        loginHint: upn.length > 0 ? upn : undefined,
      });
      // Deliberately no token on screen: the access token is for the app's own scopes
      // and has no place on a debug screen, and the MAM token never reaches JS at all
      // (CLAUDE.md rule 9). The account id is shown because it is the value that gets
      // passed to enroll() — seeing it is the point.
      setAuthResult('signed in');
      setAuthUser(auth.username);
      setAuthAccountId(auth.accountId);

      setEnrollResult('enrolling…');
      const r = await Intune.enroll({ accountId: auth.accountId });
      setEnrollResult(`${r.status} (${r.nativeCode})`);
    } catch (e) {
      const described = describe(e);
      setAuthResult(described);
      setEnrollResult(`stopped: ${described}`);
    }
    await refresh();
  }, [refresh, upn]);

  /** Cache-first. E_INTERACTION_REQUIRED here is the normal answer with an empty cache. */
  const runSignInSilent = useCallback(async () => {
    setAuthResult('…');
    try {
      const auth = await Intune.signInSilent();
      setAuthResult('silent: ok');
      setAuthUser(auth.username);
      setAuthAccountId(auth.accountId);
    } catch (e) {
      setAuthResult(`silent: ${describe(e)}`);
    }
    await refresh();
  }, [refresh]);

  /** Its own row: overwriting the sign-in result made it look like state was lost. */
  const runGetAccounts = useCallback(async () => {
    try {
      const accounts = await Intune.getAccounts();
      setCachedAccounts(
        accounts.length === 0
          ? 'none'
          : // More than one means state a reset should have cleared (SPEC §9).
            accounts.map((a) => a.username).join(', ')
      );
    } catch (e) {
      setCachedAccounts(describe(e));
    }
  }, []);

  /**
   * Reset leaves the module unconfigured on purpose — clearing the runtime overrides is
   * what makes a move to a different tenant possible (SPEC §5.2). So configure again
   * afterwards, which is what a host app does: it reconciles at launch, and a reset is
   * just an earlier trigger for the same path. Without this every button afterwards
   * rejects with E_NOT_CONFIGURED until the app is relaunched.
   */
  const runReset = useCallback(async () => {
    setEnrollResult('resetting…');
    try {
      await Intune.reset({ wipe: true, reason: 'support_reset' });
      setEnrollResult('reset resolved, reconfiguring…');
    } catch (e) {
      setEnrollResult(`reset: ${describe(e)}`);
    }
    // Runs even when reset rejected. A rejection means the journal stayed open, and the
    // retry on the next configure is exactly what should happen.
    await runConfigure();
    setEnrollResult((prev) =>
      prev === 'reset resolved, reconfiguring…' ? 'reset resolved' : prev
    );
  }, [runConfigure]);

  useEffect(() => {
    // Declines every request, on purpose. There is no tenant and no MSAL yet, so the
    // point is to prove the round trip runs at all: SDK asks -> native emits
    // tokenRequest -> this provider answers -> native tells the SDK (SPEC §13.4).
    // Proves the journal is what drives the sequence: the handler runs after the
    // native unregister, not before, and a throw here leaves the journal open.
    Intune.setResetHandler(({ reason }) => {
      console.log('resetHandler', reason);
    });

    Intune.setTokenProvider((request) => {
      setTokenAsked(request.resourceId || '(no resource)');
      return null;
    });

    // Subscribed before anything else is called: a service-initiated wipe can arrive
    // with no prior app call at all (SPEC §4.4).
    const subs = [
      Intune.onWipeRequested(({ accountId }) => {
        // Only the first characters: enough to tell which account, without putting a
        // full identifier on a debug screen.
        // Nullable on purpose: a service-initiated wipe can arrive without naming an
        // account, which is itself worth seeing rather than hiding behind a default.
        const who =
          accountId != null ? `${accountId.slice(0, 8)}…` : '(no account)';
        setLastWipe(`${new Date().toLocaleTimeString()} ${who}`);
        refresh().catch(() => {});
      }),
      Intune.onEnrollmentResult((r) => {
        console.log('enrollmentResult', r.status);
        refresh().catch(() => {});
      }),
      Intune.onPolicyChanged(() => {
        console.log('policyChanged');
        refresh().catch(() => {});
      }),
      Intune.onRestartRequired(({ reason }) => {
        setLastRestart(`${new Date().toLocaleTimeString()} ${reason}`);
      }),
    ];

    const load = async () => {
      try {
        setSupported(String(await Intune.isSupported()));
      } catch (e) {
        setSupported(describe(e));
      }
      try {
        setBroker(await Intune.getBrokerStatus());
      } catch {
        setBroker(null);
      }

      // Resume an interrupted reset before anything else (SPEC §13.2).
      //
      // The reset sequence is expected to be cut short by the process dying: on Android
      // Microsoft documents it, and on iOS it happens too once a policy is actually in
      // force — observed on an iPad, where the app survived a reset while the tenant had
      // no restrictions and was killed by the wipe once it did. Everything after the
      // unregister therefore lives in the journal, and this is where it gets picked up.
      //
      // Skipping this is the failure the journal exists to prevent: the account is gone
      // from the SDK but the app's own data was never cleared, and nothing will ever come
      // back to clear it.
      const pending = await Intune.getState().catch(() => null);
      if (pending?.pendingReset != null) {
        // The reason is in the message and not only in a row, because the resume
        // finishes before the first render — by the time the screen is up,
        // `pendingReset` is already null and there is nothing left to look at.
        setEnrollResult(
          `resuming reset (${pending.pendingReset}, reason: ${
            pending.pendingResetReason ??
            'MISSING — the journal did not carry one'
          })`
        );
        // Passes the *original* reason on, not `'resume'`. The journal knows why the
        // reset started, and that is what the handler needs: on the path that matters
        // most — a wipe the administrator started — the process dies before the handler
        // can run in the original call, so this resume is the only chance to say
        // "an administrator revoked access" rather than nothing (SPEC §7.4).
        await Intune.reset({
          wipe: true,
          reason: pending.pendingResetReason ?? 'resume',
        }).catch((e) => {
          setEnrollResult(`resume failed: ${describe(e)}`);
        });
      }

      // Every launch, not once. The module holds the configuration in memory only, on
      // purpose: a host app fetches it per customer at startup, so a tenant change takes
      // effect on the next launch instead of leaving stale settings behind.
      await runConfigure();
    };

    load().catch(() => {});

    return () => {
      subs.forEach((s) => s.remove());
      Intune.setTokenProvider(null);
      Intune.setResetHandler(null);
    };
  }, [refresh, runConfigure]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>react-native-intune</Text>

      <Row label="isSupported" value={supported} />

      <Text style={styles.section}>getBrokerStatus</Text>
      {broker === null ? (
        <Row label="" value="…" />
      ) : (
        <>
          <Row label="brokerAvailable" value={String(broker.brokerAvailable)} />
          <Row
            label="companyPortal"
            value={String(broker.companyPortalInstalled)}
          />
          <Row
            label="authenticator"
            value={String(broker.authenticatorInstalled)}
          />
          <Row label="required" value={String(broker.required)} />
        </>
      )}

      <Text style={styles.section}>configure</Text>
      <Row label="result" value={configureResult} />
      <View style={styles.buttons}>
        <Button label="configure" onPress={runConfigure} />
        <Button label="switch tenant" onPress={runTenantSwitch} />
      </View>

      <Text style={styles.section}>enroll</Text>
      <TextInput
        style={styles.input}
        value={upn}
        onChangeText={setUpn}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="UPN to sign in as"
      />
      <Row label="signIn" value={authResult} />
      <Row label="username" value={authUser} />
      <Row label="accountId" value={authAccountId} />
      <Row label="cached accounts" value={cachedAccounts} />
      <Row label="result" value={enrollResult} />
      <Row label="token asked for" value={tokenAsked} />
      <Row label="wipeRequested" value={lastWipe} />
      <Row label="restartRequired" value={lastRestart} />
      <View style={styles.buttons}>
        <Button label="signIn + enroll" onPress={runSignInAndEnroll} />
        <Button label="silent" onPress={runSignInSilent} />
        <Button label="accounts" onPress={runGetAccounts} />
      </View>
      <View style={styles.buttons}>
        <Button label="SDK-driven enroll" onPress={runEnrollInteractive} />
        <Button label="reset" onPress={runReset} />
      </View>

      <Text style={styles.section}>getState</Text>
      {state !== null && (
        <>
          <Row label="configured" value={String(state.configured)} />
          <Row label="tenantId" value={state.configuredTenantId ?? '—'} />
          <Row label="enrolled" value={state.enrolledAccountId ?? '—'} />
          <Row label="status" value={state.status ?? '—'} />
          <Row label="pendingReset" value={state.pendingReset ?? '—'} />
          <Row
            label="pendingResetReason"
            value={state.pendingResetReason ?? '—'}
          />
        </>
      )}

      <Text style={styles.section}>getPolicy</Text>
      <View style={styles.buttons}>
        <Button
          label="re-read policy"
          onPress={() => {
            refresh().catch(() => {});
          }}
        />
      </View>
      {policy === null ? (
        <Row label="" value="—" />
      ) : (
        <>
          <Row label="isManaged" value={String(policy.isManaged)} />
          <Row label="canSaveToLocal" value={String(policy.canSaveToLocal)} />
          <Row
            label="canSaveToPersonal"
            value={String(policy.canSaveToPersonal)}
          />
          <Row
            label="canOpenFromUnmanaged"
            value={String(policy.canOpenFromUnmanaged)}
          />
          <Row
            label="screenshotAllowed"
            value={String(policy.screenshotAllowed)}
          />
          {Object.entries(policy.raw).map(([k, v]) => (
            <Row key={k} label={`raw.${k}`} value={v} />
          ))}
        </>
      )}

      <Text style={styles.section}>getDiagnostics</Text>
      {diagnostics === null ? (
        <Row label="" value="—" />
      ) : (
        Object.entries(diagnostics).map(([k, v]) => (
          <Row key={k} label={k} value={v === '' ? '—' : v} />
        ))
      )}
    </ScrollView>
  );
}

function describe(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return String((e as { code: unknown }).code);
  }
  return e instanceof Error ? e.message : String(e);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 4,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
  },
  section: {
    marginTop: 20,
    marginBottom: 4,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    color: '#666',
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
  input: {
    borderWidth: 1,
    borderColor: '#c7c7cc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 15,
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#e5e5ea',
  },
  buttonLabel: {
    fontWeight: '600',
  },
});
