import axios from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

export function getApiBase() {
  let base = (process.env.EXPO_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (!base) {
    if (!__DEV__) {
      throw new Error(
        "Set EXPO_PUBLIC_API_URL in mobile/.env before building.",
      );
    }
    const hostUri =
      Constants.expoConfig?.hostUri ||
      Constants.expoGoConfig?.debuggerHost ||
      Constants.manifest2?.extra?.expoGo?.debuggerHost ||
      "";
    const host =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.hostname
        : hostUri.split(":")[0] ||
          (Platform.OS === "android" ? "10.0.2.2" : "localhost");
    base =
      "http://" + host + ":" + (process.env.EXPO_PUBLIC_API_PORT || "4000");
  }
  return /\/api$/.test(base) ? base : base + "/api";
}

export const api = axios.create({
  baseURL: getApiBase(),
  timeout: 15000,
  headers: { Accept: "application/json" },
});

let expire = () => {};
export function setSession(token, onExpire) {
  if (token) api.defaults.headers.common.Authorization = "Bearer " + token;
  else delete api.defaults.headers.common.Authorization;
  expire = onExpire || (() => {});
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes("/auth/login") &&
      error.config?.headers?.Authorization ===
        api.defaults.headers.common.Authorization
    ) {
      expire();
    }
    error.message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      (!error.response
        ? "Cannot reach CallTrack API" +
          (__DEV__ ? " at " + api.defaults.baseURL : "") +
          ". Check the server, API URL and allowed browser origin."
        : error.message);
    return Promise.reject(error);
  },
);

export async function getHealth(signal) {
  return (await api.get("/health", { signal })).data;
}
