import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "./AuthContext";
import { useDialer } from "./DialerContext";
import { api } from "../services/api";
import { nativePhone, newOperationId } from "../services/telecom";
const Context = createContext(null);
export function PowerDialerProvider({ children }) {
  const auth = useAuth(),
    d = useDialer(),
    agent = auth.user?.role === "agent";
  const [state, setState] = useState({
      session: null,
      reservation: null,
      progress: {},
      queue: [],
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const advanceRequested = useRef(false);
  const [campaignId, setCampaignId] = useState("");
  const locked = useRef(false),
    current = useRef(state),
    owner = useRef(auth.user?._id),
    stopVersion = useRef(0),
    active = useRef(AppState.currentState === "active");
  current.current = state;
  owner.current = auth.user?._id;
  const headers = { Authorization: "Bearer " + auth.token };
  const publish = useCallback((data, uid) => {
    if (owner.current === uid) {
      current.current = data;
      setState(data);
    }
    return data;
  }, []);
  const refresh = useCallback(async () => {
    if (!agent) return;
    const uid = auth.user._id;
    try {
      const response = await api.get(
        "/power/session" + (campaignId ? "?campaignId=" + campaignId : ""),
        {
          headers: { Authorization: "Bearer " + auth.token },
        },
      );
      if (owner.current !== uid)
        throw new Error("The account changed. Calling was canceled.");
      if (response.data.reservation?.attemptId)
        await d.recoverAttempt(response.data.reservation);
      return publish(response.data, uid);
    } catch (e) {
      if (owner.current === uid) setError(e.message);
    }
  }, [agent, auth.user?._id, auth.token, publish, campaignId]);
  useEffect(() => {
    stopVersion.current++;
    advanceRequested.current = false;
  }, [auth.user?._id, auth.token]);
  useEffect(() => {
    setState({ session: null, reservation: null, progress: {}, queue: [] });
    setError("");
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (agent) void refresh();
  }, [auth.revision, d.store.queue.length]);
  useEffect(() => {
    if (!agent) return;
    const pulse = async () => {
      if (!active.current) return;
      const s = current.current;
      if (s.session) {
        try {
          const res = await api.post(
            "/power/heartbeat",
            {
              sessionId: s.session.sessionId || s.session._id,
              reservationId: s.reservation?._id || s.reservation?.reservationId,
            },
            { headers: { Authorization: "Bearer " + auth.token } },
          );
          publish(res.data, auth.user._id);
        } catch (e) {
          setError(e.message);
        }
      }
    };
    const timer = setInterval(pulse, 20000);
    const listener = AppState.addEventListener("change", (value) => {
      active.current = value === "active";
      if (!active.current) stopVersion.current++;
      else void refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [agent, auth.token, auth.user?._id, publish, refresh]);
  async function task(work) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (e) {
      setError(e.message);
      void refresh();
      throw e;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function post(path, body) {
    const uid = auth.user?._id;
    if (owner.current !== uid)
      throw new Error("The account changed. Calling was canceled.");
    const response = await api.post("/power/" + path, body, { headers });
    if (owner.current !== uid)
      throw new Error("The account changed. Calling was canceled.");
    return publish(response.data, uid);
  }
  function ensureReady() {
    if (!agent || owner.current !== auth.user?._id)
      throw new Error("Sign in as an agent.");
    if (d.pendingReports.length || d.store.queue.length)
      throw new Error(
        "Save and synchronize your previous result before starting another call.",
      );
    if (d.capabilities.activeCallCount > 0)
      throw new Error("Finish your current phone call first.");
    if (Platform.OS === "web")
      throw new Error("Use the Android Dialer app to make SIM calls.");
    if (!active.current) throw new Error("Open the dialer to start a call.");
  }
  async function next() {
    return task(async () => {
      await d.syncNow();
      if (d.pendingReports.length || d.store.queue.length)
        throw new Error("Finish and synchronize your previous result first.");
      const s = current.current.session;
      if (!s) throw new Error("Press Start Calling first.");
      return post("next", {
        sessionId: s.sessionId || s._id,
        requestId: newOperationId(),
      });
    });
  }
  async function start() {
    return task(async () => {
      await d.syncNow();
      const response = await post("start", {
        sessionId: newOperationId(),
        ...(campaignId ? { campaignId } : {}),
      });
      return post("next", {
        sessionId: response.session.sessionId || response.session._id,
        requestId: newOperationId(),
      });
    });
  }
  async function control(action) {
    if (["pause", "stop"].includes(action)) {
      stopVersion.current++;
      advanceRequested.current = false;
    }
    const s = current.current;
    if (!s.session) return;
    return post("control", {
      sessionId: s.session.sessionId || s.session._id,
      action,
      reservationId: s.reservation?._id || s.reservation?.reservationId,
    });
  }
  async function dialReservation(reservation, session) {
    ensureReady();
    const initiatingOwner = auth.user?._id;
    const version = stopVersion.current,
      attemptId = newOperationId(),
      reservationId = reservation._id || reservation.reservationId;
    const sessionId = session.sessionId || session._id;
    const response = await post("attempt", {
      sessionId,
      reservationId,
      attemptId,
    });
    if (!response.dialAuthorized)
      throw new Error(
        "This attempt is already registered. Review its result before dialing again.",
      );
    const attempt = {
      sessionId,
      reservationId,
      attemptId,
      leadId: reservation.leadId?._id || reservation.leadId,
      phone: reservation.phone,
      customerName: reservation.customerName || "",
    };
    try {
      if (owner.current !== initiatingOwner)
        throw new Error("The account changed. Calling was canceled.");
      await d.prepareAttempt(attempt);
      if (
        version !== stopVersion.current ||
        owner.current !== initiatingOwner ||
        !active.current
      )
        throw new Error("Calling was paused before dialing.");
      const placed = await d.startCall({
        ...attempt,
        canProceed: () =>
          version === stopVersion.current &&
          owner.current === initiatingOwner &&
          active.current,
      });
      if (!placed) throw new Error("Call canceled before dialing.");
    } catch (e) {
      await d.failAttempt(attempt, e.message).catch(() => {});
      await api
        .post(
          "/power/attempt-failed",
          { reservationId, attemptId },
          { headers },
        )
        .catch(() => {});
      throw e;
    }
  }
  useEffect(() => {
    if (
      !advanceRequested.current ||
      !agent ||
      d.store.queue.length ||
      d.pendingReports.length ||
      !active.current ||
      d.capabilities.activeCallCount
    )
      return;
    advanceRequested.current = false;
    void refresh()
      .then((view) => {
        if (view?.session?.status === "running" && !view.reservation)
          return post("next", {
            sessionId: view.session.sessionId,
            requestId: newOperationId(),
          });
      })
      .catch((e) => setError(e.message));
  }, [
    d.store.queue.length,
    d.pendingReports.length,
    agent,
    d.capabilities.activeCallCount,
  ]);
  async function callReserved() {
    return task(async () => {
      const s = current.current;
      if (!s.reservation) throw new Error("Get the next number first.");
      return dialReservation(s.reservation, s.session);
    });
  }
  async function callContact(contact) {
    // Phone emergency routing must never wait for a CRM network task or reservation.
    if (
      nativePhone?.isEmergencyNumber &&
      (await nativePhone.isEmergencyNumber(contact.phone))
    )
      return d.startCall(contact);
    return task(async () => {
      ensureReady();
      const result = await post("reserve", {
        requestId: newOperationId(),
        ...(contact.leadId
          ? { leadId: contact.leadId }
          : { phone: contact.phone, customerName: contact.customerName || "" }),
      });
      return dialReservation(result.reservation, result.session);
    });
  }
  return (
    <Context.Provider
      value={{
        ...state,
        campaignId,
        setCampaignId,
        planNext: () => {
          advanceRequested.current = true;
        },
        busy,
        error,
        refresh,
        start,
        next,
        control,
        callReserved,
        callContact,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePower() {
  return useContext(Context);
}
