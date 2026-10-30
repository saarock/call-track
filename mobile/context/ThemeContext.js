import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { lightColors, darkColors } from "../utils/theme";

const ThemeContext = createContext(null);
const KEY = "calltrack-appearance";
const validMode = (mode) => ["light", "dark", "system"].includes(mode);
function initialMode() {
  if (Platform.OS !== "web" || typeof window === "undefined") return "system";
  try {
    const saved = window.localStorage.getItem(KEY);
    return validMode(saved) ? saved : "system";
  } catch {
    return "system";
  }
}
export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [mode, updateMode] = useState(initialMode);
  const [ready, setReady] = useState(Platform.OS === "web");
  const changed = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    SecureStore.getItemAsync(KEY)
      .then((saved) => {
        if (active && !changed.current && validMode(saved)) updateMode(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const scheme =
    mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
  useEffect(() => {
    if (!ready) return;
    try {
      if (Platform.OS === "web") window.localStorage.setItem(KEY, mode);
      else void SecureStore.setItemAsync(KEY, mode).catch(() => {});
    } catch {}
  }, [mode, ready]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.dataset.theme = scheme;
    document.documentElement.style.backgroundColor =
      scheme === "dark" ? darkColors.background : lightColors.background;
  }, [scheme]);
  const value = useMemo(
    () => ({
      mode,
      scheme,
      isDark: scheme === "dark",
      colors: scheme === "dark" ? darkColors : lightColors,
      setMode(next) {
        if (validMode(next)) {
          changed.current = true;
          updateMode(next);
        }
      },
      toggle() {
        changed.current = true;
        updateMode(scheme === "dark" ? "light" : "dark");
      },
    }),
    [mode, scheme],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside ThemeProvider");
  return theme;
}
