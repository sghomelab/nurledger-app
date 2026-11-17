import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanner } from '../BarcodeScanner';
import { useT } from '../../hooks/useT';
import { layoutReceipt, receiptDataFrom, renderReceiptText, WIDTH_COLS } from '../../lib/receipt';
import type { SaleReceipt } from '../../repositories/saleRepository';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  receipt: SaleReceipt;
  currency: string;
  outletName: string;
  onClose: () => void;
}

/**
 * Email-receipt sheet (issue #19) — offline-first by design: the app never
 * touches a mail server. It collects the customer's address (typed or
 * QR-scanned) and hands a pre-filled draft to the device's mail app
 * (Gmail/Outlook/etc.) via `mailto:`. Works with any account, no network
 * permission needed in-app.
 *
 * The body is the SAME plain-text receipt the register prints (receipt
 * template engine), so emailed and printed receipts never drift.
 */
export function EmailReceiptSheet({ receipt, currency, outletName, onClose }: Props) {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const number = receipt.sale.uuid.slice(0, 8).toUpperCase();

  const body = useMemo(() => {
    const data = receiptDataFrom(receipt, { outletName, currency });
    return renderReceiptText(layoutReceipt(data, '80mm'), WIDTH_COLS['80mm']);
  }, [receipt, outletName, currency]);

  const send = () => {
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setError(t('receipt.emailInvalid'));
      return;
    }
    setError(null);
    const subject = t('receipt.emailSubject', { number, outlet: outletName });
    void Linking.openURL(`mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`).catch(() => {
      // No mail app available — nothing else to do offline.
      onClose();
    });
    onClose();
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('receipt.emailTitle')}</Text>
            <Text style={styles.sub}>
              {t('receipt.emailAddress')} · {outletName} · {number}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={24} color={colors.slate500} />
          </Pressable>
        </View>

        {/* Address: typed or QR-scanned */}
        <View style={styles.row}>
          <TextInput
            style={[styles.input, error && { borderColor: colors.danger }]}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            placeholder={t('receipt.emailPlaceholder')}
            placeholderTextColor={colors.slate400}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => send()}
          />
          <Pressable style={styles.scanBtn} onPress={() => setScanning(true)}>
            <Ionicons name="qr-code-outline" size={18} color={colors.primary} />
            <Text style={styles.scanBtnText}>{t('receipt.emailScanQr')}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.sendBtn} onPress={send}>
          <Ionicons name="send-outline" size={18} color={colors.white} />
          <Text style={styles.sendText}>{t('receipt.emailSend')}</Text>
        </Pressable>
        <Text style={styles.hint}>{t('receipt.emailHint')}</Text>
      </View>

      {/* QR scan for the customer's email (issue #19) */}
      {scanning && (
        <BarcodeScanner
          mode="qr"
          onClose={() => setScanning(false)}
          onScanned={(code) => {
            setScanning(false);
            const addr = code.replace(/^mailto:/i, '').trim();
            setEmail(addr);
            setError(null);
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  sub: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500, marginTop: 2 },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: typography.body,
    color: colors.slate900,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 48,
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
  },
  scanBtnText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.primary },
  error: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.danger },
  sendBtn: {
    height: 54,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sendText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, textAlign: 'center' },
});
