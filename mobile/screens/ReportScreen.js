import React, { useState } from "react";
import {
  View,
  Text,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from "../components/Themed";
import { Ionicons } from "../components/Themed";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Select,
  Form,
  Bars,
  action,
  duration,
  PageHeader,
  Avatar,
  EmptyState,
  MetricCard,
  Grid,
} from "../components/UI";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

const periods = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
  { label: "Custom range", value: "custom" },
];

export default function ReportScreen({ navigation }) {
  const { user, callMode } = useAuth();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState(false);
  const [dates, setDates] = useState({});
  const [agentId, setAgent] = useState("");
  const [exporting, setExporting] = useState(false);
  const params =
    "period=" +
    period +
    (period === "custom" && dates.from
      ? "&from=" + encodeURIComponent(dates.from)
      : "") +
    (period === "custom" && dates.to
      ? "&to=" + encodeURIComponent(dates.to)
      : "") +
    (agentId ? "&agentId=" + agentId : "");
  const r = useData("/reports/agents?" + params);
  const rows = (r.data?.items || []).filter(
    (agent) => !agentId || agent._id === agentId,
  );
  const totals = rows.reduce(
    (result, agent) => ({
      calls: result.calls + agent.totalCalls,
      answered: result.answered + agent.answered,
      talk: result.talk + agent.talkSeconds,
      pending: result.pending + agent.pendingFollowUps,
    }),
    { calls: 0, answered: 0, talk: 0, pending: 0 },
  );

  async function exportCSV() {
    setExporting(true);
    try {
      const response = await api.get("/reports/export?" + params, {
        responseType: "text",
      });
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(
          new Blob([response.data], { type: "text/csv;charset=utf-8;" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "calltrack-calls.csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      const path = FileSystem.cacheDirectory + "calltrack-calls.csv";
      await FileSystem.writeAsStringAsync(path, response.data, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("File sharing is unavailable on this device");
      await Sharing.shareAsync(path, {
        mimeType: "text/csv",
        dialogTitle: "Export call report",
        UTI: "public.comma-separated-values-text",
      });
      await FileSystem.deleteAsync(path, { idempotent: true });
    } finally {
      setExporting(false);
    }
  }
  return (
    <Screen>
      <PageHeader
        title="Performance reports"

        actions={
          user.role === "admin" ? (
            <Button
              title={exporting ? "Exporting..." : "Export CSV"}
              disabled={exporting}
              onPress={() => action(exportCSV)}
            />
          ) : null
        }
      />
      <Card>
        <View style={s.filterHeading}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Ionicons name="calendar-outline" size={17} color="#8D91AE" />
            <Text style={s.filterTitle}>Reporting period</Text>
          </View>
          {!!agentId && (
            <Button title="All agents" muted onPress={() => setAgent("")} />
          )}
        </View>
        <Select
          value={custom ? "custom" : period}
          options={periods}
          onChange={(value) => {
            setCustom(value === "custom");
            if (value !== "custom") setPeriod(value);
          }}
        />
        {!!custom && (
          <View style={s.customRange}>
            <Body>
              Enter dates in YYYY-MM-DD format. The end date is exclusive and
              uses your company timezone.
            </Body>
            <Form
              initial={dates}
              fields={[
                { key: "from", label: "From date", placeholder: "2026-10-01" },
                {
                  key: "to",
                  label: "To date (exclusive)",
                  placeholder: "2026-11-01",
                },
              ]}
              submitLabel="Apply date range"
              onSubmit={async (value) => {
                if (!value.from || !value.to)
                  throw new Error("Choose both a start and an end date.");
                setDates(value);
                setPeriod("custom");
              }}
            />
          </View>
        )}
      </Card>
      <State resource={r} />
      {!!r.data && (
        <>
          <Grid minWidth={210}>
            <MetricCard
              label="Call tasks"
              value={totals.calls}
              icon="call-outline"
              tone="primary"
              detail="Within the selected period"
            />
            <MetricCard
              label="Answered"
              value={totals.answered}
              icon="checkmark-done-outline"
              tone="success"
              detail={
                callMode === "demo"
                  ? "Simulated outcomes"
                  : "Self-reported outcomes"
              }
            />
            <MetricCard
              label="Total talk time"
              value={duration(totals.talk)}
              icon="time-outline"
              tone="purple"
              detail="Known durations on closed tasks"
            />
            <MetricCard
              label="Pending follow-ups"
              value={totals.pending}
              icon="calendar-outline"
              tone="warning"
              detail="Current workspace snapshot"
            />
          </Grid>
          <Card
            title="Activity by agent"

            icon="bar-chart-outline"
            action={
              <Badge>
                {rows.length} {rows.length === 1 ? "agent" : "agents"}
              </Badge>
            }
          >
            {rows.some((agent) => agent.totalCalls > 0) ? (
              <Bars
                values={Object.fromEntries(
                  rows.map((agent) => [
                    agent.fullName + " · " + agent._id.slice(-4),
                    agent.totalCalls,
                  ]),
                )}
              />
            ) : (
              <EmptyState
                icon="bar-chart-outline"
                title="A clear view of progress, as it happens"
                description="Once agents create call tasks, their activity will appear here. Try another period to explore earlier reports."
              />
            )}
          </Card>
          {!!rows.length && (
            <Card
              title="Agent performance"

              icon="people-outline"
            >
              {!!(width >= 1280) && (
                <View style={s.tableHeader}>
                  <Text style={[s.columnLabel, { flex: 1.6 }]}>
                    TEAM MEMBER
                  </Text>
                  <Text style={s.columnLabel}>CALL TASKS</Text>
                  <Text style={s.columnLabel}>ANSWERED</Text>
                  <Text style={s.columnLabel}>TALK TIME</Text>
                  <Text style={s.columnLabel}>FOLLOW-UPS</Text>
                  {!!(user.role === "admin") && <View style={{ width: 140 }} />}
                </View>
              )}
              {rows.map((agent) => (
                <View
                  key={agent._id}
                  style={[
                    s.agentRow,
                    width < 1280 && {
                      flexDirection: "column",
                      alignItems: "stretch",
                    },
                  ]}
                >
                  <View
                    style={[
                      s.agentIdentity,
                      { flex: width >= 1280 ? 1.6 : undefined },
                    ]}
                  >
                    <Avatar name={agent.fullName} size={38} />
                    <View style={{ gap: 3, flex: 1 }}>
                      <Text style={s.agentName}>{agent.fullName}</Text>
                      <Text style={s.agentDetail}>
                        {agent.assignedLeads} leads · {agent.convertedLeads}{" "}
                        converted
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[s.numbers, { flex: width >= 1280 ? 4 : undefined }]}
                  >
                    {[
                      ["Call tasks", agent.totalCalls],
                      ["Answered", agent.answered],
                      ["Talk time", duration(agent.talkSeconds)],
                      ["Follow-ups", agent.pendingFollowUps],
                    ].map(([label, value]) => (
                      <View key={label} style={s.numberCell}>
                        <Text style={s.number}>{value}</Text>
                        {!!(width < 1280) && (
                          <Text style={s.mobileLabel}>{label}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                  {!!(user.role === "admin") && (
                    <View style={{ width: width >= 1280 ? 140 : undefined }}>
                      <Button
                        muted
                        title={
                          agentId === agent._id ? "All agents" : "View report"
                        }
                        onPress={() =>
                          setAgent(agentId === agent._id ? "" : agent._id)
                        }
                      />
                    </View>
                  )}
                  <Text style={s.average}>
                    Average:{" "}
                    {agent.answeredFinal
                      ? duration(agent.averageSeconds)
                      : "Unknown"}{" "}
                    · {agent.missed} missed
                  </Text>
                </View>
              ))}
            </Card>
          )}
          {!rows.length && (
            <Card>
              <EmptyState
                icon="people-outline"
                title="Your team's story starts here"
                description={
                  user.role === "admin"
                    ? "Add your first agent to compare activity and review individual performance."
                    : "Your activity will appear here after your agent account is available."
                }
                action={
                  user.role === "admin" ? (
                    <Button
                      title="Manage agents"
                      muted
                      onPress={() => navigation.navigate("Agents")}
                    />
                  ) : null
                }
              />
            </Card>
          )}
        </>
      )}
      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={17} color="#989DB2" />
        <Text style={s.noteText}>
          {callMode === "demo"
            ? "Demo calls are simulated."
            : "SIM call outcomes and talk durations are self-reported."}{" "}
          Blank durations are excluded from averages. Call totals include tasks
          awaiting confirmation; lead and follow-up counts reflect the current
          snapshot.
        </Text>
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  filterHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  filterTitle: { fontSize: 12, color: "#6B758D", fontWeight: "600" },
  customRange: {
    backgroundColor: "#F8F9FD",
    borderRadius: 13,
    padding: 18,
    gap: 15,
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: "#F8F9FD",
    borderRadius: 8,
    gap: 12,
  },
  columnLabel: {
    flex: 1,
    fontSize: 9,
    color: "#959CAE",
    fontWeight: "600",
    letterSpacing: 0.7,
  },
  agentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F1F7",
  },
  agentIdentity: { flexDirection: "row", alignItems: "center", gap: 10 },
  agentName: { fontSize: 12, fontWeight: "600", color: "#37415A" },
  agentDetail: { fontSize: 10, color: "#9AA1B1", lineHeight: 17 },
  numbers: { flexDirection: "row", gap: 12 },
  numberCell: { flex: 1, gap: 5 },
  number: { fontSize: 14, fontWeight: "600", color: "#4C5670" },
  mobileLabel: { fontSize: 9, color: "#959CAE" },
  average: { width: "100%", fontSize: 10, color: "#A0A6B7", paddingLeft: 48 },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 3,
  },
  noteText: { flex: 1, color: "#979FB2", fontSize: 11, lineHeight: 19 },
});
