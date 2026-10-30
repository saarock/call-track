import React from "react";
import { ScrollView, StyleSheet, useWindowDimensions } from "./Themed";
import { colors } from "../utils/theme";
export default function Screen({ children, style, contentContainerStyle }) {
  const { width } = useWindowDimensions();
  return (
    <ScrollView
      style={[s.screen, style]}
      contentContainerStyle={[
        s.content,
        { padding: width < 600 ? 16 : 28, paddingBottom: 48 },
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: 18, width: "100%", maxWidth: 1400, alignSelf: "center" },
});
