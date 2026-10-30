import { ComingSoon } from '../../src/components/ComingSoon';

/** Tab 5 — Cash Drawer / Shift (M4). */
export default function ShiftTab() {
  return (
    <ComingSoon
      icon="cash-outline"
      title="Cash Drawer"
      milestone="Ships in M4"
      bullets={[
        'Shift open with starting float — register locked when closed',
        'Cash in/out with reasons during shift',
        'Close: counted cash → over/short → Z-report',
      ]}
    />
  );
}
