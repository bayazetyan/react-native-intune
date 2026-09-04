import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Intune, {
  type BrokerStatus,
  type Diagnostics,
  type IntuneState,
} from 'react-native-intune';

/**
 * Smoke screen for everything that works without a tenant.
 *
 * The placeholder GUIDs below are deliberately fake. `configure()` only installs the
 * runtime overrides and the SDK delegates — it does not contact the service — so it
 * succeeds or fails on local configuration alone, which is exactly what is worth
 * exercising here. Anything that needs the service is a tenant test, not this.
 */
const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-0000000000t1';
const PLACEHOLDER_CLIENT = '00000000-0000-0000-0000-0000000000c1';
const PLACEHOLDER_ACCOUNT = '3ec2c00f-b125-4519-acf0-302ac3761822';

export default function App() {
  const [supported, setSupported] = useState('…');
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [state, setState] = useState<IntuneState | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [configureResult, setConfigureResult] = useState('not called');
  const [enrollResult, setEnrollResult] = useState('not called');
  const [tokenAsked, setTokenAsked] = useState('never');

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
  }, []);

  const runConfigure = useCallback(async () => {
    setConfigureResult('…');
    try {
      await Intune.configure({
        clientId: PLACEHOLDER_CLIENT,
        tenantId: PLACEHOLDER_TENANT,
        authority: `https://login.microsoftonline.com/${PLACEHOLDER_TENANT}`,
        redirectUri: 'msauth.intune.example://auth',
        verboseLogging: true,
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
        clientId: PLACEHOLDER_CLIENT,
        tenantId: '00000000-0000-0000-0000-0000000000t2',
        authority: 'https://login.microsoftonline.com/other',
        redirectUri: 'msauth.intune.example://auth',
      });
      setConfigureResult('resolved (expected E_RESET_REQUIRED!)');
    } catch (e) {
      setConfigureResult(describe(e));
    }
    await refresh();
  }, [refresh]);

  const runEnroll = useCallback(async () => {
    setEnrollResult('…');
    try {
      const r = await Intune.enroll({ accountId: PLACEHOLDER_ACCOUNT });
      // Resolves for every outcome — a non-success status is data, not an exception.
      setEnrollResult(`${r.status} (${r.nativeCode})`);
    } catch (e) {
      setEnrollResult(describe(e));
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    // Declines every request, on purpose. There is no tenant and no MSAL yet, so the
    // point is to prove the round trip runs at all: SDK asks -> native emits
    // tokenRequest -> this provider answers -> native tells the SDK (SPEC §13.4).
    Intune.setTokenProvider((request) => {
      setTokenAsked(request.resourceId || '(no resource)');
      return null;
    });

    // Subscribed before anything else is called: a service-initiated wipe can arrive
    // with no prior app call at all (SPEC §4.4).
    const subs = [
      Intune.onWipeRequested(({ accountId }) =>
        console.log('wipeRequested', accountId)
      ),
      Intune.onEnrollmentResult((r) =>
        console.log('enrollmentResult', r.status)
      ),
      Intune.onPolicyChanged(() => console.log('policyChanged')),
      Intune.onRestartRequired(({ reason }) =>
        console.log('restartRequired', reason)
      ),
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
      await refresh();
    };

    load().catch(() => {});

    return () => {
      subs.forEach((s) => s.remove());
      Intune.setTokenProvider(null);
    };
  }, [refresh]);

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
      <Row label="result" value={enrollResult} />
      <Row label="token asked for" value={tokenAsked} />
      <View style={styles.buttons}>
        <Button label="enroll" onPress={runEnroll} />
      </View>

      <Text style={styles.section}>getState</Text>
      {state !== null && (
        <>
          <Row label="configured" value={String(state.configured)} />
          <Row label="tenantId" value={state.configuredTenantId ?? '—'} />
          <Row label="enrolled" value={state.enrolledAccountId ?? '—'} />
          <Row label="status" value={state.status ?? '—'} />
          <Row label="pendingReset" value={state.pendingReset ?? '—'} />
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
