import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NumberText } from './NumberText';
import { Chip } from './Chip';
import { PinPrompt } from './PinPrompt';
import { colors, fonts, radius, spacing, typography } from '../theme/tokens';
import { applyStockMove } from '../repositories/stockRepository';
import { useUsers } from '../hooks/useShift';
import { roleCanAct } from '../lib/roles';
import { uuidv4 } from '../lib/ids';
import { formatMoney } from '../lib/money';

type Dir = 'add' | 'remove';

const PRESET_REASONS = ['Damage', 'Lost / stolen', 'Found', 'Counting correction', 'Quality / returned'];

/**
 * Stock adjustment (M3, FR-305): a signed quantity correction with a REQUIRED
 * reason, applied via an immutable `stock_ledger` row (type 'adjustment').
 * M4 (FR-500 / DEV-005): applying is PIN-gated — cashiers need an
 * owner/manager PIN; the gate is single-action.
 */
export function AdjustStockDialog({
  product,
  currency,
  onApplied,
  onClose,
}: {
  product: { id: string; name: string; stockQty: number; costMinor: number };
  currency: string;
  onApplied: () => void;
  onClose: () => void;
}) {
  const { active, users } = useUsers();
  const [dir, setDir] = useState<Dir>('add');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);

  const qtyNum = Math.max(0, Math.floor(Number.parseInt(qty, 10) || 0));
  const delta = dir === 'add' ? qtyNum : -qtyNum;
  const projected = product.stockQty + delta;
  const canConfirm = qtyNum > 0 && reason.trim().length > 0 && projected >= 0;

  const apply = async () => {
    if (!canConfirm || saving) return;
    setSaving(true);
    try {
      await applyStockMove({
        productId: product.id,
        qtyDelta: delta,
        type: 'adjustment',
        reason: reason.trim(),
        refType: 'adjustment',
        refId: uuidv4(),
      });
      onApplied();
      onClose();
    } catch (e) {
      Alert.alert('Adjustment failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const requestApply = () => {
    // FR-500: applying a stock adjustment is gated for cashiers.
    if (active && roleCanAct(active.role, 'stock_adjust')) {
      void apply();
      return;
    }
    setGateVisible(true);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title}>Adjust stock</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.slate400} />
            </Pressable>
          </View>
          <Text style={styles.product} numberOfLines={1}>{product.name}</Text>

          <View style={styles.stockRow}>
            <Text style={styles.stockLabel}>On hand</Text>
            <NumberText style={styles.stockVal}>{product.stockQty}</NumberText>
            <Text style={styles.stockLabel}>→</Text>
            <NumberText style={[styles.stockVal, projected < product.stockQty && { color: colors.danger }, projected > product.stockQty && { color: colors.positive }]}>
              {projected}
            </NumberText>
          </View>

          <View style={styles.dirRow}>
            <Pressable style={[styles.dirBtn, dir === 'add' && styles.dirBtnAdd]} onPress={() => setDir('add')}>
              <Ionicons name="add-circle" size={20} color={dir === 'add' ? colors.white : colors.slate500} />
              <Text style={[styles.dirText, dir === 'add' && { color: colors.white }]}>Add</Text>
            </Pressable>
            <Pressable style={[styles.dirBtn, dir === 'remove' && styles.dirBtnRemove]} onPress={() => setDir('remove')}>
              <Ionicons name="remove-circle" size={20} color={dir === 'remove' ? colors.white : colors.slate500} />
              <Text style={[styles.dirText, dir === 'remove' && { color: colors.white }]}>Remove</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Quantity (base units) *</Text>
          <TextInput
            style={styles.inputMono}
            value={qty}
            onChangeText={setQty}
            placeholder="0"
            placeholderTextColor={colors.slate400}
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Reason * (required)</Text>
          <View style={styles.reasonChips}>
            {PRESET_REASONS.map((r) => (
              <Pressable key={r} onPress={() => setReason(r)}>
                <Chip label={r} tone={reason === r ? 'primary' : 'neutral'} />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.input, { marginTop: spacing.sm }]}
            value={reason}
            onChangeText={setReason}
            placeholder="Or type a reason…"
            placeholderTextColor={colors.slate400}
          />

          <Pressable style={[styles.confirmBtn, !canConfirm && { opacity: 0.5 }]} onPress={requestApply} disabled={!canConfirm || saving}>
            <Text style={styles.confirmText}>{saving ? 'Applying…' : 'Confirm adjustment'}</Text>
          </Pressable>
          <Text style={styles.foot}>Applies an immutable ledger entry. {formatMoney(0, currency)} = no cost change recorded.</Text>
          {gateVisible && (
            <PinPrompt
              visible
              action="stock_adjust"
              users={users ?? []}
              onSuccess={() => {
                setGateVisible(false);
                void apply();
              }}
              onCancel={() => setGateVisible(false)}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: colors.white, borderRadius: radius.card + 4, padding: spacing.lg,
    maxHeight: '86%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  product: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.slate500, marginTop: 2 },
  stockRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
    backgroundColor: colors.slate50, borderRadius: radius.control, padding: spacing.md,
  },
  stockLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500 },
  stockVal: { fontFamily: fonts.mono, fontSize: 18, color: colors.slate900 },
  dirRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  dirBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 12, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white,
  },
  dirBtnAdd: { backgroundColor: colors.positive, borderColor: colors.positive },
  dirBtnRemove: { backgroundColor: colors.danger, borderColor: colors.danger },
  dirText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.slate500 },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700, marginTop: spacing.lg, marginBottom: 6 },
  input: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: fonts.sans, fontSize: 15, color: colors.slate900,
  },
  inputMono: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: fonts.mono, fontSize: 18, color: colors.slate900,
  },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  confirmBtn: {
    backgroundColor: colors.primary, borderRadius: radius.control, paddingVertical: 14,
    alignItems: 'center', marginTop: spacing.xl,
  },
  confirmText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.white },
  foot: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate400, textAlign: 'center', marginTop: spacing.sm },
});
