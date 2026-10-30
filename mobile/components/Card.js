import React from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "./Themed";
import { Ionicons } from "./Themed";
import { colors, fontFamily, shadows } from "../utils/theme";

export default function Card({
  title,
  subtitle,
  icon,
  action,
  children,
  style,
}) {
  const { width } = useWindowDimensions();
  return (
    <View style={[s.card, width < 600 && { padding: 18 }, style]}>
      {!!(title || action || icon) && (
        <View style={s.header}>
          <View style={{ flex: 1, gap: 4 }}>
            {!!title && <Text style={s.title}>{title}</Text>}
            {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
          </View>
          {action}
        </View>
      )}
      {children}
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 16,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  title: {
    fontFamily,
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.25,
  },
  subtitle: { fontFamily, fontSize: 12, lineHeight: 18, color: colors.muted },
});
