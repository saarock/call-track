import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "../components/Themed";
import { Ionicons } from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Select,
  Bars,
  duration,
  PageHeader,
  MetricCard,
  EmptyState,
  SectionHeader,
  Grid,
} from "../components/UI";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";

const periods = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
];

function Shortcut({ icon, title, description, onPress, color = "#147D70" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        s.shortcut,
        pressed && { backgroundColor: "#F5F4FF" },
      ]}
    >
      <View style={[s.shortcutIcon, { backgroundColor: color + "12" }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.shortcutTitle}>{title}</Text>
        <Text style={s.shortcutDescription}>{description}</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color="#A0A7B7" />
    </Pressable>
  );
}

function ActivityChart({ daily }) {
  const [chartWidth, setChartWidth] = useState(0);
  const entries = Object.entries(daily || {}).slice(-31);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  const chartGap = Math.min(
    8,
    chartWidth ? chartWidth / (Math.max(1, entries.length) * 4) : 1,
  );
  const showLabels = entries.length <= Math.max(1, Math.floor(chartWidth / 40));
  if (!entries.length) {
    return (
      <View style={s.emptyChart}>
        <View style={s.chartGrid}>
          {[0, 1, 2, 3].map((line) => (
            <View key={line} style={s.gridLine} />
          ))}
        </View>
        <View style={s.chartEmptyLabel}>
          <View style={s.emptyIcon}>
            <Ionicons name="bar-chart-outline" size={25} color="#147D70" />
          </View>
          <Text style={s.emptyChartTitle}>Your activity starts here</Text>
          <Text style={s.emptyChartCopy}>
            Call tasks will appear as your team gets to work.
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View
      onLayout={(event) =>
        setChartWidth(Math.floor(event.nativeEvent.layout.width))
      }
    >
      <View style={[s.chartArea, { gap: chartGap }]}>
        {entries.map(([date, count], index) => (
          <View
            key={date}
            style={s.chartColumn}
            accessible
            accessibilityLabel={date + ": " + count + " call tasks"}
          >
            {!!showLabels && (
              <Text numberOfLines={1} style={s.chartCount}>
                {count}
              </Text>
            )}
            <View style={s.chartTrack}>
              <View
                style={[
                  s.chartBar,
                  {
                    height: Math.max(4, (count / max) * 150),
                    backgroundColor:
                      index === entries.length - 1 ? "#147D70" : "#C7C4FD",
                  },
                ]}
              />
            </View>
            {!!showLabels && (
              <Text numberOfLines={1} style={s.chartLabel}>
                {date.slice(5)}
              </Text>
            )}
          </View>
        ))}
      </View>
      {!showLabels && (
        <View style={s.chartDates}>
          <Text style={s.chartLabel}>{entries[0][0]}</Text>
          <Text style={s.chartLabel}>{entries[entries.length - 1][0]}</Text>
        </View>
      )}
    </View>
  );
}
export default function DashboardScreen({ navigation }) {
  const auth = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= 1150;
  const [period, setPeriod] = useState("today");
  const r = useData("/reports/dashboard?period=" + period);
  const d = r.data;
  const firstName = auth.user.fullName.split(" ")[0];
  return (
    <Screen>
      <PageHeader
        title="Overview"

        actions={
          <Button
            title="View reports"
            muted
            onPress={() => navigation.navigate("Reports")}
          />
        }
      />

      <View style={[s.welcome, width < 600 && { padding: 20 }]}>
        <View style={s.welcomeOrb} />
        <View style={{ flex: 1, gap: 10, zIndex: 1 }}>
          <View style={s.welcomeTag}>
            <View
              style={[
                s.statusDot,
                { backgroundColor: auth.connected ? "#73DEBC" : "#F3C56A" },
              ]}
            />
            <Text style={s.welcomeTagText}>
              {auth.connected
                ? "Workspace connected"
                : "Reconnecting live updates"}
            </Text>
          </View>
          <Text
            style={[
              s.welcomeTitle,
              width < 600 && { fontSize: 24, lineHeight: 31 },
            ]}
          >
            Welcome back, {firstName}.
          </Text>
          <Text style={s.welcomeCopy}>
            {width < 600
              ? "Make your next conversation count. Your workspace is ready."
              : "Make your next conversation count. Your team and opportunities are ready when you are."}
          </Text>
        </View>
        {!!(width >= 600) && (
          <View style={s.welcomeMark}>
            <Ionicons name="call-outline" size={46} color="#D5D2FF" />
          </View>
        )}
      </View>

      <View style={s.filterRow}>
        <Select value={period} onChange={setPeriod} options={periods} />
        <Badge>
          {auth.callMode === "demo" ? "Demo workspace" : "SIM workspace"}
        </Badge>
      </View>
      <State resource={r} />
      {!!d && (
        <>
          <Grid minWidth={220}>
            <MetricCard
              label="Call tasks"
              value={d.totalCalls}
              icon="call-outline"
              tone="primary"
              detail="Created in this period"
            />
            <MetricCard
              label="Answered"
              value={d.answered}
              icon="checkmark-done-outline"
              tone="success"
              detail={
                auth.callMode === "demo"
                  ? "Simulated outcomes"
                  : "Self-reported outcomes"
              }
            />
            <MetricCard
              label="Active leads"
              value={d.totalLeads}
              icon="people-outline"
              tone="purple"
              detail={d.newLeads + " new leads in your pipeline"}
            />
            <MetricCard
              label="Follow-ups"
              value={d.scheduledFollowUps}
              icon="calendar-outline"
              tone="warning"
              detail={
                d.overdue
                  ? d.overdue + " overdue and need attention"
                  : "Pending across your workspace"
              }
            />
          </Grid>

          <View
            style={[s.panelRow, { flexDirection: wide ? "row" : "column" }]}
          >
            <Card
              title="Call activity"

              icon="bar-chart-outline"
              action={<Badge>{d.totalCalls} tasks</Badge>}
              style={{ flex: wide ? 1.55 : undefined }}
            >
              <ActivityChart daily={d.daily} />
              <View style={s.chartFooter}>
                <View style={s.legend}>
                  <View style={s.legendDot} />
                  <Text style={s.smallText}>Call tasks</Text>
                </View>
                <Text style={s.smallText}>{d.timezone}</Text>
              </View>
            </Card>
            <Card
              title="Lead pipeline"

              icon="funnel-outline"
              style={{ flex: wide ? 1 : undefined }}
            >
              {Object.keys(d.statuses || {}).length ? (
                <Bars values={d.statuses} />
              ) : (
                <EmptyState
                  icon="people-outline"
                  title="Room for your next opportunity"
                  description="Add a lead to start building a healthy pipeline."
                  action={
                    <Button
                      title="Open leads"
                      muted
                      onPress={() => navigation.navigate("Leads")}
                    />
                  }
                />
              )}
            </Card>
          </View>

          <View
            style={[s.panelRow, { flexDirection: wide ? "row" : "column" }]}
          >
            <Card
              title="Conversation insights"

              icon="chatbubbles-outline"
              style={{ flex: wide ? 1 : undefined }}
            >
              <View style={s.insightGrid}>
                {[
                  ["Talk time", duration(d.talkSeconds), "time-outline"],
                  [
                    "Average talk time",
                    d.answeredFinal ? duration(d.averageSeconds) : "Unknown",
                    "speedometer-outline",
                  ],
                  ["Missed", d.missed, "call-outline"],
                  ["Unconfirmed", d.unconfirmed, "help-circle-outline"],
                ].map(([label, value, icon]) => (
                  <View key={label} style={s.insightItem}>
                    <Ionicons name={icon} size={18} color="#8D91AE" />
                    <Text style={s.insightValue}>{value}</Text>
                    <Text style={s.smallText}>{label}</Text>
                  </View>
                ))}
              </View>
              <Text style={s.footnote}>
                {auth.callMode === "demo"
                  ? "Demo activity is simulated."
                  : "SIM outcomes and talk durations are self-reported."}{" "}
                Average talk time includes answered, closed tasks with a known
                duration. {d.unknownDurations} answered reports have an unknown
                duration.
              </Text>
            </Card>
            {!!(auth.user.role === "admin") && (
              <Card
                title="Team snapshot"

                icon="people-circle-outline"
                style={{ flex: wide ? 0.8 : undefined }}
              >
                {[
                  ["Online now", d.onlineAgents, "#0F9C7A"],
                  ["Available agents", d.availableAgents, "#147D70"],
                  ["Open call tasks", d.onCalls, "#DD9137"],
                  ["Total agents", d.totalAgents, "#8D91AE"],
                ].map(([label, value, color]) => (
                  <View key={label} style={s.teamRow}>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <View style={[s.statusDot, { backgroundColor: color }]} />
                      <Text style={s.teamLabel}>{label}</Text>
                    </View>
                    <Text style={s.teamValue}>{value}</Text>
                  </View>
                ))}
                <Button
                  title="View team activity"
                  muted
                  onPress={() => navigation.navigate("Monitor")}
                />
              </Card>
            )}
          </View>

          <Card
            title="Reported outcomes"

            icon="pie-chart-outline"
          >
            <View style={s.outcomes}>
              {[
                ["Answered", d.answered, "#0F9C7A"],
                ["Missed", d.missed, "#E06372"],
                ["Busy", d.busy, "#E0A14D"],
                ["Failed", d.failed, "#A482D8"],
                ["Canceled", d.canceled, "#8992A5"],
              ].map(([label, value, color]) => (
                <View key={label} style={s.outcome}>
                  <View style={[s.statusDot, { backgroundColor: color }]} />
                  <Text style={s.teamLabel}>{label}</Text>
                  <Text style={s.outcomeValue}>{value}</Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      )}

      <SectionHeader title="Move your work forward" />
      <Grid minWidth={260}>
        <Shortcut
          icon="calendar-outline"
          title="Follow-ups"
          description="Keep the next conversation on track"
          color="#D39135"
          onPress={() => navigation.navigate("FollowUps")}
        />
        <Shortcut
          icon="people-outline"
          title="Customers"
          description="Know the people behind the numbers"
          color="#0F9C7A"
          onPress={() => navigation.navigate("Customers")}
        />
        <Shortcut
          icon="notifications-outline"
          title="Notifications"
          description="Catch up on your workspace updates"
          color="#7160CF"
          onPress={() => navigation.navigate("Notifications")}
        />
        {auth.user.role === "admin" ? (
          <Shortcut
            icon="person-add-outline"
            title="Manage agents"
            description="Build and support a great team"
            onPress={() => navigation.navigate("Agents")}
          />
        ) : (
          <>
            <Shortcut
              icon="call-outline"
              title="Dial a customer"
              description="Prepare your next SIM call task"
              onPress={() => navigation.navigate("Dialer")}
            />
            <Shortcut
              icon="document-text-outline"
              title="Finish call report"
              description="Record the outcome of an open task"
              onPress={() => navigation.navigate("ActiveCall")}
            />
          </>
        )}
      </Grid>
    </Screen>
  );
}

const s = StyleSheet.create({
  welcome: {
    backgroundColor: "#242348",
    borderRadius: 22,
    padding: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    overflow: "hidden",
  },
  welcomeOrb: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    right: -90,
    top: -180,
    borderWidth: 52,
    borderColor: "#FFFFFF05",
  },
  welcomeTag: { flexDirection: "row", alignItems: "center", gap: 7 },
  welcomeTagText: {
    color: "#C5C3E1",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  welcomeTitle: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  welcomeCopy: {
    color: "#C0BFD6",
    maxWidth: 590,
    fontSize: 13,
    lineHeight: 21,
  },
  welcomeMark: {
    height: 82,
    width: 82,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#FFFFFF1A",
    backgroundColor: "#FFFFFF08",
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  panelRow: { gap: 20, alignItems: "stretch" },
  emptyChart: {
    height: 225,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  chartGrid: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 12,
    bottom: 12,
    justifyContent: "space-between",
  },
  gridLine: { height: 1, backgroundColor: "#EFF0F7" },
  chartEmptyLabel: {
    backgroundColor: "#FFFFFFEE",
    alignItems: "center",
    padding: 16,
    gap: 8,
    maxWidth: 310,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#F2F1FE",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 5,
  },
  emptyChartTitle: { fontSize: 14, fontWeight: "600", color: "#37425B" },
  emptyChartCopy: {
    fontSize: 12,
    color: "#8C94A5",
    textAlign: "center",
    lineHeight: 19,
  },
  chartArea: {
    height: 225,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingTop: 12,
  },
  chartColumn: { flex: 1, minWidth: 0, gap: 7, alignItems: "center" },
  chartTrack: {
    height: 155,
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E8EBF2",
  },
  chartBar: {
    width: "70%",
    maxWidth: 45,
    minWidth: 1,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  chartCount: {
    fontSize: 10,
    color: "#6E7390",
    fontWeight: "600",
    maxWidth: "100%",
  },
  chartLabel: { fontSize: 9, color: "#9299A9", maxWidth: "100%" },
  chartDates: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  chartFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0F1F7",
  },
  legend: { flexDirection: "row", gap: 6, alignItems: "center" },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 2,
    backgroundColor: "#147D70",
  },
  smallText: { fontSize: 11, color: "#8C94A5", lineHeight: 17 },
  insightGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  insightItem: { minWidth: 100, flex: 1, gap: 8, paddingVertical: 10 },
  insightValue: {
    color: "#17223B",
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  footnote: {
    fontSize: 11,
    color: "#9399AA",
    lineHeight: 18,
    borderTopWidth: 1,
    borderTopColor: "#EFF0F7",
    paddingTop: 12,
  },
  teamRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  teamLabel: { color: "#6C758B", fontSize: 13 },
  teamValue: { color: "#17223B", fontSize: 17, fontWeight: "600" },
  outcomes: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  outcome: {
    flex: 1,
    minWidth: 135,
    padding: 16,
    backgroundColor: "#F9FAFD",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  outcomeValue: {
    color: "#17223B",
    fontSize: 20,
    fontWeight: "600",
    marginLeft: "auto",
  },
  shortcut: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8EBF2",
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    height: "100%",
  },
  shortcutIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutTitle: { fontSize: 13, fontWeight: "600", color: "#27324B" },
  shortcutDescription: { fontSize: 11, color: "#9299A9", lineHeight: 17 },
});
