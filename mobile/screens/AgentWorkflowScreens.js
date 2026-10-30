import { localTime } from "../utils/dateTime";
import React, { useEffect, useState } from "react";
import { Platform, Linking } from "react-native";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Ionicons,
  Switch,
} from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  Field,
  Select,
  State,
  Pager,
  Avatar,
  EmptyState,
  PageHeader,
  Notice,
  action,
  duration,
} from "../components/UI";
import { RecordingAttachments, RecordingUploadQueue } from "./RecordingScreens";
import PrivateAppUpdate from "../components/PrivateAppUpdate";
import DateTimeField from "../components/DateTimeField";
import { ThemeOptions } from "../components/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { useDialer } from "../context/DialerContext";
import { usePower } from "../context/PowerDialerContext";
import { useData } from "../hooks/useData";
import { api } from "../services/api";
import { nativePhone, newOperationId } from "../services/telecom";

const ink = "#17223B",
  muted = "#7B8497",
  green = "#169B80",
  border = "#E8EBF2";
const row = { flexDirection: "row", alignItems: "center", gap: 12 };
const label = { color: ink, fontSize: 15, fontWeight: "600" };
const small = { color: muted, fontSize: 12, lineHeight: 19 };
const phoneKey = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .replace(/^977(?=\d{10}$)/, "");
export { localTime } from "../utils/dateTime";
export const outcomeOptions = [
  { label: "Interested", value: "interested" },
  { label: "Not Interested", value: "not-interested" },
  { label: "Call Later", value: "call-later" },
  { label: "Converted", value: "converted" },
  { label: "Already Customer", value: "already-customer" },
  { label: "Wrong Number", value: "wrong-number" },
  { label: "No Answer", value: "no-answer" },
  { label: "Busy", value: "busy" },
  { label: "New Lead", value: "new-lead" },
  { label: "Unreachable", value: "unreachable" },
  { label: "Do Not Call", value: "do-not-call" },
];
export function CallButton({ contact, compact = false }) {
  const power = usePower();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={"Call " + (contact.customerName || contact.phone)}
      onPress={() => action(() => power.callContact(contact))}
      style={({ pressed }) => ({
        ...row,
        justifyContent: "center",
        minWidth: compact ? 44 : 110,
        minHeight: 44,
        paddingHorizontal: compact ? 12 : 20,
        borderRadius: compact ? 24 : 12,
        backgroundColor: green,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="call" size={18} color="#FFFFFF" />
      {!compact && (
        <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Call</Text>
      )}
    </Pressable>
  );
}
export function PowerPanel({ navigation }) {
  const p = usePower(),
    d = useDialer();
  const status = p.session?.status,
    active = status === "running" || status === "active";
  const r = p.reservation;
  const campaigns = useData("/campaigns?limit=100");
  return (
    <Card>
      <Select
        label="Campaign"
        value={p.campaignId || ""}
        options={[
          { label: "All assigned campaigns", value: "" },
          ...(campaigns.data?.items || []).map((c) => ({
            label: c.name,
            value: c._id,
          })),
        ]}
        onChange={p.setCampaignId}
      />
      <View style={row}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: "#E9F8F3",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="play" size={18} color={green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={label}>Calling queue</Text>
          <Text style={small}>
            {status
              ? status === "paused"
                ? "Paused · resume when ready"
                : active
                  ? "Ready for your next conversation"
                  : "Session " + status
              : "Your assigned numbers, one at a time"}
          </Text>
        </View>
      </View>
      <View
        style={{ ...row, justifyContent: "space-between", flexWrap: "wrap" }}
      >
        {[
          ["Called", p.progress?.called],
          ["Remaining", p.progress?.remaining],
          ["Interested", p.progress?.interested],
          ["Follow-ups", p.progress?.followUps],
        ].map(([name, value]) => (
          <View key={name} style={{ gap: 4 }}>
            <Text style={{ fontSize: 23, fontWeight: "700", color: ink }}>
              {value ?? 0}
            </Text>
            <Text style={small}>{name}</Text>
          </View>
        ))}
      </View>
      {!!p.error && (
        <Text accessibilityRole="alert" style={{ ...small, color: "#D04B60" }}>
          {p.error}
        </Text>
      )}
      {!!d.pendingReports.length && (
        <Button
          title="Finish call result"
          icon="create-outline"
          onPress={() =>
            navigation.navigate("AfterCall", { key: d.pendingReports[0].key })
          }
        />
      )}
      {!!r && (
        <View
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: "#F6F7FB",
            gap: 5,
          }}
        >
          <Text style={small}>NEXT CUSTOMER</Text>
          <Text style={label}>{r.customerName || r.phone}</Text>
          <Text style={small}>{r.phone}</Text>
        </View>
      )}
      <View style={{ ...row, flexWrap: "wrap" }}>
        {!status || ["stopped", "completed", "expired"].includes(status) ? (
          <Button
            title="Start Calling"
            icon="play"
            loading={p.busy}
            onPress={() => action(p.start)}
          />
        ) : status === "paused" ? (
          <Button
            title="Resume Calling"
            icon="play"
            loading={p.busy}
            onPress={() => action(() => p.control("resume"))}
          />
        ) : (
          <>
            <Button
              title={r ? "Call Next" : "Get Next Number"}
              icon="call"
              loading={p.busy}
              disabled={
                !!r?.attemptId ||
                !!d.pendingReports.length ||
                !!d.store.queue.length ||
                d.capabilities.activeCallCount > 0
              }
              onPress={() => action(r ? p.callReserved : p.next)}
            />
            <Button
              title="Pause Calling"
              muted
              icon="pause"
              onPress={() => action(() => p.control("pause"))}
            />
          </>
        )}
        {!!(r && !r.attemptId) && (
          <Button
            title="Skip Number"
            muted
            onPress={() => action(() => p.control("skip"))}
          />
        )}
        {!!(status && !["stopped", "completed"].includes(status)) && (
          <Button
            title="Stop Calling"
            muted
            tone="danger"
            onPress={() => action(() => p.control("stop"))}
          />
        )}
      </View>
      <Text style={small}>Tap Call Next to dial.</Text>
      {!!(p.queue?.length > 0) && (
        <View style={{ gap: 10 }}>
          {p.queue.slice(0, 4).map((item, index) => (
            <View key={item.leadId || item._id || index} style={row}>
              <Text style={{ ...small, width: 20 }}>{index + 1}.</Text>
              <Text style={{ ...small, flex: 1 }}>
                {item.customerName || item.phone}
              </Text>
              <Text style={small}>{item.phone}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
export function AgentLeadsScreen({ navigation }) {
  const { settings } = useAuth();
  const [scope, setScope] = useState("all"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const d = useDialer(),
    r = useData(
      "/leads?limit=25&page=" +
        page +
        "&scope=" +
        scope +
        "&q=" +
        encodeURIComponent(search),
    );
  const cached = d.store.leads.filter((item) => {
    const c = item.customerId || {};
    const matches = (c.fullName + " " + c.phone)
      .toLowerCase()
      .includes(search.toLowerCase());
    return (
      matches &&
      (scope !== "today" ||
        new Date(item.assignedAt || item.createdAt).toLocaleDateString(
          "en-CA",
          { timeZone: "Asia/Kathmandu" },
        ) ===
          new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Kathmandu",
          }))
    );
  });
  const items = r.error ? cached : r.data?.items || [];
  return (
    <Screen contentContainerStyle={{ maxWidth: 1050, gap: 18 }}>
      <PageHeader
        title="Your leads"
        actions={
          settings?.agentCanCreateCustomers ? (
            <Button
              title="Add customer"
              icon="add-outline"
              onPress={() => navigation.navigate("NewLead")}
            />
          ) : null
        }
      />
      <PowerPanel navigation={navigation} />
      <View style={{ ...row, borderBottomWidth: 1, borderColor: border }}>
        {["today", "all"].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === value }}
            onPress={() => {
              setScope(value);
              setPage(1);
            }}
            style={{
              paddingHorizontal: 25,
              paddingVertical: 14,
              borderBottomWidth: 3,
              borderColor: scope === value ? green : "transparent",
            }}
          >
            <Text
              style={{
                ...label,
                color: scope === value ? green : muted,
                fontSize: 12,
              }}
            >
              {value.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Search leads"
        placeholder="Name or phone number"
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          setPage(1);
        }}
      />
      {r.error ? (
        <Notice tone="warning">
          Showing saved leads. Connect to refresh assignments and reserve your
          next call.
        </Notice>
      ) : (
        <State resource={r} />
      )}
      <Card style={{ padding: 0, gap: 0 }}>
        {items.map((lead, index) => {
          const c = lead.customerId || {};
          return (
            <View
              key={lead._id}
              style={{
                ...row,
                padding: 18,
                borderBottomWidth: index === items.length - 1 ? 0 : 1,
                borderColor: border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"Open " + c.fullName}
                onPress={() =>
                  navigation.navigate("LeadDetails", { id: lead._id })
                }
                style={{ ...row, flex: 1, minWidth: 0 }}
              >
                <Avatar
                  name={c.fullName}
                  size={46}
                  style={{ borderRadius: 24 }}
                />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={label}>{c.fullName || c.phone}</Text>
                  <Text style={small}>{c.phone}</Text>
                  <View style={row}>
                    <Badge>{lead.status}</Badge>
                    {!!lead.doNotCall && (
                      <Badge tone="danger">Do not call</Badge>
                    )}
                  </View>
                </View>
              </Pressable>
              {!lead.doNotCall && (
                <CallButton
                  compact
                  contact={{
                    phone: c.phone,
                    customerName: c.fullName,
                    leadId: lead._id,
                  }}
                />
              )}
            </View>
          );
        })}
        {!!(!items.length && !r.loading) && (
          <EmptyState
            icon="people-outline"
            title="No leads in this view"
            description="Assigned customers appear here. Try All or change your search."
          />
        )}
      </Card>
      {!r.error && <Pager page={page} setPage={setPage} data={r.data} />}
    </Screen>
  );
}
export function TelephoneScreen({ route, publicMode = false, onClose }) {
  const d = useDialer(),
    p = usePower();
  const [number, setNumber] = useState(route?.params?.phone || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d.dialRequest) setNumber(d.dialRequest.phone || "");
  }, [d.dialRequest?.key]);
  useEffect(() => {
    if (route?.params?.phone !== undefined) setNumber(route.params.phone);
  }, [route?.params?.phone]);
  const match = d.store.leads.find(
    (l) => phoneKey(l.customerId?.phone) === phoneKey(number),
  );
  const call = async () => {
    setBusy(true);
    setError("");
    try {
      if (publicMode) await d.startCall(number);
      else
        await p.callContact({
          phone: number,
          leadId: match?._id,
          customerName: match?.customerId?.fullName,
        });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen contentContainerStyle={{ maxWidth: 540, gap: 18, paddingTop: 24 }}>
      {!!publicMode && (
        <View style={{ ...row, justifyContent: "space-between" }}>
          <Text style={{ ...label, fontSize: 20 }}>CallTrack Phone</Text>
          {!!onClose && (
            <Button title="Employee login" muted compact onPress={onClose} />
          )}
        </View>
      )}
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 18 }}>
        <Text style={small}>
          {match?.customerId?.fullName || "Enter a phone number"}
        </Text>
        <TextInput
          accessibilityLabel="Phone number"
          value={number}
          onChangeText={(v) =>
            setNumber(v.replace(/[^\d+*#]/g, "").slice(0, 40))
          }
          keyboardType="phone-pad"
          placeholder="Phone number"
          placeholderTextColor={muted}
          style={{
            width: "100%",
            textAlign: "center",
            fontSize: 30,
            color: ink,
            minHeight: 55,
            fontWeight: "500",
          }}
        />
      </View>
      <View style={{ gap: 9 }}>
        {[
          ["1", "2", "3"],
          ["4", "5", "6"],
          ["7", "8", "9"],
          ["*", "0", "#"],
        ].map((keys, i) => (
          <View
            key={i}
            style={{ flexDirection: "row", justifyContent: "space-around" }}
          >
            {keys.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={"Dial " + key}
                onPress={() => setNumber((n) => (n + key).slice(0, 40))}
                onLongPress={() =>
                  key === "0" && setNumber((n) => (n + "+").slice(0, 40))
                }
                style={({ pressed }) => ({
                  width: 76,
                  height: 76,
                  borderRadius: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "#E9F8F3" : "#FFFFFF",
                  borderWidth: 1,
                  borderColor: border,
                  gap: 2,
                })}
              >
                <Text style={{ fontSize: 30, fontWeight: "500", color: ink }}>
                  {key}
                </Text>
                <Text style={{ fontSize: 9, letterSpacing: 2, color: muted }}>
                  {{
                    2: "ABC",
                    3: "DEF",
                    4: "GHI",
                    5: "JKL",
                    6: "MNO",
                    7: "PQRS",
                    8: "TUV",
                    9: "WXYZ",
                    0: "+",
                  }[key] || " "}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      <View style={{ ...row, justifyContent: "center", paddingVertical: 10 }}>
        <View style={{ width: 50 }} />
        <Button
          title={busy ? "Connecting…" : "Call"}
          icon="call"
          disabled={!number || busy}
          onPress={call}
          style={{
            backgroundColor: green,
            borderColor: green,
            minWidth: 160,
            borderRadius: 32,
            minHeight: 56,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete digit"
          onPress={() => setNumber((n) => n.slice(0, -1))}
          onLongPress={() => setNumber("")}
          style={{ padding: 14 }}
        >
          <Ionicons name="backspace-outline" size={23} color={muted} />
        </Pressable>
      </View>
      {!!error && <Notice tone="warning">{error}</Notice>}
      {!!(Platform.OS === "web") && (
        <Body style={{ textAlign: "center" }}>
          SIM calls are available in the Android Dialer app. Your leads, notes
          and reports work here too.
        </Body>
      )}
      {!!(nativePhone && !d.capabilities.defaultDialer) && (
        <Button
          title="Set up phone permissions"
          muted
          onPress={() => action(d.setupPhone)}
        />
      )}
    </Screen>
  );
}
export function AgentRecentsScreen({ navigation }) {
  const d = useDialer();
  const [page, setPage] = useState(1),
    [filter, setFilter] = useState("all"),
    [source, setSource] = useState("business");
  const r = useData(
    "/calls?page=" +
      page +
      "&limit=25" +
      (filter !== "all" ? "&direction=" + filter : ""),
  );
  const items =
    source === "phone"
      ? d.phoneHistory.filter((c) => filter === "all" || c.direction === filter)
      : r.data?.items || [];
  return (
    <Screen contentContainerStyle={{ maxWidth: 1000, gap: 18 }}>
      <PageHeader
        title="Recents"
        actions={
          <Button
            title="Recordings"
            muted
            icon="musical-notes-outline"
            onPress={() => navigation.navigate("Recordings")}
          />
        }
      />
      {!!d.capabilities.callLogPermission && (
        <Select
          value={source}
          options={[
            { label: "Business", value: "business" },
            { label: "Phone history · on this device", value: "phone" },
          ]}
          onChange={setSource}
        />
      )}
      <Select
        value={filter}
        options={["all", "incoming", "outgoing", "missed"].map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        }))}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
      />
      {!!d.store.queue.length && (
        <Notice
          tone="warning"
          title={d.store.queue.length + " results saved on this device"}
        >
          Open Profile to check synchronization.
        </Notice>
      )}
      {!!(source === "business") && <State resource={r} />}
      <Card style={{ padding: 0, gap: 0 }}>
        {items.map((call, i) => (
          <View
            key={call._id || call.id || i}
            style={{
              ...row,
              padding: 18,
              borderBottomWidth: 1,
              borderColor: border,
            }}
          >
            <Avatar
              name={call.customerId?.fullName || call.name || call.phone}
              size={43}
              style={{ borderRadius: 23 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                "Open call details for " +
                (call.customerId?.fullName || call.name || call.phone)
              }
              onPress={() =>
                source === "business"
                  ? navigation.navigate("CallDetails", { id: call._id })
                  : navigation.navigate("LocalCallDetails", { call })
              }
              style={{ flex: 1, gap: 4 }}
            >
              <Text style={label}>
                {call.customerId?.fullName ||
                  call.name ||
                  call.phone ||
                  "Private number"}
              </Text>
              <Text style={small}>
                {call.phone} ·{" "}
                {localTime(call.initiatedAt || call.startedAt || call.date)}
              </Text>
              <Text
                style={{
                  ...small,
                  color: call.direction === "missed" ? "#D04B60" : muted,
                }}
              >
                {call.direction || "Unknown direction"} ·{" "}
                {call.businessResult || call.status || "Phone history"}
              </Text>
              <Text style={small}>
                {call.durationKnown
                  ? duration(call.durationSeconds ?? call.talkSeconds)
                  : "Duration unavailable"}
                {source === "business"
                  ? " · " +
                    (call.source === "android-telecom"
                      ? "Android observed"
                      : "Manually reported")
                  : " · Device only"}
              </Text>
            </Pressable>
            {!!call.phone && (
              <CallButton
                compact
                contact={{
                  phone: call.phone,
                  customerName: call.customerId?.fullName || call.name,
                  leadId: call.leadId?._id || call.leadId,
                }}
              />
            )}
          </View>
        ))}
        {!!(!items.length && !r.loading) && (
          <EmptyState
            icon="call-outline"
            title="No recent calls"
            description="Your business calls will appear here after they synchronize."
          />
        )}
      </Card>
      {!!(source === "business") && (
        <Pager page={page} setPage={setPage} data={r.data} />
      )}
    </Screen>
  );
}
export function AfterCallScreen({ route, navigation }) {
  const d = useDialer(),
    p = usePower(),
    auth = useAuth();
  const draft = d.store.pending.find((item) => item.key === route.params?.key);
  const [result, setResult] = useState(draft?.result || ""),
    [notes, setNotes] = useState(draft?.notes || ""),
    [name, setName] = useState(draft?.customerName || ""),
    [followUpAt, setFollow] = useState(draft?.followUpAt || null),
    [createLead, setCreate] = useState(false),
    [optOut, setOptOut] = useState(false),
    [leadStatus, setLeadStatus] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!draft) return;
    setResult(draft.result || "");
    setNotes(draft.notes || "");
    setName(draft.customerName || "");
    setFollow(draft.followUpAt || null);
    setCreate(Boolean(draft.createLead));
    setOptOut(Boolean(draft.optOut));
    setLeadStatus(draft.leadStatus || "");
    setError("");
  }, [draft?.key]);
  if (!draft)
    return (
      <Screen>
        <Notice title="Result saved">
          Your pending results and sync status are in Profile.
        </Notice>
        <Button
          title="Back to leads"
          onPress={() => navigation.navigate("Workspace", { screen: "Leads" })}
        />
      </Screen>
    );
  async function save(next) {
    setSaving(true);
    setError("");
    try {
      if (!result) throw new Error("Choose a call result.");
      if (
        (result === "call-later" || result === "follow-up") &&
        (!followUpAt || !Number.isFinite(+new Date(followUpAt)))
      )
        throw new Error("Choose the callback date and time.");
      if (createLead && !name.trim())
        throw new Error("Enter the customer's name to add a lead.");
      await d.queueResult(draft, {
        result,
        notes,
        customerName: name,
        followUpAt,
        createLead,
        leadStatus: leadStatus || undefined,
        optOut,
      });
      auth.bump();
      if (next) p.planNext();
      if (!next) await p.control("pause").catch(() => {});
      navigation.navigate("Workspace", { screen: next ? "Leads" : "Recents" });
      if (next)
        void d
          .syncNow()
          .then(() => p.refresh())
          .catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Screen contentContainerStyle={{ maxWidth: 780, gap: 18 }}>
      <PageHeader title="Call result" />
      <Card>
        <View style={row}>
          <Avatar
            name={name || draft.phone}
            size={52}
            style={{ borderRadius: 27 }}
          />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={label}>{name || "New customer"}</Text>
            <Text style={small}>{draft.phone}</Text>
          </View>
        </View>
        <Badge tone={draft.source === "native" ? "success" : "warning"}>
          {draft.source === "native"
            ? "Android observed call"
            : "Manually reported outcome"}
        </Badge>
        {!!draft.device && (
          <Text style={small}>
            {draft.device.hadActive
              ? "Connection observed"
              : "No connection observed"}{" "}
            ·{" "}
            {draft.device.durationSeconds != null && draft.device.connectedAt
              ? duration(draft.device.durationSeconds)
              : "Duration unavailable"}
          </Text>
        )}
        <Field label="Customer name" value={name} onChangeText={setName} />
        <Select
          label="Call result"
          value={result}
          options={outcomeOptions}
          onChange={(value) => {
            setResult(value);
            if (value === "do-not-call") setOptOut(true);
          }}
        />
        <Field
          label="Conversation notes"
          multiline
          value={notes}
          onChangeText={setNotes}
          placeholder="What matters for the next conversation?"
        />
        {!!(result === "call-later" || result === "follow-up") && (
          <DateTimeField
            label="Callback date and time · Kathmandu"
            value={followUpAt}
            onChange={setFollow}
          />
        )}
        {!!draft.leadId && (
          <Select
            label="Lead status (optional)"
            value={leadStatus}
            options={[
              { label: "Use outcome", value: "" },
              ...(auth.settings?.leadStatuses || []).map((value) => ({
                label: value,
                value,
              })),
            ]}
            onChange={setLeadStatus}
          />
        )}
        {!draft.leadId && (
          <View style={row}>
            <Switch
              accessibilityLabel="Add as Lead"
              value={createLead}
              onValueChange={setCreate}
            />
            <Text style={label}>Add as Lead</Text>
          </View>
        )}
        <View style={row}>
          <Switch
            accessibilityLabel="Do not call this number"
            value={optOut}
            onValueChange={setOptOut}
          />
          <View style={{ flex: 1 }}>
            <Text style={label}>Customer requested no more calls</Text>
            <Text style={small}>
              Exclude this number from future calling queues.
            </Text>
          </View>
        </View>
        {!!error && (
          <Text
            accessibilityRole="alert"
            style={{ ...small, color: "#D04B60" }}
          >
            {error}
          </Text>
        )}
        <View style={{ ...row, flexWrap: "wrap" }}>
          <Button
            title="Save & Next Call"
            icon="arrow-forward"
            loading={saving}
            onPress={() => save(true)}
          />
          <Button
            title="Save & Pause"
            icon="pause"
            muted
            disabled={saving}
            onPress={() => save(false)}
          />
        </View>
        <Text style={small}>Saved locally, then synchronized.</Text>
      </Card>
    </Screen>
  );
}
export function AgentProfileScreen({ navigation }) {
  const auth = useAuth(),
    d = useDialer(),
    caps = d.capabilities;
  return (
    <Screen contentContainerStyle={{ maxWidth: 900, gap: 18 }}>
      <PageHeader title="Profile" />
      <Card>
        <View style={row}>
          <Avatar
            name={auth.user.fullName}
            size={56}
            style={{ borderRadius: 28 }}
          />
          <View style={{ gap: 5, flex: 1 }}>
            <Text style={{ ...label, fontSize: 20 }}>{auth.user.fullName}</Text>
            <Text style={small}>{auth.user.email}</Text>
            <Badge>{auth.user.agentCode || "Agent"}</Badge>
          </View>
        </View>
      </Card>
      <Card title="Phone setup" icon="phone-portrait-outline">
        <Body>
          {caps.available
            ? "CallTrack uses Android's phone role for SIM calls, incoming calls and call state."
            : "Install the Android Dialer APK to use the managed SIM phone. iOS uses the system phone and manual outcomes."}
        </Body>
        <Text style={small}>
          Default phone: {caps.defaultDialer ? "Enabled" : "Not enabled"} ·
          Calling permission: {caps.callPermission ? "Enabled" : "Not enabled"}{" "}
          · Recent history: {caps.callLogPermission ? "Enabled" : "Not enabled"}
        </Text>
        {!!caps.available && (
          <Button
            title="Set up phone permissions"
            icon="shield-checkmark-outline"
            onPress={() => action(d.setupPhone)}
          />
        )}
        {!!caps.nativeSyncError && (
          <Body style={{ color: "#D04B60" }}>{caps.nativeSyncError}</Body>
        )}
        {!!d.nativeError && (
          <Text style={{ ...small, color: "#A56813" }}>{d.nativeError}</Text>
        )}
        <Notice>
          Business call numbers, outcomes and Android call events are shared
          with your company. Phone-only recents stay on this device until you
          save a business result. SIM recording and live listening require
          supported company telephony infrastructure.
        </Notice>
      </Card>
      <Card
        title="Saved results"
        subtitle={d.store.queue.length + " waiting to synchronize"}
        icon="cloud-upload-outline"
      >
        {!!d.storageError && <Notice tone="danger">{d.storageError}</Notice>}
        <Text style={small}>Last sync: {localTime(d.store.lastSync)}</Text>
        <Button
          title={d.syncing ? "Synchronizing…" : "Sync now"}
          loading={d.syncing}
          muted
          onPress={() => action(d.retryQueue)}
        />
        {d.store.queue.map((item) => (
          <View
            key={item.reportId}
            style={{
              paddingVertical: 10,
              gap: 8,
              borderTopWidth: 1,
              borderColor: border,
            }}
          >
            <Text style={label}>
              {item.payload.customerName || item.payload.phone}
            </Text>
            <Text style={small}>
              {item.payload.result} ·{" "}
              {item.attention ? "Needs attention" : "Saved on device"}
            </Text>
            {!!item.error && <Body>{item.error}</Body>}
            {!!item.attention && (
              <Button
                title="Review result"
                muted
                onPress={() =>
                  action(async () => {
                    const draft = await d.editQueued(item);
                    navigation.navigate("AfterCall", { key: draft.key });
                  })
                }
              />
            )}
          </View>
        ))}
        {d.pendingReports.map((item) => (
          <Button
            key={item.key}
            title={"Finish result · " + (item.customerName || item.phone)}
            muted
            onPress={() => navigation.navigate("AfterCall", { key: item.key })}
          />
        ))}
      </Card>
      <Card title="Appearance">
        <ThemeOptions />
      </Card>
      <Card title="My performance">
        <Button
          title="View my performance"
          muted
          icon="stats-chart-outline"
          onPress={() => navigation.navigate("MyPerformance")}
        />
        <Button
          title="Notifications"
          muted
          icon="notifications-outline"
          onPress={() => navigation.navigate("Notifications")}
        />
      </Card>
      <RecordingUploadQueue />
      <Card title="Private app updates">
        <PrivateAppUpdate />
      </Card>
      <Card title="Account">
        <Button
          title="Change password"
          muted
          onPress={() => navigation.navigate("Password")}
        />
        <Button
          title="Sign out"
          muted
          tone="danger"
          onPress={() => action(auth.logout)}
        />
      </Card>
    </Screen>
  );
}
export function AgentFollowUpsScreen({ navigation }) {
  const [filter, setFilter] = useState("today"),
    [page, setPage] = useState(1);
  const { bump } = useAuth();
  const r = useData(
    "/follow-ups?scope=" +
      filter +
      "&status=pending&page=" +
      page +
      (filter === "overdue" ? "&overdue=true" : ""),
  );
  return (
    <Screen contentContainerStyle={{ maxWidth: 1000, gap: 18 }}>
      <PageHeader title="Follow-ups" />
      <Select
        value={filter}
        options={[
          { label: "Today", value: "today" },
          { label: "Upcoming", value: "upcoming" },
          { label: "Overdue", value: "overdue" },
        ]}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
      />
      <State resource={r} />
      {r.data?.items?.map((f) => (
        <Card key={f._id}>
          <View style={row}>
            <Avatar
              name={f.customerId?.fullName}
              style={{ borderRadius: 24 }}
            />
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={label}>
                {f.customerId?.fullName || f.customerId?.phone}
              </Text>
              <Text style={small}>{localTime(f.dueAt)} · Kathmandu</Text>
            </View>
            <Badge
              tone={+new Date(f.dueAt) < Date.now() ? "warning" : "neutral"}
            >
              {+new Date(f.dueAt) < Date.now() ? "Due" : "Upcoming"}
            </Badge>
          </View>
          <Body>{f.notes || "No preparation notes"}</Body>
          <View style={{ ...row, flexWrap: "wrap" }}>
            <CallButton
              contact={{
                phone: f.customerId?.phone,
                customerName: f.customerId?.fullName,
                leadId: f.leadId?._id || f.leadId,
              }}
            />
            <Button
              title="Customer history"
              muted
              onPress={() =>
                navigation.navigate("LeadDetails", {
                  id: f.leadId?._id || f.leadId,
                })
              }
            />
            <Button
              title="Mark done"
              muted
              onPress={() =>
                action(
                  () => api.patch("/follow-ups/" + f._id + "/complete"),
                  bump,
                )
              }
            />
          </View>
        </Card>
      ))}
      {!!(!r.loading && !r.data?.items?.length) && (
        <EmptyState
          icon="calendar-outline"
          title="No callbacks in this view"
          description="Choose Call Later after a conversation to schedule your next call."
        />
      )}
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}

export function BusinessCallDetailsScreen({ route, navigation }) {
  const d = useDialer(),
    r = useData("/calls/" + route.params.id),
    call = r.data?.call;
  return (
    <Screen contentContainerStyle={{ maxWidth: 850, gap: 18 }}>
      <State resource={r} />
      {!!call && (
        <>
          <PageHeader
            title={call.customerId?.fullName || "Call details"}
            subtitle={call.phone}
          />
          <Card>
            <Badge
              tone={call.source === "android-telecom" ? "success" : "warning"}
            >
              {call.source === "android-telecom"
                ? "Android observed call"
                : "Manually reported"}
            </Badge>
            <Text style={label}>{call.businessResult || call.status}</Text>
            {!!call.disconnectCause && (
              <Body>Phone result: {call.disconnectCause}</Body>
            )}
            {!!call.ringingObservedAt && (
              <Body>Ringing observed: {localTime(call.ringingObservedAt)}</Body>
            )}
            <Body>
              {localTime(call.initiatedAt)} · {call.direction}
            </Body>
            <Body>
              {call.durationKnown
                ? duration(call.durationSeconds ?? call.talkSeconds)
                : "Talk duration unavailable"}
            </Body>
            <Body>{call.notes || "No conversation notes."}</Body>
            {!!(
              !call.reportedAt &&
              !call.deviceActive &&
              !d.store.queue.some(
                (item) =>
                  item.payload.serverCallId === call._id ||
                  item.payload.device?.callId === call.deviceCallId,
              )
            ) && (
              <Button
                title="Add call result"
                onPress={() =>
                  action(async () => {
                    const draft = await d.reportForCall(call);
                    navigation.navigate("AfterCall", { key: draft.key });
                  })
                }
              />
            )}
            {!!call.leadId && (
              <Button
                title="Customer history"
                muted
                onPress={() =>
                  navigation.navigate("LeadDetails", {
                    id: call.leadId?._id || call.leadId,
                  })
                }
              />
            )}
          </Card>
          <RecordingAttachments callId={call._id} />
        </>
      )}
    </Screen>
  );
}

export function LocalCallDetailsScreen({ route, navigation }) {
  const { call } = route.params,
    d = useDialer();
  return (
    <Screen contentContainerStyle={{ maxWidth: 780 }}>
      <PageHeader title={call.name || "Phone call"} />
      <Card>
        <Text style={label}>{call.phone}</Text>
        <Body>
          {localTime(call.startedAt || call.date)} ? {call.direction}
        </Body>
        <Badge tone="neutral">Device only</Badge>
        <Body>
          {call.durationKnown
            ? duration(call.durationSeconds)
            : "Duration unavailable"}
        </Body>
        <Button
          title="Save as business call"
          disabled={!call.phone}
          muted
          onPress={() =>
            action(async () => {
              const draft = await d.reportLocalCall(call);
              navigation.navigate("AfterCall", { key: draft.key });
            })
          }
        />
        <Text style={small}>
          Only save calls you are authorized to share with your company.
        </Text>
      </Card>
    </Screen>
  );
}
