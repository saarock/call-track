import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform, AppState } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../services/api";
import { readOwnerStore, updateOwnerStore } from "../services/localStore";
import { newOperationId } from "../services/telecom";
import { useAuth } from "./AuthContext";
const Context = createContext(null);
let database;
function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined")
        return reject(new Error("Browser file storage is unavailable."));
      const request = indexedDB.open("calltrack-private-audio", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Browser file storage could not be opened."));
    });
  return database;
}
async function binary(action, key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "files",
        action === "get" ? "readonly" : "readwrite",
      ),
      store = tx.objectStore("files");
    const req =
      action === "put"
        ? store.put(value, key)
        : action === "delete"
          ? store.delete(key)
          : store.get(key);
    let result;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(
        new Error(
          "Private audio storage failed. Keep your original recording.",
        ),
      );
  });
}
async function removeFile(owner, item) {
  if (Platform.OS === "web")
    await binary("delete", owner + ":" + item.uploadId);
  else if (item.localUri?.startsWith(FileSystem.documentDirectory))
    await FileSystem.deleteAsync(item.localUri, { idempotent: true });
}
export function RecordingProvider({ children }) {
  const auth = useAuth(),
    uid = auth.user?._id || null;
  const [items, setItems] = useState([]),
    [uploading, setUploading] = useState(null),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const current = useRef(uid),
    worker = useRef(null),
    sync = useRef(null),
    again = useRef(false);
  current.current = uid;
  const publish = useCallback((owner, value) => {
    if (current.current === owner) setItems(value.uploads || []);
    return value;
  }, []);
  const run = useCallback(() => {
    if (!uid || !auth.token) return Promise.resolve();
    if (worker.current) {
      again.current = true;
      return worker.current;
    }
    const owner = uid,
      token = auth.token;
    const job = (async () => {
      try {
        const store = await readOwnerStore(owner);
        for (const item of store.uploads || []) {
          if (current.current !== owner || item.attention) continue;
          setUploading(item.uploadId);
          setProgress(0);
          try {
            const params = new URLSearchParams({
              callId: item.callId,
              uploadId: item.uploadId,
              consent: "confirmed",
              name: item.name,
            });
            const url = "/recordings/attachments?" + params;
            let response;
            if (Platform.OS === "web") {
              const blob = await binary("get", owner + ":" + item.uploadId);
              if (!blob)
                throw new Error(
                  "The saved audio file is unavailable. Keep or choose the original file.",
                );
              if (current.current !== owner) return;
              response = (
                await api.post(url, blob, {
                  headers: {
                    Authorization: "Bearer " + token,
                    "Content-Type": "application/octet-stream",
                  },
                  timeout: 120000,
                  onUploadProgress: (event) => {
                    if (current.current === owner && event.total)
                      setProgress(event.loaded / event.total);
                  },
                })
              ).data;
            } else {
              const info = await FileSystem.getInfoAsync(item.localUri);
              if (!info.exists)
                throw new Error(
                  "The saved audio file is unavailable. Keep or choose the original file.",
                );
              if (current.current !== owner) return;
              const task = FileSystem.createUploadTask(
                api.defaults.baseURL + url,
                item.localUri,
                {
                  httpMethod: "POST",
                  uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
                  headers: {
                    Authorization: "Bearer " + token,
                    "Content-Type": "application/octet-stream",
                  },
                },
                (event) => {
                  if (
                    current.current === owner &&
                    event.totalBytesExpectedToSend
                  )
                    setProgress(
                      event.totalBytesSent / event.totalBytesExpectedToSend,
                    );
                },
              );
              const result = await task.uploadAsync();
              if (!result)
                throw new Error(
                  "Upload interrupted. The private device copy is kept for retry.",
                );
              try {
                response = JSON.parse(result.body);
              } catch {
                throw new Error(
                  "The upload server did not return a valid response. Retry later.",
                );
              }
              if (result.status < 200 || result.status >= 300) {
                const problem = new Error(
                  response.message || "Audio upload failed.",
                );
                problem.response = { status: result.status };
                throw problem;
              }
            }
            if (!response?._id || response.status !== "available")
              throw new Error(
                "The server did not confirm that the recording was stored.",
              );
            const next = await updateOwnerStore(owner, (value) => ({
              ...value,
              uploads: (value.uploads || []).filter(
                (row) => row.uploadId !== item.uploadId,
              ),
            }));
            publish(owner, next);
            await removeFile(owner, item).catch(() => {});
            if (current.current === owner) {
              setError("");
              auth.bump();
            }
          } catch (e) {
            const status = e.response?.status;
            const next = await updateOwnerStore(owner, (value) => ({
              ...value,
              uploads: (value.uploads || []).map((row) =>
                row.uploadId === item.uploadId
                  ? {
                      ...row,
                      error: e.message,
                      attempts: (row.attempts || 0) + 1,
                      attention: Boolean(
                        status &&
                        status >= 400 &&
                        status < 500 &&
                        ![401, 409, 429].includes(status),
                      ),
                    }
                  : row,
              ),
            }));
            publish(owner, next);
            if (current.current === owner) setError(e.message);
            if (!status || status >= 500 || status === 401 || status === 429)
              break;
          } finally {
            if (current.current === owner) setUploading(null);
          }
        }
      } catch (e) {
        if (current.current === owner) setError(e.message);
      }
    })();
    worker.current = job;
    job.finally(() => {
      worker.current = null;
      if (again.current) {
        again.current = false;
        setTimeout(() => void sync.current?.(), 500);
      }
    });
    return job;
  }, [uid, auth.token, publish, auth.bump]);
  sync.current = run;
  useEffect(() => {
    let alive = true;
    setItems([]);
    setError("");
    setUploading(null);
    if (uid)
      readOwnerStore(uid)
        .then((value) => {
          if (alive) publish(uid, value);
        })
        .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [uid, publish]);
  useEffect(() => {
    if (!uid) return;
    void run();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    const timer = setInterval(() => void run(), 30000);
    const online = () => void run();
    if (Platform.OS === "web") window.addEventListener("online", online);
    return () => {
      listener.remove();
      clearInterval(timer);
      if (Platform.OS === "web") window.removeEventListener("online", online);
    };
  }, [uid, run]);
  async function stage(callId, asset, consent) {
    const owner = uid;
    if (!owner || !auth.token) throw new Error("Sign in first.");
    if (!consent)
      throw new Error("Confirm recording authorization and consent first.");
    const uploadId = newOperationId(),
      item = {
        uploadId,
        callId,
        name: asset.name || "Recording",
        consentAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        attempts: 0,
        error: null,
        attention: false,
      };
    if ((asset.size || 0) > 20 * 1024 * 1024)
      throw new Error("Choose a recording under20MB.");
    try {
      if (Platform.OS === "web") {
        const blob =
          asset.file instanceof Blob
            ? asset.file
            : await (await fetch(asset.uri)).blob();
        if (blob.size > 20 * 1024 * 1024)
          throw new Error("Choose a recording under20MB.");
        await binary("put", owner + ":" + uploadId, blob);
      } else {
        if (!FileSystem.documentDirectory)
          throw new Error("Private file storage is unavailable.");
        item.localUri =
          FileSystem.documentDirectory + "calltrack-audio-" + uploadId;
        await FileSystem.copyAsync({ from: asset.uri, to: item.localUri });
        const info = await FileSystem.getInfoAsync(item.localUri);
        if (!info.exists || info.size > 20 * 1024 * 1024)
          throw new Error("Choose an existing recording under 20 MB.");
      }
      if (current.current !== owner)
        throw new Error(
          "The signed-in account changed. The file was not uploaded.",
        );
      const next = await updateOwnerStore(owner, (value) => ({
        ...value,
        uploads: [...(value.uploads || []), item],
      }));
      publish(owner, next);
    } catch (e) {
      await removeFile(owner, item).catch(() => {});
      throw e;
    }
    void run();
    return item;
  }
  async function retry() {
    if (!uid) return;
    const next = await updateOwnerStore(uid, (value) => ({
      ...value,
      uploads: (value.uploads || []).map((item) => ({
        ...item,
        attention: false,
        error: null,
      })),
    }));
    publish(uid, next);
    return run();
  }
  async function discard(item) {
    if (item.uploadId === uploading)
      throw new Error("Wait for this upload to finish.");
    const owner = uid;
    const next = await updateOwnerStore(owner, (value) => ({
      ...value,
      uploads: (value.uploads || []).filter(
        (row) => row.uploadId !== item.uploadId,
      ),
    }));
    publish(owner, next);
    await removeFile(owner, item);
  }
  return (
    <Context.Provider
      value={{
        items,
        uploading,
        progress,
        error,
        stage,
        retry,
        discard,
        refresh: run,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useRecordings = () => useContext(Context);
