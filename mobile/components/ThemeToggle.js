import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { fonts, lightColors, darkColors } from "../utils/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const modes = [
  { value: "light", icon: "sunny-outline", label: "Light" },
  { value: "dark", icon: "moon-outline", label: "Dark" },
  { value: "system", icon: "desktop-outline", label: "System" },
];

function ModePreview({ value }) {
  const p = value === "dark" ? darkColors : lightColors;
  return (
    <View accessible={false} style={{ height: 54, width: "100%", overflow: "hidden", borderWidth: 1, borderColor: p.border, borderRadius: 7, backgroundColor: p.background }}>
      <View style={{ height: 12, borderBottomWidth: 1, borderColor: p.border, backgroundColor: p.surface, paddingLeft: 5, justifyContent: "center" }}><View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: p.primary }} /></View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: 17, borderRightWidth: 1, borderColor: p.border, backgroundColor: p.surface, padding: 4, gap: 4 }}>{[0, 1, 2].map(i => <View key={i} style={{ height: 3, borderRadius: 2, backgroundColor: i ? p.border : p.primary }} />)}</View>
        <View style={{ flex: 1, padding: 6, gap: 4 }}><View style={{ height: 4, width: "60%", borderRadius: 2, backgroundColor: p.ink, opacity: 0.55 }} /><View style={{ height: 13, borderRadius: 3, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }} /></View>
        {value === "system" && <View style={{ position: "absolute", right: 0, top: -12, bottom: 0, width: "45%", backgroundColor: darkColors.surface, borderLeftWidth: 1, borderColor: darkColors.border, padding: 6, gap: 5 }}><View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: darkColors.primary }} /><View style={{ height: 4, marginTop: 8, borderRadius: 2, backgroundColor: darkColors.muted }} /></View>}
      </View>
    </View>
  );
}

export function ThemeOptions({ onSelect, showHint = true }) {
  const { mode, setMode, colors } = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <View accessibilityLabel="Appearance options" style={{ flexDirection: "row", gap: 10 }}>
        {modes.map(({ value, label }) => {
          const selected = mode === value;
          return (
            <Pressable key={value} accessibilityRole="button" accessibilityLabel={label + " appearance"} accessibilityState={{ selected }} onPress={() => { setMode(value); onSelect?.(value); }}
              style={({ pressed, hovered, focused }) => ({ flex: 1, minWidth: 0, padding: 9, paddingBottom: 11, gap: 12, borderWidth: 1.5, borderColor: selected || focused ? colors.primary : colors.border, borderRadius: 12, backgroundColor: selected ? colors.primarySoft : hovered ? colors.background : colors.surface, opacity: pressed ? 0.7 : 1 })}>
              <ModePreview value={value} />
              <Text numberOfLines={1} style={{ textAlign: "center", fontFamily: selected ? fonts.semibold : fonts.medium, fontSize: 12, color: selected ? colors.primary : colors.ink }}>{label}</Text>
              {selected && <View accessible={false} style={{ position: "absolute", top: 13, right: 13, width: 19, height: 19, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}><Ionicons name="checkmark-circle" size={17} color={colors.primary} /></View>}
            </Pressable>
          );
        })}
      </View>
      {showHint && <Text style={{ fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.muted }}>System matches your device. Your preference is saved.</Text>}
    </View>
  );
}

export default function ThemeToggle({ inline = false }) {
  const { mode, colors, setMode, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const trigger = useRef(null), close = useRef(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const selected = modes.find(item => item.value === mode) || modes[2];
  if (inline) return (
    <View accessibilityLabel="Appearance" style={{ flexDirection: "row", padding: 4, gap: 2, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
      {modes.map(({ value, icon, label }) => (
        <Pressable key={value} accessibilityRole="button" accessibilityLabel={label + " appearance"} accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)}
          style={({ pressed, hovered, focused }) => ({ minHeight: 36, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, borderWidth: 1, borderColor: focused ? colors.primary : mode === value ? colors.border : "transparent", backgroundColor: mode === value ? colors.surface : hovered ? colors.primarySoft : "transparent", opacity: pressed ? 0.65 : 1, ...(mode === value && Platform.OS === "web" ? { boxShadow: isDark ? "0 2px 5px rgba(0,0,0,0.18)" : "0 2px 5px rgba(23,34,59,0.06)" } : {}) })}>
          <Ionicons name={icon} size={15} color={mode === value ? colors.primary : colors.muted} /><Text style={{ fontFamily: mode === value ? fonts.semibold : fonts.medium, fontSize: 12, color: mode === value ? colors.ink : colors.muted }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <>
      <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={"Appearance: " + selected.label} accessibilityHint="Choose light, dark, or system appearance" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)}
        style={({ pressed, hovered, focused }) => ({ height: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, borderWidth: 1, borderColor: focused ? colors.primary : colors.border, backgroundColor: hovered ? colors.primarySoft : colors.background, opacity: pressed ? 0.65 : 1 })}>
        <Ionicons name={selected.icon} size={18} color={colors.ink} /><Ionicons name="chevron-down" size={12} color={colors.muted} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)} onShow={() => close.current?.focus?.()} onDismiss={() => trigger.current?.focus?.()}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: width < 600 ? "flex-end" : "center", padding: 16, paddingBottom: width < 600 ? Math.max(16, insets.bottom + 12) : 16, backgroundColor: "rgba(5,12,24,0.48)" }}>
          <Pressable accessible={false} onPress={() => setOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 420, padding: 20, gap: 22, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft }}><Ionicons name="color-palette-outline" size={20} color={colors.primary} /></View><Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 17, color: colors.ink }}>Appearance</Text><Pressable ref={close} accessibilityRole="button" accessibilityLabel="Close appearance" onPress={() => setOpen(false)} style={({ hovered, focused }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: focused ? colors.primary : "transparent", backgroundColor: hovered ? colors.background : "transparent" })}><Ionicons name="close" size={21} color={colors.muted} /></Pressable></View>
            <ThemeOptions onSelect={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
