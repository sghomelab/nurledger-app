/**
 * Shared numeral keypad (PIN entry). Controlled: the parent owns the pin
 * string and decides what a completed entry means. Used by the lock screen
 * (no cancel) and the identity prompt (with cancel) — issue #26 design §5.
 */

import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PIN_MAX_LENGTH } from '../../lib/pin';
import { fonts, radius, spacing, type Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../hooks/useT';

interface Props {
  pin: string;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  /** While an async unlock is in flight (dims the keys). */
  busy?: boolean;
}

const KEY = 72;
const KEY_GAP = spacing.md;

export function PinKeypad({ pin, onDigit, onBackspace, busy = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();

  return (
    <View style={styles.wrap}>
      {/* Dots */}
      <View style={styles.dots}>
        {Array.from({ length: PIN_MAX_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
        ))}
      </View>
      {/* Keypad */}
      <View style={[styles.keypad, busy && { opacity: 0.5 }]}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((k, i) => (
          <Pressable
            key={i}
            style={[styles.key, k === '' && styles.keyDisabled]}
            disabled={k === '' || busy}
            accessibilityRole={k === '' ? undefined : 'button'}
            accessibilityLabel={k === 'back' ? t('pin.backspace') : undefined}
            onPress={() => {
              if (busy) return;
              if (k === 'back') onBackspace();
              else if (k !== '') onDigit(k);
            }}
          >
            {k === 'back' ? (
              <Ionicons name="backspace-outline" size={20} color={colors.slate700} />
            ) : k === '' ? null : (
              <Text style={styles.keyText}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return {
    wrap: { alignItems: 'center' as const, gap: spacing.md },
    dots: { flexDirection: 'row' as const, gap: spacing.sm, paddingVertical: spacing.sm },
    dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.slate200 },
    dotFilled: { backgroundColor: colors.primary },
    keypad: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'center' as const,
      gap: KEY_GAP,
      width: KEY * 3 + KEY_GAP * 2,
    },
    key: {
      width: KEY,
      height: KEY,
      borderRadius: radius.control,
      backgroundColor: colors.slate100,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    keyDisabled: { backgroundColor: 'transparent' },
    keyText: { fontFamily: fonts.sansBold, fontSize: 24, color: colors.slate900 },
  };
}
