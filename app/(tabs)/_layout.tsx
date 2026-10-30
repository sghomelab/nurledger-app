import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, touchTarget } from '../../src/theme/tokens';
import { useProducts } from '../../src/hooks/useAppData';

/**
 * 5-section bottom navigation — prototype order (PROTOTYPE-REFERENCE §1, ADR-005):
 * Sell · Inventory · Expiry · Insights · Shift.
 */
export default function TabLayout() {
  const { lowStock } = useProducts();

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.slate400,
        tabBarStyle: { height: touchTarget + 20, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.sans, fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.slate50 },
        headerStyle: { backgroundColor: colors.slate50 },
        headerTitleStyle: {
          fontFamily: fonts.sansBold,
          fontSize: 18,
          color: colors.slate900,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sell',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarBadge: lowStock > 0 ? lowStock : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning },
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="expiry"
        options={{
          title: 'Expiry',
          tabBarIcon: ({ color, size }) => <Ionicons name="hourglass-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shift"
        options={{
          title: 'Shift',
          tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
