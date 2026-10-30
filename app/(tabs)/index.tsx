import { useCallback, useMemo, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCart } from '../../src/hooks/useCart';
import { useProducts } from '../../src/hooks/useAppData';
import { QuickChips } from '../../src/components/register/QuickChips';
import { CartLineRow } from '../../src/components/register/CartLineRow';
import { TotalsBlock } from '../../src/components/register/TotalsBlock';
import { PaymentSheet } from '../../src/components/register/PaymentSheet';
import { ReceiptView } from '../../src/components/register/ReceiptView';
import { MoneyPrompt } from '../../src/components/register/MoneyPrompt';
import { NumberText } from '../../src/components/NumberText';
import { formatMoney } from '../../src/lib/money';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import type { PaymentAllocation, ProductWithStock } from '../../src/types';
import type { SaleReceipt } from '../../src/repositories/saleRepository';

type PromptState =
  | { kind: 'order' }
  | { kind: 'price'; key: string }
  | { kind: 'discount'; key: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Tab 1 — POS Register (M2 core loop).
 *
 * Scan (manual + BT/USB wedge; camera FR-100 deferred — see SPEC-DEVIATION)
 * → cart (qty, price adjust, per-line + order discount) → live totals with
 * FIFO margin (FR-321) → payment (cash/card/mobile/split, FR-107) → receipt
 * (FR-109). The whole loop runs on local SQLite — the network never blocks a
 * sale (offline-first rule 1). Every cart mutation is persisted (NFR-3), so a
 * kill mid-sale survives relaunch.
 */
export default function SellTab() {
  const cart = useCart();
  const { products, reload } = useProducts();

  const [barcode, setBarcode] = useState('');
  const [search, setSearch] = useState('');
  const [payVisible, setPayVisible] = useState(false);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [changeMinor, setChangeMinor] = useState(0);
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const currency = cart.currency;
  const { lines, totals, orderDiscountMinor } = cart;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = products ?? [];
    if (!q) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q),
    );
  }, [products, search]);

  /** Barcode entry (FR-101) + keyboard wedge (FR-102): Enter submits; the field
   *  keeps focus (blurOnSubmit=false) so a wedge can fire scan after scan. */
  const submitBarcode = useCallback(async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    try {
      await cart.addByBarcode(code);
    } catch (e) {
      Alert.alert('Scan failed', errMsg(e));
    }
  }, [barcode, cart]);

  const pickProduct = useCallback(
    async (p: ProductWithStock) => {
      try {
        await cart.addProduct(p);
      } catch (e) {
        Alert.alert('Could not add', errMsg(e));
      }
    },
    [cart],
  );

  const bumpQty = useCallback(
    async (key: string, current: number, delta: number) => {
      try {
        await cart.setQty(key, current + delta);
      } catch (e) {
        Alert.alert('Quantity', errMsg(e));
      }
    },
    [cart],
  );

  const canCharge = cart.loaded && !cart.busy && lines.length > 0;

  const onCharge = useCallback(() => {
    if (!canCharge) return;
    Keyboard.dismiss();
    setPayVisible(true);
  }, [canCharge]);

  const onPaymentComplete = useCallback(
    async (payments: PaymentAllocation[], change: number) => {
      setPayVisible(false);
      try {
        const r = await cart.charge(payments);
        setChangeMinor(change);
        setReceipt(r);
        void reload(); // stock changed — refresh the product list (stock levels, chips)
      } catch (e) {
        Alert.alert('Sale failed', errMsg(e));
      }
    },
    [cart, reload],
  );

  const promptLine = prompt && prompt.kind !== 'order' ? lines.find((l) => l.key === prompt.key) : undefined;
  const promptInitial =
    prompt?.kind === 'order'
      ? orderDiscountMinor
      : prompt?.kind === 'price'
        ? (promptLine?.unitPriceMinor ?? 0)
        : (promptLine?.discountMinor ?? 0);

  const onPromptSave = useCallback(
    (minor: number) => {
      if (!prompt) return;
      const job =
        prompt.kind === 'order'
          ? () => cart.setOrderDiscount(minor)
          : prompt.kind === 'price'
            ? () => cart.setLinePrice(prompt.key, minor)
            : () => cart.setLineDiscount(prompt.key, minor);
      setPrompt(null);
      job().catch((e) => Alert.alert('Error', errMsg(e)));
    },
    [prompt, cart],
  );

  const cameraStub = useCallback(() => {
    Alert.alert(
      'Camera scan',
      'Camera barcode scanning is deferred (FR-100). Use a scanner wedge, type the barcode, or tap a product — everything works offline.',
    );
  }, []);

  return (
    <View style={styles.wrap}>
      {/* Scan row — prototype "Scan Item" panel; camera stub (FR-100 deferred) */}
      <View style={styles.scanRow}>
        <View style={styles.scanBox}>
          <Ionicons name="barcode-outline" size={18} color={colors.primary} />
          <TextInput
            style={styles.scanInput}
            value={barcode}
            onChangeText={setBarcode}
            onSubmitEditing={() => void submitBarcode()}
            placeholder="Scan or type barcode + Enter"
            placeholderTextColor={colors.slate400}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            blurOnSubmit={false}
          />
        </View>
        <Pressable style={styles.camBtn} onPress={cameraStub} hitSlop={4} accessibilityLabel="Camera scan (deferred)">
          <Ionicons name="camera-outline" size={22} color={colors.slate400} />
        </Pressable>
      </View>

      {cart.pending > 0 && (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#B45309" />
          <Text style={styles.pendingText}>
            {cart.pending} sale{cart.pending === 1 ? '' : 's'} in the offline queue — syncs when online
          </Text>
        </View>
      )}

      {/* Product search → quick chips (manual add path, FR-101) */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={15} color={colors.slate400} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, SKU or barcode"
          placeholderTextColor={colors.slate400}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <QuickChips products={filtered} onPick={(p) => void pickProduct(p)} />

      {/* Current Order cart */}
      <View style={styles.cartCard}>
        <View style={styles.cartHead}>
          <Text style={styles.cartTitle}>Current Order</Text>
          <View style={styles.cartHeadRight}>
            {lines.length > 0 && (
              <NumberText style={styles.cartCount}>
                {totals.unitCount} item{totals.unitCount === 1 ? '' : 's'}
              </NumberText>
            )}
            {lines.length > 0 && (
              <Pressable onPress={() => void cart.clear().catch((e) => Alert.alert('Error', errMsg(e)))} hitSlop={8}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            )}
          </View>
        </View>

        {lines.length === 0 ? (
          <View style={styles.cartEmpty}>
            <Ionicons name="cart-outline" size={34} color={colors.slate300} />
            <Text style={styles.cartEmptyText}>
              Scan a barcode, search, or tap a product above to start the order.
            </Text>
          </View>
        ) : (
          <ScrollView>
            {lines.map((l) => (
              <CartLineRow
                key={l.key}
                line={l}
                currency={currency}
                onQty={(d) => void bumpQty(l.key, l.qty, d)}
                onRemove={() => void cart.removeLine(l.key).catch((e) => Alert.alert('Error', errMsg(e)))}
                onSetPrice={() => setPrompt({ kind: 'price', key: l.key })}
                onSetDiscount={() => setPrompt({ kind: 'discount', key: l.key })}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Order-level discount (FR-105) */}
      <Pressable
        style={[styles.orderDiscRow, lines.length === 0 && { opacity: 0.45 }]}
        onPress={() => setPrompt({ kind: 'order' })}
        disabled={lines.length === 0}
      >
        <Text style={styles.orderDiscLabel}>Order discount</Text>
        <NumberText style={orderDiscountMinor > 0 ? { color: colors.positive } : { color: colors.slate400 }}>
          {orderDiscountMinor > 0 ? `−${formatMoney(orderDiscountMinor, currency)}` : 'Add'}
        </NumberText>
      </Pressable>

      <TotalsBlock totals={totals} currency={currency} />

      {/* CHARGE — prototype primary CTA */}
      <Pressable style={[styles.chargeBtn, !canCharge && styles.chargeBtnDisabled]} onPress={onCharge} disabled={!canCharge}>
        <Text style={styles.chargeText}>
          {canCharge ? `CHARGE  ${formatMoney(totals.totalMinor, currency)}` : cart.busy ? 'PROCESSING…' : 'CHARGE'}
        </Text>
      </Pressable>

      {/* Payment sheet (FR-107) */}
      <Modal visible={payVisible} animationType="slide" onRequestClose={() => setPayVisible(false)}>
        <PaymentSheet
          totalMinor={totals.totalMinor}
          currency={currency}
          onClose={() => setPayVisible(false)}
          onComplete={(p, c) => void onPaymentComplete(p, c)}
        />
      </Modal>

      {/* On-screen receipt (FR-109) */}
      <Modal visible={receipt !== null} animationType="slide" onRequestClose={() => setReceipt(null)}>
        {receipt && (
          <ReceiptView
            receipt={receipt}
            currency={currency}
            changeMinor={changeMinor}
            onDone={() => setReceipt(null)}
          />
        )}
      </Modal>

      {/* Money prompt: order discount / line price / line discount (FR-105, price adjust) */}
      {prompt && (
        <MoneyPrompt
          title={
            prompt.kind === 'order'
              ? 'Order discount'
              : `${prompt.kind === 'price' ? 'Price' : 'Discount'} — ${promptLine?.name ?? ''}`
          }
          currency={currency}
          initialMinor={promptInitial}
          onSave={onPromptSave}
          onCancel={() => setPrompt(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  scanBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  scanInput: { flex: 1, fontFamily: fonts.monoMedium, fontSize: typography.body + 1, color: colors.slate900 },
  camBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.control,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pendingText: { flex: 1, fontFamily: fonts.sansMedium, fontSize: typography.caption, color: '#B45309' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate900, paddingVertical: 0 },
  cartCard: {
    flex: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cartHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate100,
  },
  cartTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  cartHeadRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cartCount: { fontSize: typography.caption, color: colors.slate500 },
  clearText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate400 },
  cartEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  cartEmptyText: {
    fontFamily: fonts.sans,
    fontSize: typography.caption,
    color: colors.slate400,
    textAlign: 'center',
    maxWidth: 220,
    lineHeight: 18,
  },
  orderDiscRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  orderDiscLabel: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
  chargeBtn: {
    margin: spacing.lg,
    marginBottom: spacing.md,
    height: 58,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chargeBtnDisabled: { opacity: 0.45 },
  chargeText: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.white, letterSpacing: 0.5 },
});
