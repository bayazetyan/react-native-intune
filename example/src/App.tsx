import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getBrokerStatus,
  getState,
  isSupported,
  onWipeRequested,
  type BrokerStatus,
  type IntuneState,
} from 'react-native-intune';

/**
 * Smoke screen for the calls that need neither a tenant nor an enrolled account.
 *
 * `getState()` is expected to reject with `E_NOT_CONFIGURED` until `configure()` has
 * run — seeing that code here is the error path working, not a defect.
 */
export default function App() {
  const [supported, setSupported] = useState<string>('…');
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [state, setState] = useState<IntuneState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribed before anything else is called: a service-initiated wipe can arrive
    // with no prior app call at all (SPEC §4.4).
    const sub = onWipeRequested(({ accountId }) => {
      console.log('wipeRequested', accountId);
    });

    const load = async () => {
      try {
        setSupported(String(await isSupported()));
      } catch (e) {
        setSupported(describe(e));
      }

      try {
        setBroker(await getBrokerStatus());
      } catch (e) {
        setStateError(describe(e));
      }

      try {
        setState(await getState());
      } catch (e) {
        setStateError(describe(e));
      }
    };

    load().catch(() => {});

    return () => sub.remove();
  }, []);

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

      <Text style={styles.section}>getState</Text>
      {stateError !== null && <Row label="error" value={stateError} />}
      {state !== null && (
        <>
          <Row label="configured" value={String(state.configured)} />
          <Row label="tenantId" value={state.configuredTenantId ?? '—'} />
          <Row label="enrolled" value={state.enrolledAccountId ?? '—'} />
          <Row label="status" value={state.status ?? '—'} />
          <Row label="pendingReset" value={state.pendingReset ?? '—'} />
        </>
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

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 72,
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
    fontVariant: ['tabular-nums'],
  },
});
