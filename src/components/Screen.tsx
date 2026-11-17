import { View, Text, StyleSheet, type ViewProps, type TextProps } from 'react-native';
import { fonts, radius, spacing, typography, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { useMemo } from 'react';

function makeStyles(colors: Palette) {
  return StyleSheet.create({

    card: {
      backgroundColor: colors.white,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.slate200,
      padding: spacing.lg,
    },
    screen: {
      flex: 1,
      backgroundColor: colors.slate50,
    },

  });
}
/** White rounded-xl card on slate-50 (prototype card style). */
export function Card(props: ViewProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View {...props} style={[styles.card, props.style]} />;
}

/** App screen wrapper: slate-50 background. */
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewProps['style'] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.screen, style]}>
      {children}
    </View>
  );
}

/** Section heading. */
export function Heading({ children, style }: { children: React.ReactNode; style?: TextProps['style'] }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 }, style]}>
      {children}
    </Text>
  );
}
