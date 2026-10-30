import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { fonts } from "../utils/theme";
import ThemeToggle from "./ThemeToggle";

export function Brand({ agent = false, inverse = false }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: inverse ? "#169B80" : colors.primarySoft, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: inverse ? "#279F87" : colors.border }}>
        <Ionicons name="call" size={18} color={inverse ? "#FFFFFF" : colors.primary} />
      </View>
      <View style={{ minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.6, color: inverse ? "#FFFFFF" : colors.ink }}>CallTrack</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 10, color: inverse ? "#A6B4CB" : colors.muted }}>{agent ? "Dialer" : "CRM"} · Royal Cleaning</Text>
      </View>
    </View>
  );
}

function HeaderAction({ label, icon, onPress, children }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed, hovered, focused }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: focused ? colors.primary : colors.border, backgroundColor: hovered ? colors.primarySoft : colors.surface, opacity: pressed ? 0.65 : 1 })}>
      {children || <Ionicons name={icon} size={19} color={colors.muted} />}
    </Pressable>
  );
}

export default function AppHeader({ desktop = false, agent = false, title, onBack, onNotifications, onProfile, fullName = "" }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const initials = fullName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return (
    <View style={{ paddingTop: desktop ? 0 : insets.top, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
      <View style={{ minHeight: desktop ? 80 : 72, paddingHorizontal: desktop ? 28 : 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: desktop ? 16 : 10 }}>
        {!!onBack && <HeaderAction label="Back" icon="arrow-back" onPress={onBack} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          {desktop ? <View style={{ gap: 5 }}><Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.muted }}>Royal Cleaning Services</Text><Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -0.45, color: colors.ink }}>{title || "Workspace"}</Text></View> : title ? <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.3, color: colors.ink }}>{title}</Text> : <Brand agent={agent} />}
        </View>
        <ThemeToggle inline={desktop} />
        {!!onNotifications && <HeaderAction label="Notifications" icon="notifications-outline" onPress={onNotifications} />}
        {!!(desktop && onProfile) && <><View style={{ width: 1, height: 26, backgroundColor: colors.border, marginHorizontal: 2 }} /><HeaderAction label="Open profile" onPress={onProfile}><View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.primarySoft }}><Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.primary }}>{initials || "CT"}</Text></View></HeaderAction></>}
      </View>
    </View>
  );
}
