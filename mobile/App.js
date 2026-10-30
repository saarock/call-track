import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import * as SystemUI from "expo-system-ui";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { View, ActivityIndicator } from "./components/Themed";
import RootNavigator from "./navigation/RootNavigator";
import { PowerDialerProvider } from "./context/PowerDialerContext";
import { RecordingProvider } from "./context/RecordingContext";
import { DialerProvider } from "./context/DialerContext";
function Application() {
  const { isDark, colors } = useTheme();
  const [loaded, error] = useFonts({
    InterRegular: Inter_400Regular,
    InterMedium: Inter_500Medium,
    InterSemiBold: Inter_600SemiBold,
    InterBold: Inter_700Bold,
    InterExtraBold: Inter_800ExtraBold,
  });
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  return (
    <AuthProvider>
      <DialerProvider>
        <StatusBar style={isDark ? "light" : "dark"} />
        <PowerDialerProvider>
          <RecordingProvider>
            <RootNavigator />
          </RecordingProvider>
        </PowerDialerProvider>
      </DialerProvider>
    </AuthProvider>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Application />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
