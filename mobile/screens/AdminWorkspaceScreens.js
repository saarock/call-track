import Constants from "expo-constants";
import { RecordingAttachments } from "./RecordingScreens";
import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  StyleSheet,
  Switch,
  Ionicons,
} from "../components/Themed";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Avatar,
  Badge,
  Body,
  Button,
  EmptyState,
  Field,
  Form,
  Grid,
  InfoRow,
  MetricCard,
  Notice,
  PageHeader,
  Pager,
  Select,
  State,
  action,
  confirm,
  duration,
} from "../components/UI";
import { ThemeOptions } from "../components/ThemeToggle";
import AgentFilter from "../components/AgentFilter";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { colors } from "../utils/theme";
import { api } from "../services/api";

const periods = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
  { label: "Custom dates", value: "custom" },
];
const results = [
  { label: "All outcomes", value: "" },
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
const labelFor = (value) =>
  results.find((r) => r.value === value)?.label || value || "Result pending";
const dateText = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: "Asia/Kathmandu",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unavailable";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function usePeriod() {
  const [period, setPeriod] = useState("today"),
    [dates, setDates] = useState({ from: today(), to: today() });
  return {
    period,
    setPeriod,
    dates,
    setDates,
    params:
      "period=" +
      period +
      (period === "custom" ? "&from=" + dates.from + "&to=" + dates.to : ""),
  };
}
function PeriodPicker({ value }) {
  return (
    <View style={{ gap: 12 }}>
      <Select
        value={value.period}
        options={periods}
        onChange={value.setPeriod}
      />
      {!!(value.period === "custom") && (
        <Form
          initial={value.dates}
          fields={[
            { key: "from", label: "From (YYYY-MM-DD)" },
            { key: "to", label: "Through (YYYY-MM-DD)" },
          ]}
          submitLabel="Apply dates"
          onSubmit={async (v) => value.setDates(v)}
        />
      )}
    </View>
  );
}
function usePolling(resource) {
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void resource.refresh(), 15000);
      return () => clearInterval(timer);
    }, [resource.refresh]),
  );
}
function liveSeconds(call, time) {
  if (call?.verification?.method !== "android-telecom") return null;
  if (!call.deviceActive) return call.durationKnown ? call.talkSeconds : null;
  if (
    !call.answeredAt ||
    !call.deviceObservedAt ||
    time - new Date(call.deviceObservedAt).getTime() > 45000
  )
    return null;
  return Math.max(
    0,
    Math.floor((time - new Date(call.answeredAt).getTime()) / 1000),
  );
}
function useClock() {
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return time;
}
async function downloadReport(params, format) {
  const path = "/reports/download?" + params + "&format=" + format;
  const mime =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv";
  if (Platform.OS === "web") {
    const { data } = await api.get(path, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "calltrack-calls." + format;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    const destination = FileSystem.cacheDirectory + "calltrack-calls." + format;
    const response = await FileSystem.downloadAsync(
      api.defaults.baseURL + path,
      destination,
      { headers: { Authorization: api.defaults.headers.common.Authorization } },
    );
    if (response.status !== 200) throw new Error("Report download failed");
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("File sharing is unavailable on this device");
    await Sharing.shareAsync(destination, { mimeType: mime });
  }
}
function PerformanceTable({ data, navigation }) {
  const time = useClock();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ minWidth: 750, flex: 1 }}>
        <View style={[s.tableRow, s.tableHead]}>
          {[
            "Agent",
            "Calls",
            "Talk time",
            "Interested",
            "Converted",
            "Conversion",
            "Activity",
          ].map((title, i) => (
            <Text
              key={title}
              style={[
                s.tableLabel,
                { width: i === 0 ? 160 : i === 6 ? 150 : 88 },
              ]}
            >
              {title}
            </Text>
          ))}
        </View>
        {data.agents.map((agent) => {
          const current =
            agent.call &&
            time - new Date(agent.phoneObservedAt).getTime() < 45000;
          const seconds = current ? liveSeconds(agent.call, time) : null;
          const rank =
            String(data.ranking.top) === String(agent._id)
              ? "Top"
              : String(data.ranking.lowest) === String(agent._id)
                ? "Needs support"
                : null;
          return (
            <Pressable
              key={agent._id}
              accessibilityRole="button"
              accessibilityLabel={"View " + agent.fullName + " calls"}
              onPress={() =>
                navigation.navigate("Workspace", {
                  screen: "Calls",
                  params: { agentId: String(agent._id) },
                })
              }
              style={({ pressed }) => [
                s.tableRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View
                style={{
                  width: 160,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <Avatar
                  name={agent.fullName}
                  size={32}
                  style={{ borderRadius: 30 }}
                />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={s.name}>
                    {agent.fullName}
                  </Text>
                  {!!rank && <Text style={s.small}>{rank}</Text>}
                </View>
              </View>
              {[
                agent.totalCalls,
                duration(agent.talkSeconds),
                agent.interested,
                agent.converted,
                agent.conversionRate + "%",
              ].map((v, i) => (
                <Text key={i} style={[s.tableValue, { width: 88 }]}>
                  {v}
                </Text>
              ))}
              <View style={{ width: 150, gap: 3 }}>
                <Text
                  style={[
                    s.small,
                    { color: current ? colors.success : colors.muted },
                  ]}
                >
                  {agent.call && !current
                    ? "Awaiting phone update"
                    : agent.status}
                </Text>
                {!!(seconds !== null) && (
                  <Text style={s.name}>{duration(seconds)}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
        {!data.agents.length && (
          <Body style={{ paddingVertical: 20 }}>
            Create an agent to start assigning leads.
          </Body>
        )}
      </View>
    </ScrollView>
  );
}
export function SimpleDashboardScreen({ navigation }) {
  const auth = useAuth();
  const period = usePeriod(),
    r = useData("/reports/overview?" + period.params),
    daily = useData(
      auth.user.role === "admin"
        ? "/reports/daily?limit=7"
        : "/reports/catalog",
    );
  const [showDaily, setShowDaily] = useState(false),
    [expanded, setExpanded] = useState(null);
  usePolling(r);
  const d = r.data,
    summary = d?.summary;
  return (
    <Screen>
      <PageHeader
        title="Dashboard"

        actions={
          auth.user.role === "admin" ? (
            <Button
              title="New lead"
              icon="add"
              onPress={() => navigation.navigate("NewLead")}
            />
          ) : null
        }
      />
      <View style={s.inline}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <PeriodPicker value={period} />
        </View>
        <Button
          title="Live monitoring"
          muted
          icon="pulse-outline"
          onPress={() => navigation.navigate("LiveMonitoring")}
        />
        <Button
          title="Reports"
          muted
          icon="stats-chart-outline"
          onPress={() => navigation.navigate("Analytics")}
        />
      </View>
      {!d && <State resource={r} />}
      {!!(r.error && d) && (
        <Notice title="Updates paused" tone="warning">
          {r.error}
        </Notice>
      )}
      {!!d && (
        <>
          <Grid minWidth={240}>
            <MetricCard
              label={
                period.period === "today" ? "Calls today" : "Calls in period"
              }
              value={summary.totalCalls}
              icon="call-outline"
              detail="Android-observed attempts"
            />
            <MetricCard
              label="Total talk time"
              value={duration(summary.talkSeconds)}
              icon="time-outline"
              detail="Known connected duration"
            />
            <MetricCard
              label="Interested"
              value={summary.interested}
              icon="heart-outline"
              tone="success"
            />
            <MetricCard
              label="Follow-ups pending"
              value={summary.pendingFollowUps}
              icon="calendar-outline"
              tone="warning"
            />
            <MetricCard
              label="Converted"
              value={summary.converted}
              icon="checkmark-circle-outline"
              tone="success"
            />
            <MetricCard
              label="Agents on call"
              value={summary.onCall}
              icon="headset-outline"
              detail="Fresh Android call state"
            />
          </Grid>
          <Card
            title="Agent performance"
            subtitle={
              "Dates in " +
              d.timezone +
              ". Tap an agent for their call history."
            }
          >
            <PerformanceTable data={d} navigation={navigation} />
            <Body style={s.small}>
              Ranking:{" "}
              {d.ranking.metric === "conversionRate"
                ? "conversion rate"
                : d.ranking.metric === "interestedRate"
                  ? "interested rate"
                  : "talk time"}
              , with at least {d.ranking.minimumReportedAttempts} saved results.
              Conversion rate = converted results / saved results.
            </Body>
            {!!(summary.manualReports > 0) && (
              <Body style={s.small}>
                {summary.manualReports} manual reports are saved separately from
                observed call totals.
              </Body>
            )}
            {!!(summary.unknownDurations > 0) && (
              <Body style={s.small}>
                {summary.unknownDurations} answered calls have no verified
                duration.
              </Body>
            )}
          </Card>
        </>
      )}
      {!!(auth.user.role === "admin") && (
        <Card>
          <Button
            muted
            title={showDaily ? "Hide daily summaries" : "Daily summaries"}
            icon="document-text-outline"
            onPress={() => setShowDaily(!showDaily)}
          />
          {!!showDaily && (
            <>
              <Body>
                Saved summaries for completed days. Pending reminders and
                remaining numbers reflect the time each summary was generated.
              </Body>
              <Button
                title="Generate yesterday's summary"
                onPress={() =>
                  action(async () => {
                    const yesterday = new Date(Date.now() - 86400000);
                    const date = new Intl.DateTimeFormat("en-CA", {
                      timeZone: "Asia/Kathmandu",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(yesterday);
                    await api.post("/reports/daily/generate", { date });
                    await daily.refresh();
                  })
                }
              />
              <State resource={daily} />
              {daily.data?.items.map((report) => (
                <View key={report._id} style={s.savedReport}>
                  <Pressable
                    onPress={() =>
                      setExpanded(expanded === report._id ? null : report._id)
                    }
                    style={s.inline}
                  >
                    <Text style={[s.name, { flex: 1 }]}>{report.date}</Text>
                    <Badge>{report.status}</Badge>
                    <Ionicons
                      name={
                        expanded === report._id ? "chevron-up" : "chevron-down"
                      }
                      size={18}
                      color={colors.muted}
                    />
                  </Pressable>
                  {!!(expanded === report._id) && (
                    <>
                      <Body>
                        {report.summary?.totalCalls || 0} calls -{" "}
                        {duration(report.summary?.talkSeconds || 0)} talk time -{" "}
                        {report.summary?.converted || 0} converted
                      </Body>
                      <Body>Email: {report.email?.status || "disabled"}</Body>
                      {report.agents?.map((a) => (
                        <Body key={String(a._id)}>
                          {a.fullName}: {a.totalCalls} calls, {a.interested}{" "}
                          interested, {a.converted} converted,{" "}
                          {a.pendingFollowUps} follow-ups, {a.remaining}{" "}
                          remaining
                        </Body>
                      ))}
                    </>
                  )}
                </View>
              ))}
              {!!(daily.data?.items.length === 0) && (
                <Body>No saved daily summaries yet.</Body>
              )}
            </>
          )}
        </Card>
      )}
    </Screen>
  );
}
export function AdminCallsScreen({ navigation, route }) {
  const period = usePeriod(),
    [agentId, setAgent] = useState(route.params?.agentId || ""),
    [campaignId, setCampaign] = useState(""),
    [phone, setPhone] = useState(""),
    [search, setSearch] = useState(""),
    [direction, setDirection] = useState(""),
    [outcome, setOutcome] = useState(""),
    [page, setPage] = useState(1),
    [filterOpen, setFilterOpen] = useState(false),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (route.params?.agentId) setAgent(route.params.agentId);
  }, [route.params?.agentId]);
  const params =
    period.params +
    "&campaignId=" +
    campaignId +
    "&agentId=" +
    agentId +
    "&phone=" +
    encodeURIComponent(search) +
    "&direction=" +
    direction +
    "&outcome=" +
    outcome +
    (route.params?.leadId ? "&leadId=" + route.params.leadId : "");
  const r = useData("/reports/records?" + params + "&page=" + page),
    stats = useData("/reports/overview?" + params);
  useEffect(() => setPage(1), [params]);
  usePolling(r);
  const time = useClock();
  return (
    <Screen>
      <PageHeader
        title="Calls"

        actions={
          <View style={s.inline}>
            <Button
              title="Recordings"
              muted
              icon="musical-notes-outline"
              onPress={() => navigation.navigate("Recordings")}
            />
            <Button
              muted
              title="CSV"
              loading={exporting}
              onPress={() =>
                action(async () => {
                  setExporting(true);
                  try {
                    await downloadReport(params, "csv");
                  } finally {
                    setExporting(false);
                  }
                })
              }
            />
            <Button
              muted
              title="Excel"
              loading={exporting}
              onPress={() =>
                action(async () => {
                  setExporting(true);
                  try {
                    await downloadReport(params, "xlsx");
                  } finally {
                    setExporting(false);
                  }
                })
              }
            />
          </View>
        }
      />
      <Card>
        <PeriodPicker value={period} />
        <View style={s.inline}>
          <View style={{ flex: 1, minWidth: 170 }}>
            <Field
              value={phone}
              onChangeText={setPhone}
              label="Phone number"
              placeholder="Search a number"
              keyboardType="phone-pad"
            />
          </View>
          <Button
            title="Search"
            icon="search"
            onPress={() => setSearch(phone)}
          />
          <Button
            muted
            title="Filters"
            icon="options-outline"
            onPress={() => setFilterOpen(!filterOpen)}
          />
        </View>
        {!!filterOpen && (
          <>
            <AgentFilter value={agentId} onChange={setAgent} />
            <CampaignReportFilter value={campaignId} onChange={setCampaign} />
            <Select
              label="Call type"
              value={direction}
              onChange={setDirection}
              options={[
                { label: "All types", value: "" },
                { label: "Incoming", value: "incoming" },
                { label: "Outgoing", value: "outgoing" },
                { label: "Missed", value: "missed" },
              ]}
            />
            <Select
              label="Outcome"
              value={outcome}
              onChange={setOutcome}
              options={results}
            />
            <Button
              muted
              title="Clear filters"
              onPress={() => {
                setAgent("");
                setDirection("");
                setOutcome("");
                setSearch("");
                setPhone("");
              }}
            />
          </>
        )}
      </Card>
      {!!stats.data && (
        <Body>
          {stats.data.summary.totalCalls} observed calls -{" "}
          {stats.data.summary.incoming} incoming - {stats.data.summary.outgoing}{" "}
          outgoing - {stats.data.summary.missed} missed -{" "}
          {stats.data.summary.answered} answered - Average connected:{" "}
          {duration(stats.data.summary.averageSeconds)}
        </Body>
      )}
      <State resource={r} />
      {!!(r.data?.items.length === 0) && (
        <EmptyState
          icon="call-outline"
          title="No calls in this view"
          description="Try another date range or clear the filters."
        />
      )}
      <Card>
        {r.data?.items.map((call) => {
          const seconds = liveSeconds(call, time);
          return (
            <Pressable
              key={call._id}
              accessibilityRole="button"
              accessibilityLabel={"Open call " + call.phone}
              onPress={() =>
                navigation.navigate("CallDetails", { id: call._id })
              }
              style={({ pressed }) => [
                s.callRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Avatar
                name={call.customerId?.fullName || "?"}
                size={43}
                style={{ borderRadius: 24 }}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <Text numberOfLines={1} style={s.name}>
                  {call.customerId?.fullName || call.customerName || call.phone}
                </Text>
                <Text style={s.small}>
                  {call.customerId?.fullName ? call.phone + "  -  " : ""}
                  {call.agentId?.fullName || "Agent"}
                </Text>
                <Text style={s.small}>
                  {dateText(call.initiatedAt)} - {call.direction}
                </Text>
                <Text style={s.small}>
                  {call.metadataVerified
                    ? "Android observed"
                    : "Manual report  -  phone state unverified"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 7, maxWidth: 130 }}>
                <Badge>{labelFor(call.businessResult || call.result)}</Badge>
                <Text style={s.small}>
                  {seconds !== null ? duration(seconds) : "Duration unknown"}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </Card>
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}
export function AdminCallDetailsScreen({ route, navigation }) {
  const r = useData("/calls/" + route.params.id),
    call = r.data?.call,
    time = useClock();
  usePolling(r);
  const seconds = call && liveSeconds(call, time);
  return (
    <Screen>
      <PageHeader title="Call details" />
      <State resource={r} />
      {!!call && (
        <>
          <Card>
            <View style={s.inline}>
              <Avatar
                name={
                  call.customerId?.fullName ||
                  call.customerName ||
                  "Unknown caller"
                }
                size={56}
                style={{ borderRadius: 30 }}
              />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={s.heading}>
                  {call.customerId?.fullName ||
                    call.customerName ||
                    "Unknown caller"}
                </Text>
                <Body>{call.phone}</Body>
              </View>
              <Badge>{labelFor(call.businessResult || call.result)}</Badge>
            </View>
            <InfoRow label="Agent" value={call.agentId?.fullName || "Agent"} />
            <InfoRow label="Direction" value={call.direction} />
            {!!call.disconnectCause && (
              <InfoRow
                label="Android disconnect reason"
                value={call.disconnectCause}
              />
            )}
            {!!call.ringingObservedAt && (
              <InfoRow
                label="Ringing observed"
                value={dateText(call.ringingObservedAt)}
              />
            )}
            <InfoRow
              label="Call state"
              value={
                call.verification?.method === "android-telecom"
                  ? call.deviceActive &&
                    time - new Date(call.deviceObservedAt) > 45000
                    ? "Awaiting phone update"
                    : call.deviceState || call.status
                  : "Unverified"
              }
            />
            <InfoRow
              label="Started"
              value={
                call.verification?.startTimeKnown
                  ? dateText(call.initiatedAt)
                  : "Actual start unavailable"
              }
            />
            <InfoRow
              label="Connected"
              value={
                call.answeredAt
                  ? dateText(call.answeredAt)
                  : "No observed connection"
              }
            />
            <InfoRow label="Ended" value={dateText(call.endedAt)} />
            <InfoRow
              label="Connected duration"
              value={seconds !== null ? duration(seconds) : "Unknown"}
            />
            <InfoRow
              label="Source"
              value={
                call.verification?.method === "android-telecom"
                  ? "Android-observed call metadata"
                  : "Manually reported outcome"
              }
            />
            {!!call.leadId && (
              <Button
                muted
                title="Open customer lead"
                onPress={() =>
                  navigation.navigate("LeadDetails", {
                    id: call.leadId?._id || call.leadId,
                  })
                }
              />
            )}
          </Card>
          <Card title="Conversation notes">
            <Body>{call.notes || "No notes saved yet."}</Body>
            <Body style={s.small}>
              Result saved: {dateText(call.reportedAt)}
            </Body>
          </Card>
          <RecordingAttachments callId={call._id} />
        </>
      )}
    </Screen>
  );
}
function ToggleRow({ title, value, onChange }) {
  return (
    <View style={s.inline}>
      <Text style={[s.name, { flex: 1 }]}>{title}</Text>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
      />
    </View>
  );
}
function ReportSettings({ data, onSaved }) {
  const [enabled, setEnabled] = useState(Boolean(data.dailyReportEnabled)),
    [email, setEmail] = useState(Boolean(data.dailyReportEmailEnabled));
  return (
    <>
      <ToggleRow
        title="Generate daily summaries"
        value={enabled}
        onChange={setEnabled}
      />
      <ToggleRow
        title="Email daily summaries"
        value={email}
        onChange={setEmail}
      />
      <Form
        initial={{
          hour: String(data.dailyReportHour ?? 18),
          minute: String(data.dailyReportMinute ?? 0),
          recipients: (data.dailyReportEmails || []).join(", "),
          rankingMetric: data.rankingMetric || "conversionRate",
          minimum: String(data.rankingMinimumCalls || 5),
        }}
        fields={[
          {
            key: "hour",
            label: "Hour, 0–23 (Asia/Kathmandu)",
            keyboardType: "numeric",
          },
          { key: "minute", label: "Minute, 0–59", keyboardType: "numeric" },
          {
            key: "recipients",
            label: "Report recipients (comma-separated emails)",
          },
          {
            key: "rankingMetric",
            label: "Performance ranking",
            options: [
              { label: "Conversion rate", value: "conversionRate" },
              { label: "Interested rate", value: "interestedRate" },
              { label: "Talk time", value: "talkSeconds" },
            ],
          },
          {
            key: "minimum",
            label: "Minimum saved results for ranking",
            keyboardType: "numeric",
          },
        ]}
        submitLabel="Save reporting preferences"
        onSubmit={async (v) => {
          await api.put("/operations/settings", {
            dailyReportEnabled: enabled,
            dailyReportEmailEnabled: email,
            dailyReportHour: Number(v.hour),
            dailyReportMinute: Number(v.minute),
            dailyReportEmails: v.recipients
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            rankingMetric: v.rankingMetric,
            rankingMinimumCalls: Number(v.minimum),
          });
          await onSaved();
        }}
      />
    </>
  );
}
export function SimpleSettingsScreen({ navigation }) {
  const auth = useAuth(),
    r = useData("/operations/settings"),
    admin = auth.user.role === "admin";
  const [reportsOpen, setReportsOpen] = useState(false),
    [update, setUpdate] = useState(null),
    [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      setUpdate(
        (
          await api.get(
            "/app-updates?variant=admin&versionCode=" +
              (Constants.expoConfig?.android?.versionCode || 0),
          )
        ).data,
      );
    } finally {
      setChecking(false);
    }
  }
  async function download() {
    if (Platform.OS === "web") {
      const { data } = await api.get(update.downloadPath, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(data),
        link = document.createElement("a");
      link.href = url;
      link.download = "CallTrack-CRM.apk";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const dest = FileSystem.cacheDirectory + "CallTrack-CRM.apk";
      const response = await FileSystem.downloadAsync(
        api.defaults.baseURL + update.downloadPath,
        dest,
        {
          headers: { Authorization: api.defaults.headers.common.Authorization },
        },
      );
      if (response.status !== 200) throw new Error("Download failed");
      await Sharing.shareAsync(dest, {
        mimeType: "application/vnd.android.package-archive",
      });
    }
  }
  return (
    <Screen>
      <PageHeader title="Settings" />
      <Card>
        <View style={s.inline}>
          <Avatar
            name={auth.user.fullName}
            size={55}
            style={{ borderRadius: 28 }}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.heading}>{auth.user.fullName}</Text>
            <Body>{auth.user.email}</Body>
          </View>
          <Badge>{admin ? "Administrator" : "Supervisor"}</Badge>
        </View>
      </Card>
      <Card title="Appearance">
        <ThemeOptions />
      </Card>
      <Card title="Company & account">
        {!!admin && (
          <Button
            title="Company settings"
            muted
            icon="business-outline"
            onPress={() => navigation.navigate("CompanySettings")}
          />
        )}
        <Button
          title="Change password"
          muted
          icon="lock-closed-outline"
          onPress={() => navigation.navigate("Password")}
        />
        <Button
          title="Notifications"
          muted
          icon="notifications-outline"
          onPress={() => navigation.navigate("Notifications")}
        />
        <Button
          title="Integrations & privacy"
          muted
          icon="shield-checkmark-outline"
          onPress={() => navigation.navigate("Integrations")}
        />
        {!!admin && (
          <Button
            title="Activity & audit logs"
            muted
            icon="list-outline"
            onPress={() => navigation.navigate("AuditLog")}
          />
        )}
      </Card>
      {!!admin && (
        <Card>
          <Button
            title={
              reportsOpen
                ? "Hide reporting preferences"
                : "Daily reports & performance"
            }
            muted
            icon="document-text-outline"
            onPress={() => setReportsOpen(!reportsOpen)}
          />
          {!!reportsOpen && (
            <>
              <State resource={r} />
              {!!r.data && (
                <>
                  <Notice
                    title={
                      r.data.integrations.smtpConfigured
                        ? "SMTP configuration present"
                        : "Email not configured"
                    }
                  >
                    {r.data.integrations.smtpConfigured
                      ? "Enable delivery and choose recipients. Saved summaries show actual delivery status."
                      : "Summaries remain available in Dashboard. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM on the server for secure delivery."}
                  </Notice>
                  <ReportSettings
                    key={r.data.settings.updatedAt}
                    data={r.data.settings}
                    onSaved={r.refresh}
                  />
                  <Form
                    initial={{
                      retentionDays: String(
                        r.data.settings.retentionDays || 30,
                      ),
                    }}
                    fields={[
                      {
                        key: "retentionDays",
                        label:
                          "Recording retention preference, days (when supported media storage is configured)",
                        keyboardType: "numeric",
                      },
                    ]}
                    submitLabel="Save retention preference"
                    onSubmit={async (values) => {
                      await api.put("/operations/settings", {
                        retentionDays: Number(values.retentionDays),
                      });
                      await r.refresh();
                    }}
                  />
                </>
              )}
            </>
          )}
        </Card>
      )}
      {!!(admin && r.data?.settings) && (
        <PowerRules
          key={"power-" + r.data.settings.updatedAt}
          settings={r.data.settings}
          onSaved={r.refresh}
        />
      )}
      <Card title="Private Android updates">
        <Button
          title="Check for updates"
          muted
          loading={checking}
          onPress={() => action(check)}
        />
        {!!update && (
          <Body>
            {!update.configured
              ? "No private APK release is configured on this server."
              : update.updateAvailable
                ? "Version " +
                  update.version +
                  " is available from your company."
                : "The configured release is version " + update.version + "."}
          </Body>
        )}
        {!!update?.configured && (
          <Button
            title="Download private APK"
            onPress={() => action(download)}
          />
        )}
      </Card>
      <Button
        title="Sign out"
        muted
        tone="danger"
        icon="log-out-outline"
        onPress={() => confirm("Sign out?", auth.logout)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  inline: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  name: { fontSize: 13, fontWeight: "600", color: colors.ink },
  heading: { fontSize: 20, fontWeight: "700", color: colors.ink },
  small: { fontSize: 11, lineHeight: 18, color: colors.muted },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  tableHead: {
    backgroundColor: colors.background,
    paddingVertical: 12,
    borderRadius: 8,
  },
  tableLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    paddingLeft: 5,
  },
  tableValue: { fontSize: 13, color: colors.ink, paddingLeft: 5 },
  callRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  savedReport: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    gap: 10,
  },
});

export function AuditLogScreen() {
  const [page, setPage] = useState(1),
    [type, setType] = useState("");
  const r = useData(
    "/operations/audit?page=" + page + "&type=" + encodeURIComponent(type),
  );
  return (
    <Screen>
      <PageHeader title="Activity & audit log" />
      <Field
        label="Event type (optional)"
        value={type}
        onChangeText={(v) => {
          setType(v);
          setPage(1);
        }}
        placeholder="For example report.exported"
      />
      <State resource={r} />
      {r.data?.items?.map((item) => (
        <Card key={item._id}>
          <Text style={s.name}>{item.type}</Text>
          <Body>
            {item.actorId?.fullName || "System"} - {dateText(item.createdAt)}
          </Body>
          {!!item.text && <Body>{item.text}</Body>}
          <Body style={s.small}>
            {JSON.stringify(item.details || {}, null, 2)}
          </Body>
        </Card>
      ))}
      {!!(r.data?.items?.length === 0) && (
        <EmptyState title="No audit entries in this view" />
      )}
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}
export function IntegrationsScreen() {
  const r = useData("/operations/settings");
  return (
    <Screen>
      <PageHeader title="Integrations & privacy" />
      <State resource={r} />
      {!!r.data && (
        <>
          <Notice title="Employee monitoring notice">
            {r.data.monitoringNotice}
          </Notice>
          <Card title="SIM calling">
            <Badge tone="success">Android metadata integration</Badge>
            <Body>
              Call state, connection and final talk time come from Android
              Telecom where available. Agent outcomes are saved separately.
              Default phone role and runtime permissions are required.
            </Body>
          </Card>
          <Card title="Recordings & supervisor listening">
            <Body>
              Authorized existing audio files can be attached, encrypted and
              played from Recordings when an administrator enables private
              storage. Attachments are labeled as unverified files.
            </Body>
            <Badge tone="warning">Requires supported business telephony</Badge>
            <Body>{r.data.externalRequirements?.recording}</Body>
            <Body>{r.data.externalRequirements?.liveListening}</Body>
            <Body>
              Normal SIM calling provides no public, reliable two-sided audio
              stream for arbitrary Android devices. No microphone-only capture
              is presented as a call recording.
            </Body>
            <InfoRow
              label="Automatic call audio provider"
              value={r.data.integrations.pbxConfigured ? "Configured" : "None"}
            />
            <InfoRow
              label="Recording retention preference"
              value={
                (r.data.settings.retentionDays || 30) +
                " days for uploaded recordings"
              }
            />
          </Card>
          <Card title="WhatsApp & SMS">
            <Badge tone="neutral">Customer composer available</Badge>
            <Body>
              Open WhatsApp or SMS from a permitted customer record. You review
              the message and press Send in that app. The history records a
              composer request; it does not claim delivery.
            </Body>
            <Body>{r.data.externalRequirements?.messaging}</Body>
            <InfoRow
              label="WhatsApp Business provider"
              value="Not configured"
            />
            <InfoRow label="SMS provider" value="Not configured" />
          </Card>
          <Card title="Daily report email">
            <Badge
              tone={r.data.integrations.smtpConfigured ? "success" : "warning"}
            >
              {r.data.integrations.smtpConfigured
                ? "SMTP configuration present"
                : "SMTP not configured"}
            </Badge>
            <Body>
              Configuration presence does not verify delivery. Daily summary
              records show pending, sent or failed delivery after the backend
              job runs.
            </Body>
          </Card>
        </>
      )}
    </Screen>
  );
}
function CampaignReportFilter({ value, onChange }) {
  const r = useData("/campaigns?limit=100");
  return (
    <Select
      label="Campaign"
      value={value}
      onChange={onChange}
      options={[
        { label: "All permitted campaigns", value: "" },
        ...(r.data?.items || []).map((c) => ({ label: c.name, value: c._id })),
      ]}
    />
  );
}
export function AnalyticsScreen({ navigation }) {
  const period = usePeriod(),
    [agentId, setAgent] = useState(""),
    [campaignId, setCampaign] = useState(""),
    [type, setType] = useState("agents"),
    [exporting, setExporting] = useState(false);
  const params =
    period.params + "&agentId=" + agentId + "&campaignId=" + campaignId;
  const r = useData("/reports/overview?" + params),
    d = r.data;
  const max = Math.max(1, ...(d?.trends || []).map((v) => v.totalCalls));
  const reports = [
    ["calls", "Call report"],
    ["agents", "Agent performance"],
    ["duration", "Call durations"],
    ["direction", "Incoming / outgoing / missed"],
    ["leads", "Lead status"],
    ["conversions", "Conversions"],
    ["callbacks", "Callbacks"],
    ["recordings", "Recording availability"],
    ["campaigns", "Campaign performance"],
  ].map(([value, label]) => ({ value, label }));
  return (
    <Screen>
      <PageHeader title="Performance & reports" />
      <Card>
        <PeriodPicker value={period} />
        <AgentFilter value={agentId} onChange={setAgent} />
        <CampaignReportFilter value={campaignId} onChange={setCampaign} />
        <Select
          label="Export report"
          value={type}
          onChange={setType}
          options={reports}
        />
        <View style={s.inline}>
          <Button
            title="Download Excel"
            loading={exporting}
            onPress={() =>
              action(async () => {
                setExporting(true);
                try {
                  await downloadReport(params + "&type=" + type, "xlsx");
                } finally {
                  setExporting(false);
                }
              })
            }
          />
          <Button
            title="Download CSV"
            muted
            loading={exporting}
            onPress={() =>
              action(async () => {
                setExporting(true);
                try {
                  await downloadReport(params + "&type=" + type, "csv");
                } finally {
                  setExporting(false);
                }
              })
            }
          />
        </View>
      </Card>
      <State resource={r} />
      {!!d && (
        <>
          <Grid minWidth={180}>
            {[
              ["Total agents", d.summary.totalAgents],
              ["Active agents", d.summary.activeAgents],
              ["Online", d.summary.onlineAgents],
              ["Calls in period", d.summary.totalCalls],
              ["Calls this week", d.summary.callsThisWeek],
              ["Calls this month", d.summary.callsThisMonth],
              ["Incoming", d.summary.incoming],
              ["Outgoing", d.summary.outgoing],
              ["Missed", d.summary.missed],
              ["Answered", d.summary.answered],
              ["Talk time", duration(d.summary.talkSeconds)],
              ["Average connected", duration(d.summary.averageSeconds)],
              ["Interested", d.summary.interested],
              ["Converted", d.summary.converted],
              ["Pending callbacks", d.summary.pendingFollowUps],
              ["Remaining contacts", d.summary.remaining],
            ].map(([name, value]) => (
              <MetricCard
                key={name}
                label={name}
                value={value}
                icon="stats-chart-outline"
              />
            ))}
          </Grid>
          <Card
            title="Observed call trend"
            subtitle={"Attempt date in " + d.timezone}
          >
            <View style={{ gap: 14 }}>
              {d.trends.map((day) => (
                <View key={day._id} style={{ gap: 6 }}>
                  <View style={s.inline}>
                    <Text style={[s.small, { flex: 1 }]}>{day._id}</Text>
                    <Text style={s.name}>
                      {day.totalCalls} calls - {day.converted} converted
                    </Text>
                  </View>
                  <View
                    style={{
                      height: 11,
                      borderRadius: 6,
                      backgroundColor: colors.background,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        height: 11,
                        width: (100 * day.totalCalls) / max + "%",
                        backgroundColor: colors.success,
                        borderRadius: 6,
                      }}
                    />
                  </View>
                </View>
              ))}
              {!d.trends.length && (
                <Body>No call events or saved outcomes in this period.</Body>
              )}
            </View>
            <Body style={s.small}>{d.definitions.trends}</Body>
          </Card>
          <Card title="Agent performance">
            <PerformanceTable data={d} navigation={navigation} />
            <Body style={s.small}>
              Conversion rate = {d.definitions.conversionRate}. Ranking requires
              at least {d.ranking.minimumReportedAttempts} results.
            </Body>
          </Card>
          <Card title="Current lead status">
            {d.leadStatuses.map((row) => (
              <View key={row._id} style={s.inline}>
                <Text style={[s.name, { flex: 1 }]}>{row._id}</Text>
                <Badge>{String(row.count)}</Badge>
              </View>
            ))}
          </Card>
          <Notice title="Metric definitions">
            {Object.entries(d.definitions).map(([key, value]) => (
              <Body key={key} style={s.small}>
                {key}: {value}
              </Body>
            ))}
          </Notice>
        </>
      )}
    </Screen>
  );
}
export function MyPerformanceScreen() {
  const period = usePeriod(),
    r = useData("/reports/my-performance?" + period.params),
    d = r.data,
    agent = d?.agents?.[0];
  return (
    <Screen>
      <PageHeader title="My performance" />
      <PeriodPicker value={period} />
      <State resource={r} />
      {!!d && (
        <>
          <Grid minWidth={180}>
            {[
              ["Observed calls", d.summary.totalCalls],
              ["Talk time", duration(d.summary.talkSeconds)],
              ["Interested", d.summary.interested],
              ["Converted", d.summary.converted],
              ["Pending callbacks", d.summary.pendingFollowUps],
              ["Remaining leads", d.summary.remaining],
            ].map(([name, value]) => (
              <MetricCard
                key={name}
                label={name}
                value={value}
                icon="stats-chart-outline"
              />
            ))}
          </Grid>
          <Card title="Your results">
            <InfoRow
              label="Saved call results"
              value={d.summary.reportedAttempts}
            />
            <InfoRow
              label="Conversion rate"
              value={(agent?.conversionRate || 0) + "%"}
            />
            <Body>
              Conversion rate = converted results divided by all your saved
              results in the selected period.
            </Body>
            <Body>
              Phone totals use Android-observed events. Manually entered results
              and unknown talk durations are shown separately.
            </Body>
            <InfoRow label="Manual reports" value={d.summary.manualReports} />
            <InfoRow
              label="Unknown connected durations"
              value={d.summary.unknownDurations}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

function PowerRules({ settings, onSaved }) {
  const rules = settings.powerDialer || {};
  return (
    <Card title="Calling queue rules">
      <Form
        initial={{
          maxAttempts: String(rules.maxAttempts ?? 3),
          noAnswerRetryMinutes: String(rules.noAnswerRetryMinutes ?? 1440),
          busyRetryMinutes: String(rules.busyRetryMinutes ?? 60),
          skipRetryMinutes: String(rules.skipRetryMinutes ?? 60),
          callDelaySeconds: String(rules.callDelaySeconds ?? 2),
        }}
        fields={[
          {
            key: "maxAttempts",
            label: "Maximum attempts (1–10)",
            keyboardType: "numeric",
          },
          {
            key: "noAnswerRetryMinutes",
            label: "No answer retry delay, minutes",
            keyboardType: "numeric",
          },
          {
            key: "busyRetryMinutes",
            label: "Busy retry delay, minutes",
            keyboardType: "numeric",
          },
          {
            key: "skipRetryMinutes",
            label: "Skipped number retry delay, minutes",
            keyboardType: "numeric",
          },
          {
            key: "callDelaySeconds",
            label: "Minimum wait before Call Next, seconds (0–120)",
            keyboardType: "numeric",
          },
        ]}
        submitLabel="Save calling rules"
        onSubmit={async (values) => {
          await api.put("/operations/settings", {
            powerDialer: Object.fromEntries(
              Object.entries(values).map(([key, value]) => [
                key,
                Number(value),
              ]),
            ),
          });
          await onSaved();
        }}
      />
    </Card>
  );
}
