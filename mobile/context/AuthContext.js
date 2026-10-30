import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sessionStore } from "../services/sessionStore";

import { AppState } from "react-native";
import { io } from "socket.io-client";
import { api, setSession, getApiBase } from "../services/api";
import { cacheProfile, cachedSession } from "../services/localStore";
import { assertAppRole } from "../services/telecom";

const Auth = createContext(null);
const KEY = "calltrack-token";

function isToken(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value !== "undefined" &&
    value !== "null"
  );
}

// Older builds saved JSON.stringify(token), resulting in quoted tokens.
function normalizeToken(value) {
  if (!isToken(value)) return null;
  let token = value.trim();
  if (token.startsWith('"') && token.endsWith('"')) {
    try {
      token = JSON.parse(token);
    } catch {
      return null;
    }
  }
  return isToken(token) ? token.trim() : null;
}

function getErrorMessage(error) {
  const responseMessage = error?.response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  const responseError = error?.response?.data?.error;
  if (typeof responseError === "string") return responseError;
  return error?.message || "Request failed.";
}

function getTokenFromLogin(data) {
  const token =
    data?.token ??
    data?.accessToken ??
    data?.access_token ??
    data?.data?.token ??
    data?.data?.accessToken ??
    data?.data?.access_token;

  if (!isToken(token)) {
    throw new Error(
      "Login succeeded but the API returned no string token. Check /auth/login response.",
    );
  }
  return token.trim();
}

function getSessionFromResponse(data) {
  if (
    !data?.user ||
    typeof data.user !== "object" ||
    Array.isArray(data.user)
  ) {
    throw new Error("/auth/me did not return a valid user object.");
  }
  return data;
}
// Authentication, CRM screens and Socket.IO share the same API address.
async function authRequest(path, { method = "GET", body, token } = {}) {
  const response = await api.request({
    url: path,
    method,
    data: body,
    ...(isToken(token)
      ? { headers: { Authorization: "Bearer " + token } }
      : {}),
  });
  return response.data;
}

