import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
} from '../../src/repositories/supplierRepository';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { Supplier } from '../../src/types';

/**
 * Supplier master (M6, FR-313): CRUD for suppliers (name, lead time, notes)
 * with the live per-supplier SKU link shown as a product count. POs snapshot
 * the vendor name, so historical documents survive renames/deletes.
 */
export default function SuppliersScreen() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<ReturnType<typeof listSuppliers> extends Promise<infer T> ? T : never>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [lead, setLead] = useState('7');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setSuppliers(await listSuppliers());
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openNew = () => {
    setEditing(null);
    setName('');
    setLead('7');
    setNotes('');
    setFormOpen(true);
  };

  const openEdit = (s: (typeof suppliers)[number]) => {
    setEditing(s);
    setName(s.name);
    setLead(String(s.leadTimeDays));
    setNotes(s.notes ?? '');
    setFormOpen(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const leadDays = Number.parseInt(lead, 10);
      const input = { name, leadTimeDays: Number.isFinite(leadDays) ? leadDays : 7, notes: notes || null };
      if (editing) await updateSupplier(editing.id, input);
      else await createSupplier(input);
      setFormOpen(false);
      await reload();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (s: (typeof suppliers)[number]) => {
    Alert.alert(
      'Delete supplier',
      s.productCount > 0
        ? `"${s.name}" is linked to ${s.productCount} product${s.productCount === 1 ? '' : 's'}. Deleting unlinks them (products keep their data). Continue?`
        : `Delete "${s.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSupplier(s.id);
            await reload();
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.slate700} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Suppliers</Text>
          <Text style={styles.subtitle}>Vendor master · lead times · SKU links</Text>
        </View>
        <Pressable style={styles.newBtn} onPress={openNew} hitSlop={8}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newText}>New</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
        {loaded && suppliers.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={32} color={colors.slate300} />
            <Text style={styles.emptyText}>No suppliers yet. Add one to pick it on purchase orders and link products to it.</Text>
          </View>
        )}
        {suppliers.map((s) => (
          <Pressable key={s.id} style={styles.row} onPress={() => openEdit(s)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.rowMeta}>
                {s.leadTimeDays}d lead · {s.productCount} product{s.productCount === 1 ? '' : 's'}
                {s.notes ? ` · ${s.notes}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => confirmDelete(s)}
              hitSlop={10}
              style={styles.deleteBtn}
            >
              <Ionicons name="trash-outline" size={17} color={colors.danger} />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>

      <Modal transparent visible={formOpen} animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFormOpen(false)}>
          <Pressable style={styles.formCard} onPress={() => {}}>
            <Text style={styles.formTitle}>{editing ? 'Edit supplier' : 'New supplier'}</Text>
            <Field label="Name *">
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Sheng Siong Wholesale"
                placeholderTextColor={colors.slate400}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Lead time (days)">
              <TextInput
                style={styles.inputMono}
                value={lead}
                onChangeText={setLead}
                placeholder="7"
                keyboardType="number-pad"
              />
            </Field>
            <Field label="Notes">
              <TextInput
                style={[styles.input, styles.multiline]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional — delivery days, min order, contacts"
                multiline
                numberOfLines={3}
              />
            </Field>
            <View style={styles.formButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => setFormOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, (saving || !name.trim()) && { opacity: 0.5 }]}
                onPress={() => void save()}
                disabled={saving || !name.trim()}
              >
                <Text style={styles.saveText}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.slate50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate200,
  },
  backBtn: { paddingRight: spacing.md },
  title: { fontFamily: fonts.sansBold, fontSize: 22, color: colors.slate900 },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.control,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
  },
  newText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.white },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: 60 },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500, textAlign: 'center', maxWidth: 300 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.white, borderRadius: radius.card,
    borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowName: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.slate900 },
  rowMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginTop: 2 },
  deleteBtn: { padding: 4 },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
  },
  formCard: {
    width: '100%', maxWidth: 440,
    backgroundColor: colors.white, borderRadius: radius.card + 4,
    padding: spacing.lg, gap: spacing.md,
  },
  formTitle: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.slate900, marginBottom: spacing.xs },
  field: { gap: 6 },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700 },
  input: {
    backgroundColor: colors.slate50, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 15, color: colors.slate900,
  },
  inputMono: {
    backgroundColor: colors.slate50, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.mono, fontSize: 15, color: colors.slate900,
  },
  multiline: { minHeight: 74, textAlignVertical: 'top' },
  formButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.control,
    borderWidth: 1, borderColor: colors.slate200,
  },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.slate700 },
  saveBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.control, backgroundColor: colors.primary,
  },
  saveText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.white },
});
