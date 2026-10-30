import { Text, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts } from '../theme/tokens';

/**
 * Numeric text — JetBrains Mono for tabular figures (prototype token rule:
 * tabular-nums everywhere numbers appear). Defaults to slate-900.
 */
export function NumberText({ style, children, ...rest }: TextProps) {
  return (
    <Text {...rest} style={[styles.base, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: fonts.mono,
    color: colors.slate900,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
});