function updateOtherApiClients(token, onExpired) {
  setSession(token, onExpired);
}
export function AuthProvider({ children }) {
  const [session, update] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const saved = useRef(null);
  const socket = useRef(null);
  const version = useRef(0);

  const bump = useCallback(() => setRevision((n) => n + 1), []);

  const clear = useCallback(async () => {
    version.current += 1;
    saved.current = null;
    updateOtherApiClients(null);
    update(null);
    setError("");
    setConnected(false);
    if (socket.current) {
      socket.current.disconnect();
      socket.current = null;
    }
    await sessionStore.deleteItemAsync(KEY);
  }, []);

  const establish = useCallback(
    async (rawToken) => {
      const token = normalizeToken(rawToken);
      if (!token) throw new Error("Missing or invalid authentication token.");

      const myVersion = ++version.current;
      saved.current = token;
      updateOtherApiClients(token, () => {
        if (saved.current === token) {
          void clear().catch((e) =>
            console.warn("Session cleanup:", getErrorMessage(e)),
          );
        }
      });

      try {
        const data = await authRequest("/auth/me", { token });
        if (myVersion !== version.current) return null;
        const profile = getSessionFromResponse(data);
        assertAppRole(profile.user);
        try {
          await cacheProfile(String(profile.user._id), profile);
        } catch {}
        if (myVersion !== version.current) return null;
        update({ ...profile, token, offline: false });
        setError("");
        return profile;
      } catch (e) {
        if (myVersion !== version.current) return null;
        if (myVersion === version.current) {
          saved.current = null;
          updateOtherApiClients(null);
          update(null);
        }
        throw e;
      }
    },
    [clear],
  );

  const restore = useCallback(async () => {
    setLoading(true);
    setError("");
    const startingVersion = version.current;
    let cachedToken = null;
    try {
      const raw = await sessionStore.getItemAsync(KEY);
      if (startingVersion !== version.current) return;

      const token = normalizeToken(raw);
      cachedToken = token;
      if (!token) {
        if (raw !== null) await sessionStore.deleteItemAsync(KEY);
        updateOtherApiClients(null);
        update(null);
        return;
      }
      if (token !== raw) await sessionStore.setItemAsync(KEY, token);
      await establish(token);
    } catch (e) {
      if (!e?.response && cachedToken) {
        try {
          const profile = await cachedSession(cachedToken);
          if (version.current !== startingVersion + 1) return;
          if (profile) {
            assertAppRole(profile.user);
            saved.current = cachedToken;
            updateOtherApiClients(cachedToken, () => {
              void clear();
            });
            update({ ...profile, token: cachedToken, offline: true });
            setError("");
            return;
          }
        } catch (storageError) {
          setError(storageError.message);
          return;
        }
      }
      setError(getErrorMessage(e));
      if (e?.response?.status === 401) {
        try {
          await clear();
        } catch (cleanupError) {
          console.warn("Session cleanup:", getErrorMessage(cleanupError));
        }
        setError("Session expired. Please log in again.");
      }
    } finally {
      setLoading(false);
    }
  }, [clear, establish]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const login = useCallback(
    async (email, password) => {
      setError("");
      version.current += 1; // Invalidate a concurrently running session restore.
      try {
        const data = await authRequest("/auth/login", {
          method: "POST",
          body: { email, password },
        });
        const token = getTokenFromLogin(data);
        const user = await establish(token);
        if (!user) return false;
        await sessionStore.setItemAsync(KEY, token); // Always a string.
        return true;
      } catch (e) {
        try {
          await clear();
        } catch (cleanupError) {
          console.warn("Login cleanup:", getErrorMessage(cleanupError));
        }
        setError(getErrorMessage(e));
        throw e;
      }
    },
    [clear, establish],
  );

  const logout = useCallback(async () => {
    try {
      if (saved.current) {
        await authRequest("/auth/logout", {
          method: "POST",
          token: saved.current,
        });
      }
    } catch (e) {
      console.warn("Server logout:", getErrorMessage(e));
    } finally {
      await clear();
    }
  }, [clear]);

  const refreshSession = useCallback(async () => {
    if (!saved.current) return null;
    try {
      return await establish(saved.current);
    } catch (e) {
      if (e?.response?.status === 401) await clear();
      else setError(getErrorMessage(e));
      throw e;
    }
  }, [clear, establish]);

  useEffect(() => {
    if (!isToken(session?.token)) {
      setConnected(false);
      return;
    }

    let base;
    try {
      base = getApiBase().replace(/\/api$/, "");
    } catch (e) {
      console.warn("Socket setup:", getErrorMessage(e));
      return;
    }

    const client = io(base, {
      auth: { token: session.token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: false,
    });
    socket.current = client;

    client.on("connect", () => {
      setConnected(true);
      bump();
    });
    client.on("disconnect", () => setConnected(false));
    client.on("connect_error", (e) => {
      setConnected(false);
      console.warn("Live connection:", getErrorMessage(e));
    });
    client.on("changed", bump);
    client.on("session:expired", () => {
      if (saved.current === session.token) {
        void clear().catch((e) =>
          console.warn("Session expired:", getErrorMessage(e)),
        );
      }
    });

    const appListener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (!client.connected) client.connect();
        bump();
      }
    });
    const timer = setInterval(bump, 30000);
    client.connect();

    return () => {
      clearInterval(timer);
      appListener.remove();
      client.removeAllListeners();
      client.disconnect();
      if (socket.current === client) socket.current = null;
    };
  }, [session?.token, clear, bump]);

  // Refresh company permissions on live changes, focus and periodic refresh.
  // Keep the current token and reject replies from a previous account.
  useEffect(() => {
    const token = session?.token;
    if (!token) return;
    let canceled = false;
    api
      .get("/settings", { headers: { Authorization: "Bearer " + token } })
      .then(({ data }) => {
        if (canceled || saved.current !== token) return;
        update((current) =>
          current?.token === token ? { ...current, settings: data } : current,
        );
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [session?.token, revision]);

  const value = useMemo(
    () => ({
      ...(session || {}),
      loading,
      error,
      revision,
      connected,
      login,
      logout,
      clear,
      restore,
      refreshSession,
      bump,
    }),
    [
      session,
      loading,
      error,
      revision,
      connected,
      login,
      logout,
      clear,
      restore,
      refreshSession,
      bump,
    ],
  );

  return <Auth.Provider value={value}>{children}</Auth.Provider>;
}

export function useAuth() {
  const context = useContext(Auth);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
