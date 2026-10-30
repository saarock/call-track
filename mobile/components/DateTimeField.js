import React from "react";
import { Platform } from "react-native";
import { View, Text, Pressable, Ionicons } from "./Themed";
import { useTheme } from "../context/ThemeContext";
import { Field, Button } from "./UI";
import { chooseDateTime, nativePhone } from "../services/telecom";

export default function DateTimeField({
  label = "Next follow-up",
  value,
  onChange,
}) {
  const { colors } = useTheme();
  if (Platform.OS === "web") {
    const local = value
      ? new Date(+new Date(value) + 345 * 60000).toISOString().slice(0, 16)
      : "";
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>
          {label}
        </Text>
        {React.createElement("input", {
          type: "datetime-local",
          "aria-label": label,
          value: local,
          onChange: (event) =>
            onChange(
              event.target.value
                ? new Date(event.target.value + ":00+05:45").toISOString()
                : null,
            ),
          style: {
            width: "100%",
            boxSizing: "border-box",
            background: colors.surface,
            color: colors.ink,
            border: "1px solid " + colors.border,
            borderRadius: 11,
            padding: "13px 14px",
            fontFamily: "InterRegular, sans-serif",
            fontSize: 14,
            outline: "none",
          },
        })}
      </View>
    );
  }
  if (!nativePhone)
    return (
      <Field
        label={label + " (ISO date and time)"}
        value={value || ""}
        onChangeText={onChange}
        placeholder="2026-10-29T10:00:00+05:45"
      />
    );
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={async () => {
          const selected = await chooseDateTime(value);
          if (selected) onChange(selected);
        }}
        style={{
          backgroundColor: "#FAFBFD",
          borderWidth: 1,
          borderColor: "#E8EBF2",
          borderRadius: 11,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Ionicons name="calendar-outline" size={18} color="#7B8497" />
        <Text
          style={{
            flex: 1,
            fontSize: 14,
            color: value ? "#17223B" : "#7B8497",
          }}
        >
          {value ? new Date(value).toLocaleString() : "Choose date and time"}
        </Text>
      </Pressable>
      {!!value && (
        <Button
          title="Clear date"
          muted
          compact
          onPress={() => onChange(null)}
        />
      )}
    </View>
  );
}
