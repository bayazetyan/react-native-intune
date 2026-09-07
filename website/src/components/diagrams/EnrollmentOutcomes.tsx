import type { ReactNode } from 'react';

/**
 * The enrollment outcomes, as one ordered list rather than two columns.
 *
 * The artboard drew this as a left/right split — three outcomes each side. That works for
 * six and falls apart at eleven, which is how many there actually are: the left column
 * ends after three rows while the right runs on for two screens, and the reader has to
 * scan sideways to compare them. Stacked groups with a fixed three-column rhythm
 * (status · what it means · what your app does) read top to bottom and stay aligned however
 * many rows a group has.
 *
 * The design's actual idea is kept: the split is by *what your app must do*, not by
 * severity, because the mistake this page exists to prevent is treating a non-failure as a
 * failure. That is also why `notLicensed` carries its own line.
 *
 * This replaces the markdown table that used to sit beside it on the page. One
 * representation of eleven statuses is a reference; two is a maintenance problem and a
 * question about which one is right.
 */
type Outcome = {
  status: string;
  meaning: string;
  action: string;
  /** Set on the one outcome people get wrong. */
  emphasis?: string;
};

const LET_IN: Outcome[] = [
  {
    status: 'succeeded',
    meaning: 'Identity registered, policy in force.',
    action: 'Continue into the app.',
  },
  {
    status: 'notTargeted',
    meaning: 'Licensed, but no administrator has aimed a policy at this account.',
    action: 'Continue. The app runs unmanaged — nothing is meant to be enforced yet.',
  },
  {
    status: 'notLicensed',
    meaning: 'The tenant uses Intune; this employee has no licence.',
    action: 'Continue. The SDK keeps retrying in case a licence appears later.',
    emphasis:
      'Do not block the user. Treating this as a failure locks out an employee who is allowed in.',
  },
];

const HANDLE: Outcome[] = [
  {
    status: 'failed',
    meaning: 'Licensed and targeted, but enrollment failed — including the service being unreachable.',
    action: 'Block access to corporate data until it succeeds.',
  },
  {
    status: 'pending',
    meaning: 'First attempt in progress.',
    action: 'A progress state is reasonable here.',
  },
  {
    status: 'authorizationNeeded',
    meaning: 'No valid token was supplied.',
    action: 'Check your token provider, then retry.',
  },
  {
    status: 'wrongUser',
    meaning: 'A different account is already enrolled.',
    action: "Block this account's data; the SDK prompts the user to remove one.",
  },
  {
    status: 'companyPortalRequired',
    meaning: 'Android only — the broker is missing.',
    action: 'The SDK drives the install prompt; supplement it with your own copy.',
  },
  {
    status: 'unknown',
    meaning: 'A status this version does not map.',
    action: 'Treat it conservatively and open an issue.',
  },
];

const RESET: Outcome[] = [
  {
    status: 'unenrolled',
    meaning: 'Terminal state of a completed reset.',
    action: 'Handled by the reset flow, not by this branch.',
  },
  {
    status: 'unenrollmentFailed',
    meaning: 'Terminal state of a reset that did not finish.',
    action: 'The journal reopens it on the next launch.',
  },
];

function Group({
  tone,
  label,
  verdict,
  outcomes,
}: {
  tone: 'run' | 'handle' | 'reset';
  label: string;
  verdict: string;
  outcomes: Outcome[];
}): ReactNode {
  return (
    <section className={`outcomes__group outcomes__group--${tone}`}>
      <header>
        <span className="outcomes__label">{label}</span>
        <strong>{verdict}</strong>
      </header>
      <ul>
        {outcomes.map((o) => (
          <li key={o.status}>
            <code>{o.status}</code>
            <p className="outcomes__meaning">{o.meaning}</p>
            <p className="outcomes__action">{o.action}</p>
            {o.emphasis ? <p className="outcomes__emphasis">{o.emphasis}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EnrollmentOutcomes(): ReactNode {
  return (
    <div className="outcomes">
      <Group
        tone="run"
        label="Let the user in — 3 of 11"
        verdict="Not an error. The app runs."
        outcomes={LET_IN}
      />
      <Group
        tone="handle"
        label="Handle it — 6 of 11"
        verdict="Something to do about it."
        outcomes={HANDLE}
      />
      <Group
        tone="reset"
        label="Reset states — 2 of 11"
        verdict="Not reached by enroll()."
        outcomes={RESET}
      />
    </div>
  );
}
