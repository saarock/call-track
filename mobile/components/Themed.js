import React, { forwardRef } from "react";
import * as Native from "react-native";
import { Ionicons as NativeIonicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { appearanceColor, appearanceStyle } from "../utils/appearance";

export * from "react-native";
function themed(Component, text = false) {
  return forwardRef(function ThemedPrimitive(
    { style, placeholderTextColor, selectionColor, ...props },
    ref,
  ) {
    const { isDark } = useTheme();
    const resolve = (value) => appearanceStyle(value, isDark, text);
    const resolvedStyle =
      typeof style === "function"
        ? (state) => resolve(style(state))
        : resolve(style);
    return (
      <Component
        {...props}
        ref={ref}
        {...(Component === Native.TextInput
          ? { keyboardAppearance: isDark ? "dark" : "light" }
          : {})}
        style={resolvedStyle}
        {...(placeholderTextColor
          ? {
              placeholderTextColor: appearanceColor(
                placeholderTextColor,
                "foreground",
                isDark,
              ),
            }
          : {})}
        {...(selectionColor
          ? {
              selectionColor: appearanceColor(
                selectionColor,
                "foreground",
                isDark,
              ),
            }
          : {})}
      />
    );
  });
}
export const View = themed(Native.View);
export const Text = themed(Native.Text, true);
export const TextInput = themed(Native.TextInput, true);
export const Pressable = themed(Native.Pressable);
export const KeyboardAvoidingView = themed(Native.KeyboardAvoidingView);
export const ScrollView = forwardRef(function ThemedScrollView(
  { style, contentContainerStyle, ...props },
  ref,
) {
  const { isDark } = useTheme();
  return (
    <Native.ScrollView
      {...props}
      ref={ref}
      style={appearanceStyle(style, isDark)}
      contentContainerStyle={appearanceStyle(contentContainerStyle, isDark)}
    />
  );
});
export const ActivityIndicator = forwardRef(function ThemedActivity(
  { color, ...props },
  ref,
) {
  const { isDark, colors } = useTheme();
  return (
    <Native.ActivityIndicator
      {...props}
      ref={ref}
      color={
        color ? appearanceColor(color, "foreground", isDark) : colors.primary
      }
    />
  );
});
export function StatusBar(props) {
  const { isDark, colors } = useTheme();
  return (
    <Native.StatusBar
      {...props}
      barStyle={isDark ? "light-content" : props.barStyle || "dark-content"}
      backgroundColor={isDark ? colors.background : props.backgroundColor}
    />
  );
}
export const Ionicons = forwardRef(function ThemedIonicons(
  { color, style, ...props },
  ref,
) {
  const { isDark } = useTheme();
  return (
    <NativeIonicons
      {...props}
      ref={ref}
      color={appearanceColor(color, "foreground", isDark)}
      style={appearanceStyle(style, isDark)}
    />
  );
});

export const Switch = forwardRef(function ThemedSwitch(
  { trackColor, thumbColor, ...props },
  ref,
) {
  const { isDark, colors } = useTheme();
  return (
    <Native.Switch
      {...props}
      ref={ref}
      trackColor={
        isDark ? { false: colors.border, true: "#4C437B" } : trackColor
      }
      thumbColor={isDark ? (props.value ? "#B8ACFF" : "#C6CFDE") : thumbColor}
    />
  );
});
