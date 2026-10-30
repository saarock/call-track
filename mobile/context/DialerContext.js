import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { View, Text, Pressable, Modal, Ionicons } from "../components/Themed";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import { api } from "../services/api";
import {
  readOwnerStore,
  updateOwnerStore,
  tokenClaims,
} from "../services/localStore";
import {
  nativePhone,
  readNative,
  phoneCapabilities,
  requestPhoneSetup,
  openSystemPhone,
  newOperationId,
} from "../services/telecom";
import {
  attemptMatches,
  sameCallDraft,
  reportIdentity,
} from "../services/dialerSafety.mjs";
let desiredConfiguration = null;
const samePhone = (a, b) =>
  String(a || "")
    .replace(/\D/g, "")
    .replace(/^977(?=\d{10}$)/, "") ===
  String(b || "")
    .replace(/\D/g, "")
    .replace(/^977(?=\d{10}$)/, "");
const Dialer = createContext(null);
const blank = {
  queue: [],
  pending: [],
  leads: [],
  profile: null,
  lastSync: null,
};
let configuration = Promise.resolve();
function configureNative(value) {
  if (!nativePhone) return Promise.resolve();
  const next = configuration
    .catch(() => {})
    .then(() => {
      if (
        desiredConfiguration &&
        (desiredConfiguration.userId !== value.userId ||
          desiredConfiguration.accessToken !== value.accessToken)
      )
        throw new Error("The signed-in account changed. Dialing was canceled.");
      return nativePhone.configure(
        JSON.stringify(desiredConfiguration || value),
      );
    });
  configuration = next;
  return next;
}
export function DialerProvider({ children }) {
  const auth = useAuth(),
    theme = useTheme(),
    userId = auth.user?.role === "agent" ? String(auth.user._id) : null;
  const [store, setStore] = useState(blank),
    [capabilities, setCapabilities] = useState({
      available: Boolean(nativePhone),
      activeCallCount: 0,
    });
  const [phoneHistory, setPhoneHistory] = useState([]),
    [nativeHistory, setNativeHistory] = useState([]);
  const [nativeError, setNativeError] = useState(""),
    [syncing, setSyncing] = useState(false),
    [storageError, setStorageError] = useState("");
  const [dialRequest, setDialRequest] = useState(null),
    [leadRequest, setLeadRequest] = useState(null),
    [resume, setResume] = useState(0);
  const [simChoices, setSimChoices] = useState(null);
  const choice = useRef(null),
    worker = useRef(null),
    again = useRef(false),
    run = useRef(null),
    account = useRef(userId);
  const awaitingReturn = useRef(false),
    ingestLatest = useRef(null);
  account.current = userId;
  const token = auth.token;
  const credentials = useMemo(
    () => ({
      userId,
      validUntil: userId ? (tokenClaims(token)?.exp || 0) * 1000 : 0,
      accessToken: userId ? token : null,
      apiUrl: api.defaults.baseURL,
      themeMode: theme.mode,
    }),
    [userId, token, theme.mode],
  );
  if (!auth.loading) desiredConfiguration = credentials;
  const publishStore = useCallback((owner, next) => {
    if (account.current === owner) setStore(next);
    return next;
  }, []);
  const mutate = useCallback(
    async (updater) => {
      if (!userId) throw new Error("Sign in as an agent to save call results");
      const next = await updateOwnerStore(userId, updater);
      return publishStore(userId, next);
    },
    [userId, publishStore],
  );
  const refreshPhone = useCallback(async () => {
    try {
      const caps = await phoneCapabilities();
      setCapabilities(caps);
      if (nativePhone) {
        const history = await readNative("getHistory");
        for (const event of history) await ingestLatest.current?.(event);
        setNativeHistory((current) =>
          JSON.stringify(current) === JSON.stringify(history)
            ? current
            : history,
        );
        if (caps.defaultDialer && caps.callLogPermission) {
          try {
            setPhoneHistory(
              (await readNative("getCallLog")).map((c) => ({
                ...c,
                direction:
                  { 1: "incoming", 2: "outgoing", 3: "missed", 5: "missed" }[
                    c.type
                  ] || "unknown",
                durationKnown:
                  [1, 2].includes(c.type) && c.durationSeconds >= 0,
              })),
            );
          } catch {
            setPhoneHistory([]);
          }
        } else setPhoneHistory([]);
        const number = await nativePhone.getDialNumber();
        if (number !== null && number !== undefined)
          setDialRequest({ phone: number, key: Date.now() });
        const lead = await nativePhone.takeOpenLead();
        if (lead) setLeadRequest({ id: lead, key: Date.now() });
      }
      return caps;
    } catch (error) {
      setNativeError(error.message);
    }
  }, []);
  const refreshContacts = useCallback(async () => {
    if (!userId) return;
    const owner = userId,
      items = [];
    try {
      for (let page = 1; page <= 50; page++) {
        if (account.current !== owner) return;
        const response = await api.get("/leads?limit=100&page=" + page, {
          headers: { Authorization: "Bearer " + token },
        });
        items.push(...response.data.items);
        if (!response.data.hasMore) break;
      }
      if (account.current !== owner) return;
      const next = await updateOwnerStore(owner, (current) => ({
        ...current,
        leads: items,
      }));
      publishStore(owner, next);
      if (account.current !== owner) return;
      if (nativePhone)
        await nativePhone.setContacts(
          JSON.stringify(
            items.map((lead) => ({
              leadId: lead._id,
              phone: lead.customerId?.phone,
              fullName: lead.customerId?.fullName,
            })),
          ),
        );
    } catch {}
  }, [userId, token, publishStore]);
  const ingest = useCallback(
    async (event) => {
      if (!userId || event.userId !== userId) return;
      setNativeHistory((current) => {
        const previous = current.find((call) => call.callId === event.callId);
        if (
          previous?.sequence === event.sequence &&
          previous?.businessReported === event.businessReported
        )
          return current;
        return [
          ...current.filter((call) => call.callId !== event.callId),
          event,
        ];
      });
      if (event.state !== "DISCONNECTED") {
        await mutate((current) =>
          attemptMatches(event, current.activeAttempt) &&
          !current.activeAttempt.deviceCallId
            ? {
                ...current,
                activeAttempt: {
                  ...current.activeAttempt,
                  deviceCallId: event.callId,
                },
              }
            : current,
        );
      }
      if (event.state === "DISCONNECTED" && !event.businessReported) {
        await mutate((current) => {
          const attempt = attemptMatches(event, current.activeAttempt)
            ? current.activeAttempt
            : null;
          if (!event.tracked && !attempt) return current;
          const reportId = attempt?.attemptId || event.callId;
          if (
            current.queue.some(
              (item) =>
                item.reportId === reportId ||
                item.payload.device?.callId === event.callId,
            )
          )
            return current;
          const existing = current.pending.find(
            (item) => item.key === "native:" + event.callId,
          );
          if (existing?.device?.sequence >= event.sequence) return current;
          const pending = {
            ...existing,
            key: "native:" + event.callId,
            reportId,
            ...(attempt || {}),
            createdAt: event.endedAt || new Date().toISOString(),
            phone: event.normalizedPhone || event.phone,
            customerName: event.customerName || "",
            leadId: event.leadId || null,
            device: event,
            ready: true,
            source: "native",
            direction: event.direction,
          };
          return {
            ...current,
            pending: [
              ...current.pending.filter(
                (item) =>
                  item.key !== pending.key && item.reportId !== reportId,
              ),
              pending,
            ],
          };
        });
      }
    },
    [userId, mutate],
  );
  ingestLatest.current = ingest;
  const syncNow = useCallback(() => {
    if (!userId || !token) return Promise.resolve();
    if (worker.current) {
      again.current = true;
      return worker.current;
    }
    const owner = userId,
      headers = { Authorization: "Bearer " + token };
    const job = (async () => {
      setSyncing(true);
      try {
        try {
          if (nativePhone) {
            const events = (await readNative("getPending")).filter(
              (event) => event.userId === owner && event.tracked,
            );
            for (let index = 0; index < events.length; index += 50) {
              if (account.current !== owner) return;
              const response = await api.post(
                "/device/calls",
                { events: events.slice(index, index + 50) },
                { headers },
              );
              for (const item of response.data.items)
                await nativePhone.acknowledge(item.deviceCallId, item.sequence);
            }
          }
        } catch (error) {
          if (account.current === owner) setNativeError(error.message);
        }
        const saved = await readOwnerStore(owner);
        for (const item of saved.queue) {
          if (account.current !== owner || item.attention) continue;
          try {
            await api.post("/call-results", item.payload, { headers });
            if (item.payload.device && nativePhone) {
              await nativePhone.markReported(item.payload.device.callId, false);
              await nativePhone.acknowledge(
                item.payload.device.callId,
                item.payload.device.sequence,
              );
            }
            const next = await updateOwnerStore(owner, (current) => ({
              ...current,
              queue: current.queue.filter(
                (queued) => queued.reportId !== item.reportId,
              ),
              lastSync: new Date().toISOString(),
            }));
            publishStore(owner, next);
            auth.bump();
          } catch (error) {
            const status = error.response?.status;
            const next = await updateOwnerStore(owner, (current) => ({
              ...current,
              queue: current.queue.map((queued) =>
                queued.reportId === item.reportId
                  ? {
                      ...queued,
                      attempts: (queued.attempts || 0) + 1,
                      error: error.message,
                      attention: Boolean(
                        status &&
                        status >= 400 &&
                        status < 500 &&
                        status !== 401 &&
                        status !== 429,
                      ),
                    }
                  : queued,
              ),
            }));
            publishStore(owner, next);
            if (!status || status === 401 || status === 429 || status >= 500)
              break;
          }
        }
      } catch (error) {
        if (account.current === owner)
          setNativeError(
            error.response?.status === 401
              ? "Sign in again to synchronize."
              : error.message,
          );
      } finally {
        if (account.current === owner) setSyncing(false);
      }
    })();
    worker.current = job;
    job.finally(() => {
      worker.current = null;
      if (again.current) {
        again.current = false;
        setTimeout(() => void run.current?.(), 300);
      }
    });
    return job;
  }, [userId, token, publishStore]);
  run.current = syncNow;
  useEffect(() => {
    if (auth.loading) return;
    void configureNative(credentials)
      .then(() => setNativeError(""))
      .catch((error) => setNativeError(error.message));
  }, [auth.loading, credentials]);
  useEffect(() => {
    let alive = true;
    setStore(blank);
    setStorageError("");
    awaitingReturn.current = false;
    if (choice.current) {
      choice.current(null);
      choice.current = null;
      setSimChoices(null);
    }
    if (userId)
      readOwnerStore(userId)
        .then((value) => {
          if (alive) setStore(value);
        })
        .catch((error) => {
          if (alive) setStorageError(error.message);
        });
    return () => {
      alive = false;
    };
  }, [userId]);
  useEffect(() => {
    void refreshPhone()
      .then(async (caps) => {
        if (
          userId &&
          (!nativePhone || (caps && !caps.activeCallCount)) &&
          AppState.currentState === "active"
        )
          await mutate((current) => ({
            ...current,
            pending: current.pending.map((item) =>
              item.source === "manual" && !item.ready
                ? { ...item, ready: true }
                : item,
            ),
          }));
      })
      .catch((error) => setStorageError(error.message));
    if (userId) {
      void refreshContacts();
      void syncNow();
    }
    const refresh = async () => {
      setResume((value) => value + 1);
      await refreshPhone();
      if (userId) {
        if (awaitingReturn.current) {
          awaitingReturn.current = false;
          await mutate((current) => ({
            ...current,
            pending: current.pending.map((item) =>
              item.source === "manual" ? { ...item, ready: true } : item,
            ),
          }));
        }
        void refreshContacts();
        void syncNow();
      }
    };
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const online = () => {
      void syncNow();
    };
    if (Platform.OS === "web") window.addEventListener("online", online);
    const timer = setInterval(() => {
      void refreshPhone();
      void syncNow();
    }, 15000);
    const contactsTimer = setInterval(() => void refreshContacts(), 120000);
    return () => {
      app.remove();
      clearInterval(timer);
      clearInterval(contactsTimer);
      if (Platform.OS === "web") window.removeEventListener("online", online);
    };
  }, [userId, refreshPhone, refreshContacts, syncNow, mutate]);
  useEffect(() => {
    if (!nativePhone) return;
    const phone = nativePhone.addListener("onPhoneChange", (event) => {
      void ingest(event)
        .then(() => {
          void refreshPhone();
          void syncNow();
        })
        .catch((error) => setStorageError(error.message));
    });
    const dial = nativePhone.addListener("onDialNumber", (event) =>
      setDialRequest({ phone: event.phone || "", key: Date.now() }),
    );
    return () => {
      phone.remove();
      dial.remove();
    };
  }, [ingest, refreshPhone, syncNow]);
  useEffect(() => {
    if (!userId) return;
    for (const event of nativeHistory)
      if (
        event.userId === userId &&
        event.state === "DISCONNECTED" &&
        !event.businessReported
      )
        void ingest(event).catch((error) => setStorageError(error.message));
  }, [userId, nativeHistory, ingest]);
  async function selectSim(accounts, phone) {
    if (accounts.length === 1) return accounts[0].id;
    if (!accounts.length)
      throw new Error("No active SIM or eSIM call account is available.");
    return new Promise((resolve) => {
      choice.current = resolve;
      setSimChoices({ accounts, phone });
    });
  }
  const resolveSim = (value) => {
    setSimChoices(null);
    const complete = choice.current;
    choice.current = null;
    complete?.(value);
  };
  async function startCall(contact) {
    const initiatingOwner = userId;
    const checkOwner = () => {
      if (account.current !== initiatingOwner)
        throw new Error("The account changed. Dialing was canceled.");
    };
    checkOwner();
    const info = typeof contact === "string" ? { phone: contact } : contact;
    const number = String(info.phone || "").replace(/[^\d+*#]/g, "");
    if (!/^[+\d*#]{1,40}$/.test(number))
      throw new Error("Enter a valid phone number.");
    if (
      nativePhone?.isEmergencyNumber &&
      (await nativePhone.isEmergencyNumber(number))
    ) {
      await nativePhone.placeCall(number, null, "{}");
      return true;
    }
    if (auth.callMode === "demo")
      throw new Error("Demo mode does not make real phone calls.");
    if (Platform.OS === "web")
      throw new Error(
        "Use CallTrack Dialer on an Android phone to place SIM calls.",
      );
    const caps = await phoneCapabilities();
    if (
      nativePhone &&
      caps.defaultDialer &&
      caps.callPermission &&
      caps.phonePermission
    ) {
      checkOwner();
      await configureNative(credentials);
      checkOwner();
      const sims = await readNative("getSimAccounts");
      checkOwner();
      const selected = await selectSim(sims, number);
      checkOwner();
      if (selected === null || (info.canProceed && !info.canProceed()))
        return false;
      awaitingReturn.current = true;
      await nativePhone.placeCall(
        number,
        selected,
        JSON.stringify({
          leadId: info.leadId,
          customerName: info.customerName || "",
          userId: initiatingOwner,
          attemptId: info.attemptId || null,
          reservationId: info.reservationId || null,
          sessionId: info.sessionId || null,
        }),
      );
      return true;
    }
    if (nativePhone)
      throw new Error(
        "Open Profile and finish phone setup before using the managed SIM dialer.",
      );
    if (!userId) {
      await openSystemPhone(number);
      return true;
    }
    const prepared = (await readOwnerStore(userId)).activeAttempt;
    if (prepared) {
      await openSystemPhone(number);
      awaitingReturn.current = true;
      return true;
    }
    const id = newOperationId(),
      pending = {
        key: "manual:" + id,
        reportId: id,
        createdAt: new Date().toISOString(),
        phone: number,
        customerName: info.customerName || "",
        leadId: info.leadId || null,
        ready: false,
        source: "manual",
      };
    await mutate((current) => ({
      ...current,
      pending: [...current.pending, pending],
    }));
    try {
      await openSystemPhone(number);
      awaitingReturn.current = true;
    } catch (error) {
      await mutate((current) => ({
        ...current,
        pending: current.pending.filter((item) => item.key !== pending.key),
      }));
      throw error;
    }
    return true;
  }
  async function queueResult(draft, values) {
    const payload = {
      reportId: draft.reportId,
      createdAt: new Date().toISOString(),
      phone: values.phone || draft.phone,
      result: values.result,
      direction:
        draft.direction === "incoming" || draft.direction === "missed"
          ? "incoming"
          : draft.direction === "outgoing"
            ? "outgoing"
            : undefined,
      notes: values.notes || "",
      customerName: values.customerName || draft.customerName || "",
      createLead: Boolean(values.createLead),
      leadId:
        values.leadId === null ? null : values.leadId || draft.leadId || null,
      followUpAt: values.followUpAt || null,
      device: draft.device || null,
      serverCallId: draft.serverCallId || null,
      sessionId: draft.sessionId || undefined,
      reservationId: draft.reservationId || undefined,
      attemptId: draft.attemptId || undefined,
      leadStatus: values.leadStatus || undefined,
      optOut: Boolean(values.optOut),
      legacyCallId: draft.legacyCallId || null,
    };
    await mutate((current) => ({
      ...current,
      queue: [
        ...current.queue.filter((item) => item.reportId !== payload.reportId),
        {
          reportId: payload.reportId,
          payload,
          source: draft.source,
          attempts: 0,
          attention: false,
          error: null,
        },
      ],
      pending: current.pending.filter(
        (item) => item.key !== draft.key && item.reportId !== draft.reportId,
      ),
      activeAttempt:
        current.activeAttempt?.attemptId === draft.attemptId
          ? null
          : current.activeAttempt,
    }));
    if (draft.device && nativePhone)
      await nativePhone
        .markReported(draft.device.callId, false)
        .catch((error) => setNativeError(error.message));
    void syncNow();
    return payload;
  }
  async function skipResult(draft) {
    if (draft.device && nativePhone)
      await nativePhone.markReported(
        draft.device.callId,
        !draft.device.tracked,
      );
    await mutate((current) => ({
      ...current,
      pending: current.pending.filter((item) => item.key !== draft.key),
    }));
  }
  async function reportForCall(call) {
    let draft;
    await mutate((current) => {
      if (current.queue.some((item) => sameCallDraft(item.payload, call)))
        throw new Error(
          "This result is already saved on this device. Open Profile to synchronize it.",
        );
      const existing = current.pending.find((item) =>
        sameCallDraft(item, call),
      );
      if (existing) {
        draft = existing;
        return current;
      }
      const snapshot = nativeHistory.find(
        (item) => item.callId === call.deviceCallId,
      );
      const attempt =
        current.activeAttempt &&
        ((call.attemptId &&
          call.attemptId === current.activeAttempt.attemptId) ||
          (snapshot && attemptMatches(snapshot, current.activeAttempt)))
          ? current.activeAttempt
          : null;
      draft = {
        ...(attempt || {}),
        key: "saved:" + call._id,
        reportId:
          reportIdentity(call) || attempt?.attemptId || newOperationId(),
        createdAt: new Date().toISOString(),
        phone: call.phone,
        customerName: call.customerId?.fullName || call.customerName || "",
        leadId: call.leadId?._id || call.leadId || null,
        serverCallId: call._id,
        reservationId:
          call.reservationId?._id ||
          call.reservationId ||
          attempt?.reservationId,
        sessionId: call.powerSessionId || attempt?.sessionId,
        attemptId: call.attemptId || attempt?.attemptId,
        device: snapshot || null,
        source: call.source === "android-telecom" ? "native" : "manual",
        ready: true,
      };
      return { ...current, pending: [...current.pending, draft] };
    });
    return draft;
  }
  async function retryQueue() {
    await mutate((current) => ({
      ...current,
      queue: current.queue.map((item) => ({
        ...item,
        attention: false,
        error: null,
      })),
    }));
    return syncNow();
  }
  const pendingReports = store.pending.filter(
    (item) =>
      item.ready &&
      !store.queue.some((queued) => queued.reportId === item.reportId),
  );
  const value = {
    reportLocalCall: async (call) => {
      const stamp = +new Date(call.startedAt || call.date),
        key = "phone:" + call.id + ":" + stamp;
      const event = nativeHistory.find(
        (item) =>
          (!item.userId || item.userId === userId) &&
          samePhone(item.phone, call.phone) &&
          Math.abs(+new Date(item.startedAt) - stamp) < 5000 &&
          item.state === "DISCONNECTED",
      );
      let draft;
      await mutate((current) => {
        const existing = current.pending.find(
          (item) =>
            item.key === key || (event && item.device?.callId === event.callId),
        );
        if (existing) {
          draft = existing;
          return current;
        }
        if (
          event?.businessReported ||
          current.localReports?.[key] ||
          current.queue.some(
            (item) => event && item.payload.device?.callId === event.callId,
          )
        )
          throw new Error(
            "This phone call already has a saved or pending result. Check Profile.",
          );
        const reportId = event?.attemptId || event?.callId || newOperationId();
        draft = {
          key,
          reportId,
          phone: call.phone,
          customerName: call.name || event?.customerName || "",
          leadId: event?.leadId || null,
          device: event || null,
          source: event ? "native" : "manual",
          ready: true,
          createdAt: new Date().toISOString(),
          localCallKey: key,
          attemptId: event?.attemptId,
          reservationId: event?.reservationId,
          sessionId: event?.sessionId,
          notes: event
            ? ""
            : "Added from device phone history. Connection metadata is not independently imported.",
        };
        return {
          ...current,
          localReports: { ...(current.localReports || {}), [key]: reportId },
          pending: [...current.pending, draft],
        };
      });
      return draft;
    },
    recoverAttempt: async (reservation) => {
      if (!reservation?.attemptId) return;
      const caps = await phoneCapabilities();
      await mutate((current) => {
        const match = (call) =>
          call.attemptId === reservation.attemptId ||
          (reservation.deviceCallId &&
            call.device?.callId === reservation.deviceCallId);
        if (
          current.pending.some(match) ||
          current.queue.some((item) => match(item.payload))
        )
          return current;
        const snapshot = nativeHistory.find(
          (item) => item.callId === reservation.deviceCallId,
        );
        const draft = {
          key: "attempt:" + reservation.attemptId,
          reportId: reservation.attemptId,
          attemptId: reservation.attemptId,
          reservationId: reservation._id,
          sessionId: reservation.sessionId,
          phone: reservation.phone,
          customerName: reservation.customerName || "",
          leadId: reservation.leadId?._id || reservation.leadId,
          createdAt: new Date().toISOString(),
          preparedAt: reservation.attemptAt,
          direction: "outgoing",
          device: snapshot || null,
          source: snapshot ? "native" : "manual",
          ready:
            !caps.activeCallCount &&
            (!snapshot || snapshot.state === "DISCONNECTED"),
          notes:
            "Recovered interrupted attempt. Confirm what happened before saving.",
        };
        return {
          ...current,
          activeAttempt: { ...draft },
          pending: [...current.pending, draft],
        };
      });
    },
    prepareAttempt: async (attempt) => {
      const prepared = { ...attempt, preparedAt: new Date().toISOString() };
      const draft = {
        ...prepared,
        key: "attempt:" + attempt.attemptId,
        reportId: attempt.attemptId,
        direction: "outgoing",
        createdAt: prepared.preparedAt,
        ready: false,
        source: "manual",
      };
      await mutate((current) => ({
        ...current,
        activeAttempt: prepared,
        pending: [
          ...current.pending.filter((item) => item.key !== draft.key),
          draft,
        ],
      }));
    },
    failAttempt: async (attempt, reason) => {
      await mutate((current) => ({
        ...current,
        pending: current.pending.map((item) =>
          item.attemptId === attempt.attemptId
            ? { ...item, ready: true, notes: reason }
            : item,
        ),
      }));
    },
    capabilities,
    phoneHistory,
    nativeHistory,
    nativeError,
    storageError,
    syncing,
    store,
    pendingReports,
    resume,
    dialRequest,
    leadRequest,
    startCall,
    queueResult,
    skipResult,
    reportForCall,
    retryQueue,
    syncNow,
    refreshPhone,
    refreshContacts,
    setupPhone: async () => {
      await requestPhoneSetup();
      await refreshPhone();
    },
    showPhone: () => nativePhone?.showActiveCall(),
    editQueued: async (item) => {
      const draft = {
        key: "queued:" + item.reportId,
        reportId: item.reportId,
        ...item.payload,
        source: item.source || (item.payload.device ? "native" : "manual"),
        ready: true,
      };
      await mutate((current) => ({
        ...current,
        pending: [
          ...current.pending.filter((row) => row.key !== draft.key),
          draft,
        ],
      }));
      return draft;
    },
  };
  return (
    <Dialer.Provider value={value}>
      {children}
      <Modal
        visible={Boolean(simChoices)}
        transparent
        animationType="slide"
        onRequestClose={() => resolveSim(null)}
      >
        <Pressable
          onPress={() => resolveSim(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: "#FFFFFF",
              padding: 24,
              paddingBottom: 36,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              gap: 16,
            }}
          >
            <Text style={{ fontSize: 19, fontWeight: "700", color: "#17223B" }}>
              Call using
            </Text>
            <Text style={{ fontSize: 14, color: "#7B8497" }}>
              {simChoices?.phone}
            </Text>
            {simChoices?.accounts.map((sim) => (
              <Pressable
                key={sim.id}
                accessibilityRole="button"
                accessibilityLabel={"Use " + sim.label}
                onPress={() => resolveSim(sim.id)}
                style={{
                  padding: 17,
                  borderRadius: 12,
                  backgroundColor: "#F6F7FB",
                  flexDirection: "row",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <Ionicons name="card-outline" size={22} color="#169B80" />
                <Text
                  style={{ fontSize: 15, fontWeight: "600", color: "#17223B" }}
                >
                  {sim.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => resolveSim(null)}
              style={{ padding: 14, alignItems: "center" }}
            >
              <Text style={{ color: "#7B8497", fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Dialer.Provider>
  );
}
export function useDialer() {
  const value = useContext(Dialer);
  if (!value) throw new Error("useDialer must be inside DialerProvider");
  return value;
}
