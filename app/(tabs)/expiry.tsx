import { ComingSoon } from './ComingSoon';

/** Tab 3 — FIFO Expiry Radar (M3). */
export default function ExpiryTab() {
  return (
    <ComingSoon
      icon="hourglass-outline"
      title="FIFO Expiry Radar"
      milestone="Ships in M3"
      bullets={[
        'Batches ranked FEFO (earliest expiry first)',
        'Rose urgency for near/expired lots',
        'Expired waste total + Expiring/Expired/Other breakdown',
      ]}
    />
  );
}
