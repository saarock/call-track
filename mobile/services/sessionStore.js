import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// SecureStore is native-only. Browser sessions stay in the current tab.
export const sessionStore = {
  async getItemAsync(key) {
    return Platform.OS === "web"
      ? window.sessionStorage.getItem(key)
      : SecureStore.getItemAsync(key);
  },
  async setItemAsync(key, value) {
    if (Platform.OS === "web") window.sessionStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async deleteItemAsync(key) {
    if (Platform.OS === "web") window.sessionStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
