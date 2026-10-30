import { ComingSoon } from '../../src/components/ComingSoon';

/**
 * Tab 1 — POS Register (M2).
 * M1 ships the navigation shell + inventory; the full register (scan → cart →
 * payment → receipt, offline stock decrement) lands in M2.
 */
export default function SellTab() {
  return (
    <ComingSoon
      icon="scan-outline"
      title="POS Register"
      milestone="Ships in M2"
      bullets={[
        'Barcode scan: camera + BT wedge + manual + quick chips',
        'Cart with qty steppers, per-line price adjust (PIN)',
        'Live gross margin in the cart (FIFO cost layers)',
        'Payments: cash / card / mobile / split + receipt print',
        'Offline stock decrement — never blocks on network',
      ]}
    />
  );
}
