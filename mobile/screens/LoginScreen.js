import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Ionicons,
} from "../components/Themed";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import ThemeToggle from "../components/ThemeToggle";
import { Button } from "../components/UI";
export default function LoginScreen() {
  const auth = useAuth(),
    { colors } = useTheme(),
    passwordRef = useRef(null);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit() {
    if (busy) return;
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await auth.login(email.trim(), password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const input = {
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ alignItems: "flex-end", padding: 20 }}>
        <ThemeToggle />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
          paddingBottom: 100,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 390,
            alignSelf: "center",
            backgroundColor: colors.surface,
            padding: 28,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            gap: 26,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 42,
                height: 42,
                backgroundColor: "#147D70",
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="call" size={22} color="#FFFFFF" />
            </View>
            <Text
              style={{
                fontSize: 23,
                fontWeight: "700",
                letterSpacing: -0.7,
                color: colors.ink,
              }}
            >
              CallTrack CRM
            </Text>
          </View>
          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Text
                style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}
              >
                Email
              </Text>
              <TextInput
                accessibilityLabel="Work email"
                placeholder="you@company.com"
                placeholderTextColor={colors.muted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                style={input}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text
                style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}
              >
                Password
              </Text>
              <View style={{ position: "relative" }}>
                <TextInput
                  ref={passwordRef}
                  accessibilityLabel="Password"
                  placeholder="Password"
                  placeholderTextColor={colors.muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!visible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  style={[input, { paddingRight: 48 }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    visible ? "Hide password" : "Show password"
                  }
                  onPress={() => setVisible(!visible)}
                  style={{
                    position: "absolute",
                    right: 2,
                    top: 2,
                    width: 44,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={visible ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            </View>
            {!!(error || auth.error) && (
              <Text
                accessibilityRole="alert"
                style={{ fontSize: 13, lineHeight: 20, color: colors.danger }}
              >
                {error || auth.error}
              </Text>
            )}
            <Button
              title="Sign in"
              loading={busy}
              onPress={submit}
              style={{ minHeight: 48, marginTop: 4 }}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
