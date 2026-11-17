import { useMemo, useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from 'expo-camera';
import { useT } from '../hooks/useT';
import { fonts, radius, spacing, typography, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/** 1-D + 2-D formats used on grocery product barcodes. */
const PRODUCT_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'];
/** Email-address QR codes are QR (DataMatrix accepted as fallback). */
const QR_TYPES: BarcodeType[] = ['qr', 'datamatrix'];

/** The camera keeps reporting a code while it stays in frame — ignore repeats. */
const COOLDOWN_MS = 2500;

interface Props {
  onClose: () => void;
  /** Called with the decoded code (already trimmed). The parent decides what to
   *  do with it and is responsible for closing the scanner. */
  onScanned: (code: string) => void;
  /** 'barcode' = product barcodes · 'qr' = QR codes (e.g. email receipts). */
  mode?: 'barcode' | 'qr';
}

/**
 * Full-screen camera barcode scanner (issues #10/#11/#12, QR part of #19).
 *
 * Permission flow: first open asks for camera access; a denied permission
 * shows a message + an "Open Settings" deep link (the system dialog cannot
 * be re-triggered after denial on iOS). Torch toggle for dim shops.
 */
export function BarcodeScanner({ onClose, onScanned, mode = 'barcode' }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);

  const handleScanned = useCallback(
    (result: BarcodeScanningResult) => {
      const code = (result.data ?? '').trim();
      if (!code) return;
      const now = Date.now();
      const last = lastRef.current;
      if (last && last.code === code && now - last.at < COOLDOWN_MS) return;
      lastRef.current = { code, at: now };
      onScanned(code);
    },
    [onScanned],
  );

  const types = mode === 'qr' ? QR_TYPES : PRODUCT_TYPES;

  return (
    <View style={styles.wrap}>
      {/* Camera */}
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: types }}
          onBarcodeScanned={handleScanned}
        />
      ) : (
        <View style={styles.deniedWrap}>
          <Ionicons name="camera-outline" size={44} color={colors.slate400} />
          <Text style={styles.deniedTitle}>{t('scan.title')}</Text>
          <Text style={styles.deniedText}>{t('scan.cameraDenied')}</Text>
          {/* undetermined or previously allowed-then-denied: ask the system.
              canAskAgain=false means the user chose "Don't allow" — the only
              path left is iOS Settings, so only then show "Open Settings". */}
          {(!permission || permission.canAskAgain) && (
            <Pressable style={styles.btnPrimary} onPress={() => void requestPermission()}>
              <Text style={styles.btnPrimaryText}>{t('scan.title')}</Text>
            </Pressable>
          )}
          {permission && !permission.canAskAgain && (
            <Pressable style={styles.btnPrimary} onPress={() => void Linking.openSettings()}>
              <Text style={styles.btnPrimaryText}>{t('scan.openSettings')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Scanning overlay — corners + hint */}
      {permission?.granted && (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
        </View>
      )}

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.roundBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scan.close')}>
          <Ionicons name="close" size={26} color={colors.white} />
        </Pressable>
        <Text style={styles.topTitle}>{t('scan.title')}</Text>
        <View style={styles.roundBtn} />
      </View>

      {/* Torch */}
      <View style={styles.bottomBar}>
        <View style={{ flex: 1 }} />
        <Pressable
          style={[styles.torchBtn, torch && { backgroundColor: colors.white, opacity: 0.9 }]}
          onPress={() => setTorch((v) => !v)}
          accessibilityLabel={t('scan.torch')}
        >
          <Ionicons name={torch ? 'flash' : 'flash-outline'} size={20} color={torch ? colors.slate900 : colors.white} />
        </Pressable>
        <View style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({

    wrap: { flex: 1, backgroundColor: '#000' },
    deniedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
    deniedTitle: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.white, marginTop: spacing.md },
    deniedText: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate400, textAlign: 'center' },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: spacing.xl + 8 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: 60,
    },
    topTitle: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
    roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center' },
    bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 40, flexDirection: 'row', paddingHorizontal: spacing.lg },
    torchBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center' },
    btnPrimary: { minHeight: 50, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, marginTop: spacing.sm },
    btnPrimaryText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.white },
    cornerTL: { position: 'absolute', top: 0, left: 0, width: 36, height: 36, borderTopWidth: 3, borderLeftWidth: 3, borderColor: colors.white, borderTopLeftRadius: 10 },
    cornerTR: { position: 'absolute', top: 0, right: 0, width: 36, height: 36, borderTopWidth: 3, borderRightWidth: 3, borderColor: colors.white, borderTopRightRadius: 10 },
    cornerBL: { position: 'absolute', bottom: 0, left: 0, width: 36, height: 36, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: colors.white, borderBottomLeftRadius: 10 },
    cornerBR: { position: 'absolute', bottom: 0, right: 0, width: 36, height: 36, borderBottomWidth: 3, borderRightWidth: 3, borderColor: colors.white, borderBottomRightRadius: 10 },

  });
}