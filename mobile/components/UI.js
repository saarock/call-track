import { Platform as CardPlatform } from "react-native";
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
  Platform,
  useWindowDimensions,
  Modal,
  ScrollView,
} from "./Themed";
import { Ionicons } from "./Themed";
import { colors, fontFamily, shadows } from "../utils/theme";

import { useTheme } from "../context/ThemeContext";
const tones = {
  primary: { ink: colors.primary, bg: colors.primarySoft },
  info: { ink: colors.primary, bg: colors.primarySoft },
  purple: { ink: "#8A62C5", bg: "#F3EDFA" },
  success: { ink: colors.success, bg: colors.successSoft },
  warning: { ink: colors.warning, bg: colors.warningSoft },
  danger: { ink: colors.danger, bg: colors.dangerSoft },
  neutral: { ink: colors.muted, bg: "#F0F2F6" },
};
export const styles = StyleSheet.create({
  title: {
    fontFamily,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.7,
    color: colors.ink,
  },
  body: { fontFamily, fontSize: 13, lineHeight: 21, color: colors.muted },
  label: {
    fontFamily,
    fontSize: 12,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 8,
  },
  input: {
    fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FAFBFD",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 11,
    fontSize: 14,
    color: colors.ink,
    minHeight: 46,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
  },
  chip: {
    maxWidth: "100%",
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipText: {
    flexShrink: 1,
    fontFamily,
    fontSize: 12,
    color: colors.muted,
    fontWeight: "600",
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonText: { fontFamily, fontSize: 12, fontWeight: "600", color: "white" },
  error: { fontFamily, color: colors.danger, fontSize: 13, lineHeight: 21 },
  badge: {
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgeText: { fontFamily, fontSize: 10, lineHeight: 16, fontWeight: "600" },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
});

export function Button({
  title,
  onPress,
  muted = false,
  disabled = false,
  icon,
  loading = false,
  style,
  compact = false,
  tone,
}) {
  const danger = tone === "danger";
  const foreground = muted
    ? danger
      ? colors.danger
      : colors.ink
    : colors.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.button,
        muted && { backgroundColor: colors.white, borderColor: colors.border },
        danger &&
          !muted && {
            backgroundColor: colors.danger,
            borderColor: colors.danger,
          },
        compact && { minHeight: 36, paddingVertical: 8, paddingHorizontal: 12 },
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        hovered &&
          !disabled && {
            backgroundColor: muted
              ? "#F7F8FC"
              : danger
                ? colors.danger
                : colors.primaryDark,
          },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={foreground} />
      ) : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{title}</Text>
    </Pressable>
  );
}
export function IconButton({ icon, onPress, label, style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label || icon}
      style={({ pressed, hovered }) => [
        {
          width: 38,
          height: 38,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: hovered ? colors.primarySoft : colors.white,
          opacity: pressed ? 0.65 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.muted} />
    </Pressable>
  );
}
export function Badge({ children, tone, style }) {
  const text = typeof children === "string" ? children.toLowerCase() : "";
  const inferred = /failed|lost|inactive|overdue|not interested/.test(text)
    ? "danger"
    : /completed|answered|converted|available|online|connected/.test(text)
      ? "success"
      : /pending|awaiting|unconfirmed|busy|follow-up/.test(text)
        ? "warning"
        : "primary";
  const palette = tones[tone] || tones[inferred];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: palette.ink,
        }}
      />
      <Text style={[styles.badgeText, { color: palette.ink }]}>{children}</Text>
    </View>
  );
}
export function Body({ children, style, ...props }) {
  return (
    <Text style={[styles.body, style]} {...props}>
      {children}
    </Text>
  );
}
export function Title({ children, style }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}
export function Avatar({ name = "", size = 42, style }) {
  const text = String(name || "?");
  const initials = text
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const palettes = [
    tones.primary,
    tones.success,
    tones.warning,
    { ink: "#9661C6", bg: "#F4EDFB" },
  ];
  const palette =
    palettes[
      [...text].reduce((total, char) => total + char.charCodeAt(0), 0) %
        palettes.length
    ];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.bg,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily,
          color: palette.ink,
          fontWeight: "700",
          fontSize: size * 0.32,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 18,
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 3,
      }}
    >
      <View style={{ flex: 1, minWidth: 220, gap: 5 }}>
        {!!eyebrow && (
          <Text
            style={{
              fontFamily,
              color: colors.primary,
              fontSize: 10,
              fontWeight: "700",
              letterSpacing: 1.8,
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {eyebrow}
          </Text>
        )}
        <Title>{title}</Title>
        {!!subtitle && <Body>{subtitle}</Body>}
      </View>
      {!!actions && <View style={[styles.row, { gap: 10 }]}>{actions}</View>}
    </View>
  );
}
export function SectionHeader({ title, subtitle, action }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={{
            fontFamily,
            fontSize: 16,
            fontWeight: "700",
            color: colors.ink,
          }}
        >
          {title}
        </Text>
        {!!subtitle && <Body>{subtitle}</Body>}
      </View>
      {action}
    </View>
  );
}
function gridChildren(children) {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement(child) && child.type === React.Fragment
      ? gridChildren(child.props.children)
      : [child],
  );
}
export function Grid({ children, minWidth = 280, gap = 18, style }) {
  const [width, setWidth] = useState(0);
  const cells = gridChildren(children);
  const columns = Math.max(
    1,
    Math.min(cells.length, Math.floor((width + gap) / (minWidth + gap))),
  );
  return (
    <View
      onLayout={(event) => {
        const next = Math.floor(event.nativeEvent.layout.width);
        if (next !== width) setWidth(next);
      }}
      style={[
        { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap },
        style,
      ]}
    >
      {cells.map((child, index) => (
        <View
          key={String(child.key || "cell") + "-" + index}
          style={{
            width:
              columns === 1 ? "100%" : (width - (columns - 1) * gap) / columns,
            minWidth: 0,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function MetricCard({
  label,
  value,
  icon = "stats-chart-outline",
  tone = "primary",
  detail,
  style,
}) {
  const palette = tones[tone] || tones.primary;
  return (
    <View
      style={[
        {
          padding: 21,
          borderRadius: 17,
          backgroundColor: colors.white,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 17,
          height: CardPlatform.OS === "web" ? "100%" : undefined,
          ...shadows.card,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Text
          style={{
            fontFamily,
            color: colors.muted,
            fontSize: 12,
            fontWeight: "500",
            flex: 1,
          }}
        >
          {label}
        </Text>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: palette.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={17} color={palette.ink} />
        </View>
      </View>
      <Text
        style={{
          fontFamily,
          fontSize: 32,
          fontWeight: "700",
          letterSpacing: -1.2,
          color: colors.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value ?? "—"}
      </Text>
      {!!detail && (
        <Body style={{ fontSize: 11, lineHeight: 17 }}>{detail}</Body>
      )}
    </View>
  );
}
export function InfoRow({ label, value, icon, children }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 9,
        paddingVertical: 4,
      }}
    >
      {!!icon && (
        <Ionicons
          name={icon}
          size={15}
          color={colors.muted}
          style={{ marginTop: 2 }}
        />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        {!!label && (
          <Text
            style={{
              fontFamily,
              fontSize: 10,
              fontWeight: "500",
              color: colors.muted,
            }}
          >
            {label}
          </Text>
        )}
        {children || (
          <Text
            style={{
              fontFamily,
              fontSize: 13,
              lineHeight: 21,
              color: value == null || value === "" ? colors.muted : colors.ink,
            }}
          >
            {value == null || value === "" ? "Not provided" : value}
          </Text>
        )}
      </View>
    </View>
  );
}
export function Notice({ title, children, tone = "info", icon }) {
  const palette = tones[tone] || tones.info;
  return (
    <View
      style={{
        backgroundColor: palette.bg,
        padding: 16,
        borderRadius: 12,
        flexDirection: "row",
        gap: 11,
        alignItems: "flex-start",
      }}
    >
      <Ionicons
        name={
          icon ||
          (tone === "warning"
            ? "information-circle-outline"
            : "shield-checkmark-outline")
        }
        size={18}
        color={palette.ink}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: 4 }}>
        {!!title && (
          <Text
            style={{
              fontFamily,
              fontSize: 12,
              lineHeight: 19,
              fontWeight: "600",
              color: palette.ink,
            }}
          >
            {title}
          </Text>
        )}
        {typeof children === "string" || typeof children === "number" ? (
          <Body style={{ fontSize: 12, lineHeight: 19, color: palette.ink }}>
            {children}
          </Body>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
export function EmptyState({
  icon = "file-tray-outline",
  title = "Nothing here just yet",
  description = "Your records will appear here as your workspace grows.",
  action,
}) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 42,
        paddingHorizontal: 22,
        gap: 11,
        backgroundColor: colors.white,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 20,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 5,
        }}
      >
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <Text
        style={{
          fontFamily,
          fontSize: 16,
          color: colors.ink,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Body
        style={{
          textAlign: "center",
          maxWidth: 370,
          marginBottom: action ? 8 : 0,
        }}
      >
        {description}
      </Body>
      {action}
    </View>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  secure = false,
  multiline = false,
  keyboardType = "default",
  placeholder,
  error,
  hint,
  icon,
  style,
  ...props
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 0 }, style]}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={{ position: "relative" }}>
        {!!icon && (
          <Ionicons
            name={icon}
            size={17}
            color={colors.muted}
            style={{ position: "absolute", left: 14, top: 14, zIndex: 1 }}
          />
        )}
        <TextInput
          accessibilityLabel={label}
          style={[
            styles.input,
            icon && { paddingLeft: 40 },
            multiline && { minHeight: 110, textAlignVertical: "top" },
            focused && {
              backgroundColor: colors.white,
              borderColor: colors.primary,
              ...(Platform.OS === "web"
                ? { boxShadow: "0 0 0 3px rgba(79,70,229,0.08)" }
                : {}),
            },
            error && { borderColor: colors.danger },
          ]}
          value={String(value ?? "")}
          onChangeText={onChangeText}
          placeholder={
            placeholder || (label ? "Enter " + label.toLowerCase() : "")
          }
          placeholderTextColor="#A1A9BA"
          secureTextEntry={secure}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={
            secure || keyboardType === "email-address" ? "none" : "sentences"
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
      </View>
      {error ? (
        <Text style={[styles.error, { fontSize: 11, marginTop: 6 }]}>
          {error}
        </Text>
      ) : hint ? (
        <Body style={{ fontSize: 11, marginTop: 6 }}>{hint}</Body>
      ) : null}
    </View>
  );
}
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search records...",
}) {
  return (
    <Field
      accessibilityLabel={placeholder}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      icon="search-outline"
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}
export function Select({ label, value, options = [], onChange }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const theme = useTheme();
  const items = options.map((option) =>
    typeof option === "string" ? { label: option, value: option } : option,
  );
  const chosen = items.find((item) => item.value === value);
  if (items.length > 4) {
    if (Platform.OS === "web")
      return (
        <View style={{ gap: 8 }}>
          {!!label && <Text style={styles.label}>{label}</Text>}
          {React.createElement(
            "select",
            {
              "aria-label": label || "Select option",
              value: value == null ? "" : String(value),
              onChange: (event) => {
                const item = items.find(
                  (item) => String(item.value) === event.target.value,
                );
                if (item) onChange(item.value);
              },
              style: {
                width: "100%",
                minHeight: 46,
                padding: "11px 34px 11px 13px",
                fontFamily: "InterRegular, sans-serif",
                fontSize: 13,
                color: theme.colors.ink,
                backgroundColor: theme.colors.surface,
                border: "1px solid " + theme.colors.border,
                borderRadius: 10,
                outline: "none",
              },
            },
            ...(!items.some((item) => item.value === "")
              ? [
                  React.createElement(
                    "option",
                    { key: "__empty", value: "", disabled: true },
                    "Select?",
                  ),
                ]
              : []),
            ...items.map((item) =>
              React.createElement(
                "option",
                { key: String(item.value), value: String(item.value) },
                item.label,
              ),
            ),
          )}
        </View>
      );
    const filtered = items.filter((item) =>
      String(item.label).toLowerCase().includes(query.toLowerCase()),
    );
    return (
      <View style={{ gap: 8 }}>
        {!!label && <Text style={styles.label}>{label}</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            (label || "Select option") + ": " + (chosen?.label || "Choose")
          }
          onPress={() => {
            setQuery("");
            setOpen(true);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 46,
            padding: 13,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            backgroundColor: colors.white,
            gap: 10,
          }}
        >
          <Text
            style={{
              flex: 1,
              fontSize: 13,
              color: chosen ? colors.ink : colors.muted,
            }}
          >
            {chosen?.label || "Select?"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} />
        </Pressable>
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <Pressable
            onPress={() => setOpen(false)}
            style={{
              flex: 1,
              backgroundColor: "rgba(12,20,36,0.4)",
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <Pressable
              onPress={() => {}}
              style={{
                width: "100%",
                maxWidth: 440,
                maxHeight: "80%",
                backgroundColor: colors.white,
                borderRadius: 16,
                padding: 18,
                gap: 14,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: "600",
                    color: colors.ink,
                  }}
                >
                  {label || "Select option"}
                </Text>
                <IconButton
                  icon="close"
                  label="Close options"
                  onPress={() => setOpen(false)}
                />
              </View>
              {!!(items.length > 8) && (
                <SearchField
                  placeholder="Search options"
                  value={query}
                  onChangeText={setQuery}
                />
              )}
              <ScrollView keyboardShouldPersistTaps="handled">
                {filtered.map((item) => (
                  <Pressable
                    key={String(item.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={String(item.label)}
                    accessibilityState={{ checked: value === item.value }}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={{
                      paddingVertical: 15,
                      paddingHorizontal: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      borderBottomWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 14,
                        color:
                          value === item.value ? colors.primary : colors.ink,
                      }}
                    >
                      {item.label}
                    </Text>
                    {!!(value === item.value) && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={colors.primary}
                      />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 4,
          backgroundColor: "#F2F3F8",
          padding: 4,
          borderRadius: 10,
          alignSelf: "flex-start",
          maxWidth: "100%",
        }}
      >
        {items.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: value === item.value }}
            key={String(item.value)}
            onPress={() => onChange(item.value)}
            style={({ hovered }) => [
              styles.chip,
              { minHeight: 38, justifyContent: "center" },
              value === item.value
                ? { backgroundColor: colors.white, borderColor: colors.border }
                : hovered && { backgroundColor: "#E9EBF4" },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                value === item.value && { color: colors.primary },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function State({ resource, empty = false }) {
  if (resource.loading)
    return (
      <View
        style={{
          padding: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <ActivityIndicator color={colors.primary} size="small" />
        <Body>Loading?</Body>
      </View>
    );
  if (resource.error)
    return (
      <Notice tone="danger" title="Unable to load">
        <Text
          accessibilityRole="alert"
          style={[styles.error, { marginBottom: 12 }]}
        >
          {resource.error}
        </Text>
        <Button
          title="Try again"
          icon="refresh-outline"
          muted
          compact
          onPress={resource.refresh}
        />
      </Notice>
    );
  if (empty)
    return (
      <EmptyState
        title="No matching records"
        description="Try adjusting your search or filters to see more results."
      />
    );
  return null;
}
export function Pager({ page, setPage, data }) {
  if (!data?.total) return null;
  return (
    <View
      style={[
        styles.row,
        { justifyContent: "space-between", paddingVertical: 7 },
      ]}
    >
      <Body style={{ fontSize: 12 }}>
        {data.total} {data.total === 1 ? "record" : "records"} · Page {page}
      </Body>
      <View style={styles.row}>
        <Button
          title="Previous"
          icon="chevron-back-outline"
          compact
          disabled={page <= 1}
          muted
          onPress={() => setPage(page - 1)}
        />
        <Button
          title="Next"
          compact
          muted
          disabled={!data?.hasMore}
          onPress={() => setPage(page + 1)}
        />
      </View>
    </View>
  );
}
export function Form({
  fields,
  initial = {},
  onSubmit,
  submitLabel = "Save changes",
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 20 }}>
      {fields.map((field) => (
        <View key={field.key}>
          {field.options ? (
            <Select
              label={field.label}
              value={values[field.key]}
              options={field.options}
              onChange={(value) => setValues({ ...values, [field.key]: value })}
            />
          ) : field.boolean ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 10,
                gap: 20,
              }}
            >
              <Text style={[styles.label, { marginBottom: 0, flex: 1 }]}>
                {field.label}
              </Text>
              <Switch
                accessibilityLabel={field.label}
                trackColor={{ false: "#DEE2ED", true: "#B5AFFB" }}
                thumbColor={values[field.key] ? colors.primary : colors.white}
                value={Boolean(values[field.key])}
                onValueChange={(value) =>
                  setValues({ ...values, [field.key]: value })
                }
              />
            </View>
          ) : (
            <Field
              {...field}
              value={values[field.key]}
              onChangeText={(value) =>
                setValues({ ...values, [field.key]: value })
              }
            />
          )}
        </View>
      ))}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View
        style={{
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingTop: 18,
          flexDirection: "row",
          justifyContent: "flex-end",
        }}
      >
        <Button
          title={busy ? "Saving..." : submitLabel}
          icon="checkmark-outline"
          loading={busy}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError("");
            try {
              await onSubmit(values);
            } catch (event) {
              setError(event.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    </View>
  );
}
export async function action(task, onDone) {
  try {
    await task();
    onDone?.();
  } catch (error) {
    if (Platform.OS === "web" && typeof window !== "undefined")
      window.alert(error.message);
    else Alert.alert("Unable to complete", error.message);
  }
}
export function confirm(title, task, onDone) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    if (window.confirm(title + "\nPlease confirm this change."))
      void action(task, onDone);
    return;
  }
  Alert.alert(title, "Please confirm this change.", [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", onPress: () => action(task, onDone) },
  ]);
}
export function duration(seconds) {
  const number = Math.max(0, Math.floor(seconds || 0));
  return (
    String(Math.floor(number / 60)).padStart(2, "0") +
    ":" +
    String(number % 60).padStart(2, "0")
  );
}
export function CallTimer({ call, serverTime }) {
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (serverTime) setOffset(+new Date(serverTime) - Date.now());
  }, [serverTime]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds =
    call?.active && call?.answeredAt
      ? (now + offset - new Date(call.answeredAt)) / 1000
      : call?.talkSeconds || 0;
  return (
    <Text
      style={{
        fontFamily,
        fontSize: 36,
        fontWeight: "700",
        color: colors.ink,
        fontVariant: ["tabular-nums"],
        letterSpacing: -1,
      }}
    >
      {duration(seconds)}
    </Text>
  );
}
export function Bars({ values }) {
  const entries = Object.entries(values || {});
  const max = Math.max(1, ...entries.map(([, value]) => Number(value) || 0));
  const palette = [
    colors.primary,
    colors.success,
    "#8C74E8",
    "#EAB363",
    "#65A4DC",
  ];
  return (
    <View style={{ gap: 17 }}>
      {entries.length ? (
        entries.map(([label, value], index) => (
          <View key={label} style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <Body style={{ fontSize: 12 }}>{label}</Body>
              <Text
                style={{
                  fontFamily,
                  fontSize: 12,
                  fontWeight: "600",
                  color: colors.ink,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {value}
              </Text>
            </View>
            <View
              style={{
                height: 7,
                backgroundColor: "#F0F2F8",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 7,
                  width: Math.max(0, ((Number(value) || 0) / max) * 100) + "%",
                  borderRadius: 4,
                  backgroundColor: palette[index % palette.length],
                }}
              />
            </View>
          </View>
        ))
      ) : (
        <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
          <Ionicons name="bar-chart-outline" size={28} color="#B5BED0" />
          <Body>No activity in this period.</Body>
        </View>
      )}
    </View>
  );
}
