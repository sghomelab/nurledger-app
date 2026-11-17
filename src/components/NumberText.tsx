import { Text, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { fonts, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { useMemo } from 'react';

/**
 * Numeric text — JetBrains Mono for tabular figures (prototype token rule:
 * tabular-nums everywhere numbers appear). Defaults to slate-900.
 */
export function NumberText({ style, children, ...rest }: TextProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Text {...rest} style={[styles.base, style]}>
      {children}
    </Text>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({

    base: {
      fontFamily: fonts.mono,
      color: colors.slate900,
      fontVariant: ['tabular-nums'],
    } as TextStyle,

  });
}