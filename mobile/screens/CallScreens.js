import React, { useState } from "react";
import { View, Text, StyleSheet } from "../components/Themed";
import { Ionicons } from "../components/Themed";
import AgentFilter from "../components/AgentFilter";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Select,
  Form,
  Pager,
  CallTimer,
  action,
  duration,
  PageHeader,
  Avatar,
  EmptyState,
  InfoRow,
  SearchField,
  Grid,
  Notice,
} from "../components/UI";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import { openPhoneDialer } from "../services/phone";

const outcomeLabels = {
  unconfirmed: "Unconfirmed",
  initiated: "Task prepared",
  ringing: "Ringing",
  "in-progress": "In progress",
  completed: "Answered",
  busy: "Busy",
  "no-answer": "No answer",
  failed: "Failed",
  canceled: "Canceled",
};
const businessResults = [
  "Interested",
  "Follow-up Required",
  "Not Interested",
  "Converted",
  "Wrong number",
  "Rejected",
];
function outcomeTone(status) {
  return status === "completed"
    ? "success"
    : ["failed", "no-answer"].includes(status)
      ? "danger"
      : ["unconfirmed", "busy"].includes(status)
        ? "warning"
        : "neutral";
}

export function CallsScreen({ route, navigation }) {
  const { user } = useAuth();
  const [agentId, setAgent] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [direction, setDirection] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [dates, setDates] = useState({});
  const [showDates, setShowDates] = useState(false);
  const leadId = route.params?.leadId;
  const r = useData(
    "/calls?page=" +
      page +
      "&agentId=" +
      agentId +
      "&status=" +
      status +
      "&direction=" +
      direction +
      "&q=" +
      encodeURIComponent(search) +
      (leadId ? "&leadId=" + leadId : "") +
      (dates.from ? "&from=" + encodeURIComponent(dates.from) : "") +
      (dates.to ? "&to=" + encodeURIComponent(dates.to) : ""),
  );
  const items = r.data?.items || [];
  return (
    <Screen>
      <PageHeader
        title="Call reports"

        actions={
          user.role === "agent" ? (
            <Button
              title="New call"
              icon="add-outline"
              onPress={() => navigation.navigate("Dialer")}
            />
          ) : undefined
        }
      />
      <Card>
        <View style={s.searchRow}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <SearchField
              value={q}
              onChangeText={setQ}
              placeholder="Search by phone number..."
            />
          </View>
          <Button
            title="Search"
            onPress={() => {
              setSearch(q);
              setPage(1);
            }}
          />
          <Button
            muted
            icon="calendar-outline"
            title={showDates ? "Hide dates" : "Date range"}
            onPress={() => setShowDates(!showDates)}
          />
        </View>
        <Select
          label="Outcome"
          value={status}
          options={[
            { label: "All outcomes", value: "" },
            ...Object.entries(outcomeLabels).map(([value, label]) => ({
              label,
              value,
            })),
          ]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Select
          label="Direction"
          value={direction}
          options={[
            { label: "All directions", value: "" },
            { label: "Incoming", value: "incoming" },
            { label: "Outgoing", value: "outgoing" },
          ]}
          onChange={(value) => {
            setDirection(value);
            setPage(1);
          }}
        />
        {!!(user.role === "admin") && (
          <AgentFilter
            value={agentId}
            onChange={(value) => {
              setAgent(value);
              setPage(1);
            }}
          />
        )}
        {!!showDates && (
          <View style={s.dateFilters}>
            <Form
              initial={dates}
              fields={[
                { key: "from", label: "From date or ISO date/time" },
                { key: "to", label: "To date or ISO date/time (exclusive)" },
              ]}
              submitLabel="Apply date range"
              onSubmit={async (values) => {
                setDates(values);
                setPage(1);
              }}
            />
            {!!(dates.from || dates.to) && (
              <Button
                muted
                title="Clear date range"
                onPress={() => {
                  setDates({});
                  setPage(1);
                }}
              />
            )}
          </View>
        )}
      </Card>
      <Notice
        title="A clear record of reported activity"
        icon="information-circle-outline"
      >
        SIM outcomes and durations are entered manually. An unconfirmed task is
        not a verified call.
      </Notice>
      <View style={s.listHeading}>
        <Text style={s.sectionTitle}>Call history</Text>
        {!!r.data && (
          <Text style={s.recordCount}>{r.data.total || 0} records</Text>
        )}
      </View>
      <State resource={r} />
      {!!(!r.loading && !r.error && !items.length) && (
        <EmptyState
          icon="call-outline"
          title="Your call history starts here"
          description="Call reports appear here after your team prepares a call task. Try adjusting your filters if you're looking for an existing report."
          action={
            user.role === "agent" ? (
              <Button
                title="Find a customer"
                onPress={() => navigation.navigate("Dialer")}
              />
            ) : undefined
          }
        />
      )}
      {items.map((call) => {
        const name = call.customerId?.fullName || call.phone;
        return (
          <Card key={call._id}>
            <View style={s.recordRow}>
              <Avatar name={name} size={48} />
              <View style={{ flex: 1, minWidth: 160, gap: 7 }}>
                <Text style={s.recordName}>{name}</Text>
                <Text style={s.recordSub}>{call.phone}</Text>
              </View>
              <Badge tone={outcomeTone(call.status)}>
                {outcomeLabels[call.status] || call.status}
              </Badge>
              <Button
                muted
                title={call.active ? "Open task" : "View report"}
                icon="arrow-forward-outline"
                onPress={() =>
                  navigation.navigate(
                    call.active ? "ActiveCall" : "CallDetails",
                    { id: call._id },
                  )
                }
              />
            </View>
            <View style={s.recordFooter}>
              <View style={s.inlineMeta}>
                <Ionicons
                  name={
                    call.direction === "outgoing"
                      ? "arrow-up-outline"
                      : "arrow-down-outline"
                  }
                  size={14}
                  color="#8B94A7"
                />
                <Text style={s.metaText}>
                  {call.direction === "outgoing" ? "Outgoing" : "Incoming"}
                </Text>
              </View>
              <View style={s.inlineMeta}>
                <Ionicons name="person-outline" size={14} color="#8B94A7" />
                <Text style={s.metaText}>
                  {call.agentId?.fullName || "Unassigned"}
                </Text>
              </View>
              <View style={s.inlineMeta}>
                <Ionicons name="time-outline" size={14} color="#8B94A7" />
                <Text style={s.metaText}>
                  {call.isDemo || call.durationKnown
                    ? duration(call.talkSeconds)
                    : "Duration unknown"}
                </Text>
              </View>
              <Text style={s.metaText}>
                {new Date(call.initiatedAt).toLocaleString()}
              </Text>
              <Badge>{call.isDemo ? "Demo" : "Self-reported"}</Badge>
            </View>
          </Card>
        );
      })}
      {!!r.data?.total && <Pager page={page} setPage={setPage} data={r.data} />}
    </Screen>
  );
}

export function DialerScreen({ navigation }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const r = useData("/leads?q=" + encodeURIComponent(search));
  const auth = useAuth();
  const items = r.data?.items || [];
  return (
    <Screen>
      <PageHeader title="Call a customer" />
      <Card>
        <View style={s.searchRow}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <SearchField
              value={q}
              onChangeText={setQ}
              placeholder="Search a customer or phone number..."
            />
          </View>
          <Button
            title="Find assigned lead"
            icon="search-outline"
            onPress={() => setSearch(q)}
          />
        </View>
      </Card>
      <State resource={r} />
      {!!(!r.loading && !r.error && !items.length) && (
        <EmptyState
          icon="people-outline"
          title="No assigned leads found"
          description="Search another name or number, or ask your admin to assign a lead to you."
        />
      )}
      <Grid minWidth={300}>
        {items.map((lead) => (
          <Card key={lead._id}>
            <View style={s.recordRow}>
              <Avatar name={lead.customerId.fullName} size={46} />
              <View style={{ flex: 1, gap: 7 }}>
                <Text style={s.recordName}>{lead.customerId.fullName}</Text>
                <Text style={s.recordSub}>{lead.customerId.phone}</Text>
              </View>
            </View>
            <Badge>{lead.status}</Badge>
            <Button
              title={
                auth.callMode === "demo" ? "Simulate call" : "Prepare SIM call"
              }
              icon="call-outline"
              onPress={() =>
                action(async () => {
                  const { data } = await api.post("/calls/start", {
                    leadId: lead._id,
                  });
                  auth.bump();
                  navigation.navigate("ActiveCall", {
                    id: data._id,
                    start: true,
                  });
                })
              }
            />
          </Card>
        ))}
      </Grid>
      <Notice
        title={
          auth.callMode === "demo"
            ? "You're in demo mode"
            : "Your phone. Your SIM."
        }
        icon="phone-portrait-outline"
      >
        {auth.callMode === "demo"
          ? "Simulation tasks do not contact customers or open your phone app."
          : "Preparing a task does not place a call. You'll open your phone app and return here to save the outcome."}
      </Notice>
    </Screen>
  );
}

export function ActiveCallScreen({ route, navigation }) {
  const auth = useAuth();
  const active = useData("/calls/active");
  const id =
    route.params?.id ||
    active.data?.items.find(
      (call) =>
        String(call.agentId?._id || call.agentId) === String(auth.user._id),
    )?._id;
  return (
    <Screen>
      <PageHeader title="Call task" />
      {id ? (
        <CallTask
          id={id}
          serverTime={active.data?.serverTime}
          navigation={navigation}
        />
      ) : (
        <>
          <State resource={active} />
          {!!(!active.loading && !active.error) && (
            <EmptyState
              icon="checkmark-circle-outline"
              title="No open call task"
              description="You're ready for your next conversation. Prepare a task from one of your assigned leads."
              action={
                auth.user.role === "agent" ? (
                  <Button
                    title="Find a customer"
                    icon="call-outline"
                    onPress={() => navigation.navigate("Dialer")}
                  />
                ) : undefined
              }
            />
          )}
        </>
      )}
    </Screen>
  );
}

function CallTask({ id, serverTime, navigation }) {
  const r = useData("/calls/" + id);
  const auth = useAuth();
  const call = r.data?.call;
  return (
    <>
      <State resource={r} />
      {!!call && (
        <>
          <Card>
            <View style={s.recordRow}>
              <Avatar
                name={call.customerId?.fullName || call.phone}
                size={62}
              />
              <View style={{ flex: 1, minWidth: 190, gap: 8 }}>
                <Text style={s.customerName}>
                  {call.customerId?.fullName || call.phone}
                </Text>
                <Text style={s.customerPhone}>{call.phone}</Text>
              </View>
              <Badge tone={outcomeTone(call.status)}>
                {outcomeLabels[call.status] || call.status}
              </Badge>
            </View>
            <View style={s.recordFooter}>
              <Badge>
                {call.isDemo ? "Simulated activity" : "SIM ? self-reported"}
              </Badge>
              <Text style={s.metaText}>
                {call.direction === "outgoing"
                  ? "Outgoing call task"
                  : "Incoming call task"}
              </Text>
            </View>
            {call.isDemo ? (
              <CallTimer call={call} serverTime={serverTime} />
            ) : (
              <Notice
                title="Complete the call in your phone app"
                icon="phone-portrait-outline"
              >
                Use your phone app for SIM selection, mute, speaker and hangup.
                Return here to report the actual outcome. Opening the dialer
                does not confirm a call took place.
              </Notice>
            )}
          </Card>
          {call.active ? (
            call.isDemo ? (
              <Card
                title="Simulation controls"

                icon="play-circle-outline"
              >
                <Grid minWidth={180}>
                  {[
                    "ringing",
                    "in-progress",
                    "completed",
                    "busy",
                    "no-answer",
                    "failed",
                    "canceled",
                  ].map((status) => (
                    <Button
                      key={status}
                      muted
                      title={"Simulate " + (outcomeLabels[status] || status)}
                      onPress={() =>
                        action(
                          () =>
                            api.post("/demo/calls/" + id + "/events", {
                              status,
                            }),
                          auth.bump,
                        )
                      }
                    />
                  ))}
                </Grid>
              </Card>
            ) : (
              <>
                {!!(
                  auth.user.role === "agent" && call.direction === "outgoing"
                ) && (
                  <Button
                    title="Open phone / SIM dialer"
                    icon="call-outline"
                    onPress={() => action(() => openPhoneDialer(call.phone))}
                  />
                )}
                <ManualReport
                  call={call}
                  onSaved={() => {
                    auth.bump();
                    navigation.replace("CallDetails", { id });
                  }}
                />
              </>
            )
          ) : (
            <Card title="This task is complete" icon="checkmark-circle-outline">
              <Body>Your report is ready to review.</Body>
              <Button
                title="View report"
                icon="arrow-forward-outline"
                onPress={() => navigation.replace("CallDetails", { id })}
              />
            </Card>
          )}
        </>
      )}
    </>
  );
}

function ManualReport({ call, onSaved }) {
  return (
    <Card
      title="How did the conversation go?"

      icon="create-outline"
    >
      <Notice
        title="Keep your report accurate"
        icon="information-circle-outline"
      >
        Select Answered only if the customer answered. Leave duration blank if
        it is unknown. Choose Unconfirmed if you cannot confirm a call took
        place.
      </Notice>
      <Form
        initial={{
          status: "unconfirmed",
          talkSeconds: "",
          result: call.result || "",
          notes: call.notes || "",
        }}
        fields={[
          {
            key: "status",
            label: "Call outcome",
            options: [
              { label: "Unconfirmed", value: "unconfirmed" },
              { label: "Answered", value: "completed" },
              { label: "No answer", value: "no-answer" },
              { label: "Busy", value: "busy" },
              { label: "Failed", value: "failed" },
              { label: "Canceled / did not call", value: "canceled" },
            ],
          },
          {
            key: "talkSeconds",
            label: "Talk duration in seconds (optional)",
            keyboardType: "numeric",
          },
          { key: "result", label: "Business result", options: businessResults },
          { key: "notes", label: "Conversation notes", multiline: true },
        ]}
        submitLabel="Save self-reported outcome"
        onSubmit={async (values) => {
          const body = {
            status: values.status,
            result: values.result || "",
            notes: values.notes || "",
          };
          if (String(values.talkSeconds).trim() !== "") {
            const seconds = Number(values.talkSeconds);
            if (!Number.isInteger(seconds) || seconds < 0)
              throw new Error("Enter whole seconds or leave blank");
            body.talkSeconds = seconds;
          }
          await api.post("/calls/" + call._id + "/report", body);
          onSaved();
        }}
      />
    </Card>
  );
}

function ResultForm({ call }) {
  const { bump } = useAuth();
  return (
    <Card
      title="Business result & notes"

      icon="document-text-outline"
    >
      <Form
        initial={{ result: call.result || "", notes: call.notes || "" }}
        fields={[
          { key: "result", label: "Business result", options: businessResults },
          { key: "notes", label: "Conversation notes", multiline: true },
        ]}
        submitLabel="Save result & notes"
        onSubmit={async (values) => {
          await api.patch("/calls/" + call._id + "/result", values);
          bump();
        }}
      />
    </Card>
  );
}

export function CallDetailsScreen({ route, navigation }) {
  const r = useData("/calls/" + route.params.id);
  const call = r.data?.call;
  return (
    <Screen>
      <State resource={r} />
      {!!call && (
        <>
          <PageHeader
            title={call.customerId?.fullName || "Call report"}
            subtitle={call.phone}
            actions={
              call.active ? (
                <Button
                  title={call.isDemo ? "Open simulation" : "Finish call report"}
                  icon="arrow-forward-outline"
                  onPress={() =>
                    navigation.navigate("ActiveCall", { id: call._id })
                  }
                />
              ) : undefined
            }
          />
          <View style={s.badges}>
            <Badge tone={outcomeTone(call.status)}>
              {outcomeLabels[call.status] || call.status}
            </Badge>
            <Badge>
              {call.isDemo ? "Demo simulation" : "Self-reported SIM activity"}
            </Badge>
            <Badge>{call.active ? "Open task" : "Closed task"}</Badge>
          </View>
          <Grid minWidth={340}>
            <Card
              title="Report details"

              icon="receipt-outline"
            >
              <InfoRow
                label="Phone number"
                value={call.phone}
                icon="call-outline"
              />
              <InfoRow
                label="Direction"
                value={call.direction === "outgoing" ? "Outgoing" : "Incoming"}
                icon="swap-vertical-outline"
              />
              <InfoRow
                label="Agent"
                value={call.agentId?.fullName || "Unknown"}
                icon="person-outline"
              />
              <InfoRow
                label="Task created"
                value={new Date(call.initiatedAt).toLocaleString()}
                icon="calendar-outline"
              />
              {call.isDemo ? (
                <>
                  <InfoRow
                    label="Simulated talk time"
                    value={duration(call.talkSeconds)}
                    icon="time-outline"
                  />
                  <InfoRow
                    label="Simulation ended"
                    value={
                      call.endedAt
                        ? new Date(call.endedAt).toLocaleString()
                        : "Simulation open"
                    }
                  />
                </>
              ) : (
                <>
                  <InfoRow
                    label="Talk duration"
                    value={
                      call.durationKnown
                        ? duration(call.talkSeconds) + " ? entered manually"
                        : "Unknown"
                    }
                    icon="time-outline"
                  />
                  <InfoRow
                    label="Report submitted"
                    value={
                      call.reportedAt
                        ? new Date(call.reportedAt).toLocaleString()
                        : "Awaiting report"
                    }
                    icon="checkmark-circle-outline"
                  />
                  {!!call.reportedAt && (
                    <InfoRow
                      label="Reported by"
                      value={call.reportedBy?.fullName || "Agent"}
                    />
                  )}
                </>
              )}
            </Card>
            <ResultForm call={call} />
          </Grid>
          {!call.isDemo && (
            <Notice title="About this report" icon="information-circle-outline">
              Outcomes are self-reported. Actual SIM answer/end times and
              connection status are not collected, and CallTrack does not record
              calls.
            </Notice>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  dateFilters: {
    borderTopWidth: 1,
    borderTopColor: "#E8EBF2",
    paddingTop: 20,
    gap: 12,
  },
  listHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: { color: "#29344D", fontSize: 15, fontWeight: "700" },
  recordCount: { color: "#8992A5", fontSize: 11 },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 15,
  },
  recordName: {
    color: "#29344D",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  },
  recordSub: { color: "#929BAD", fontSize: 12 },
  recordFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 17,
    borderTopWidth: 1,
    borderTopColor: "#EEF0F5",
    paddingTop: 14,
    marginTop: 5,
  },
  inlineMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 11, color: "#8B94A7", lineHeight: 18 },
  customerName: {
    color: "#17223B",
    fontSize: 23,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  customerPhone: { color: "#7B8497", fontSize: 15 },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    alignItems: "center",
  },
});
