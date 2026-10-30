import React, { useState } from "react";
import { View, Text, StyleSheet } from "../components/Themed";
import AgentFilter from "../components/AgentFilter";
import DateTimeField from "../components/DateTimeField";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Form,
  Field,
  Select,
  Pager,
  action,
  PageHeader,
  Avatar,
  EmptyState,
  Grid,
  InfoRow,
  SectionHeader,
} from "../components/UI";
import { colors } from "../utils/theme";
import { useData } from "../hooks/useData";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

export function FollowUpsScreen({ navigation }) {
  const [page, setPage] = useState(1),
    [filter, setFilter] = useState("pending");
  const { bump, user } = useAuth();
  const [agentId, setAgent] = useState("");
  const r = useData(
    `/follow-ups?page=${page}&agentId=${agentId}&${filter === "overdue" ? "overdue=true" : "status=" + filter}`,
  );
  return (
    <Screen>
      <PageHeader
        title="Follow-ups"

        actions={
          <Button
            muted
            title="Find a lead"
            icon="people-outline"
            onPress={() =>
              navigation.navigate("Workspace", { screen: "Leads" })
            }
          />
        }
      />
      <Card icon="calendar-outline" title="Your next conversations">
        <Select
          value={filter}
          options={[
            { label: "Upcoming", value: "pending" },
            { label: "Overdue", value: "overdue" },
            { label: "Completed", value: "completed" },
          ]}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />
        {!!(user.role === "admin") && (
          <AgentFilter
            value={agentId}
            onChange={(v) => {
              setAgent(v);
              setPage(1);
            }}
          />
        )}
      </Card>
      <SectionHeader
        title={
          filter === "completed"
            ? "Completed follow-ups"
            : filter === "overdue"
              ? "Needs your attention"
              : "On your schedule"
        }
        subtitle={
          r.data
            ? `${r.data.total} follow-ups in this view`
            : "Keep your customer commitments in view"
        }
      />
      <State resource={r} />
      {!!(!r.loading && !r.error && !r.data?.items?.length) && (
        <EmptyState
          icon={
            filter === "completed"
              ? "checkmark-done-outline"
              : "calendar-outline"
          }
          title={
            filter === "overdue"
              ? "You’re all caught up"
              : filter === "completed"
                ? "No completed follow-ups yet"
                : "A clear schedule"
          }
          description={
            filter === "overdue"
              ? "There are no overdue follow-ups for these filters."
              : "Schedule the next conversation from a lead’s profile. It will appear here."
          }
        />
      )}
      <Grid minWidth={320}>
        {r.data?.items.map((f) => {
          const overdue =
            new Date(f.dueAt) < new Date() && f.status === "pending";
          return (
            <Card key={f._id}>
              <View style={s.identity}>
                <Avatar name={f.customerId?.fullName || "Customer"} size={44} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.name}>
                    {f.customerId?.fullName || "Customer"}
                  </Text>
                  <Text style={s.meta}>Customer follow-up</Text>
                </View>
              </View>
              <View style={s.dateBlock}>
                <View style={{ gap: 3 }}>
                  <Text style={s.dateLabel}>
                    {new Date(f.dueAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Text>
                  <Text style={s.dateTime}>
                    {new Date(f.dueAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <Badge
                  tone={
                    overdue
                      ? "danger"
                      : f.status === "completed"
                        ? "success"
                        : "primary"
                  }
                >
                  {overdue
                    ? "Overdue"
                    : f.status === "completed"
                      ? "Completed"
                      : "Upcoming"}
                </Badge>
              </View>
              <InfoRow
                icon="person-outline"
                label="Assigned to"
                value={f.assignedAgentId?.fullName || "Unassigned"}
              />
              <Body>{f.notes || "No preparation notes added."}</Body>
              <Button
                muted
                title="Open lead"
                icon="arrow-forward-outline"
                onPress={() =>
                  navigation.navigate("LeadDetails", { id: f.leadId })
                }
              />
              {!!(f.status === "pending") && (
                <View style={s.actions}>
                  <Button
                    title="Mark completed"
                    icon="checkmark-outline"
                    onPress={() =>
                      action(
                        () => api.patch(`/follow-ups/${f._id}/complete`),
                        bump,
                      )
                    }
                  />
                  <Button
                    muted
                    title="Edit follow-up"
                    icon="create-outline"
                    onPress={() =>
                      navigation.navigate("NewFollowUp", {
                        followUp: f,
                        leadId: f.leadId,
                      })
                    }
                  />
                </View>
              )}
            </Card>
          );
        })}
      </Grid>
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}

export function NewFollowUpScreen({ route, navigation }) {
  const { bump } = useAuth(),
    f = route.params.followUp;
  const [dueAt, setDueAt] = useState(
      f?.dueAt || new Date(Date.now() + 86400000).toISOString(),
    ),
    [notes, setNotes] = useState(f?.notes || ""),
    [saving, setSaving] = useState(false);
  return (
    <Screen contentContainerStyle={{ maxWidth: 780 }}>
      <PageHeader title={f ? "Reschedule callback" : "Schedule callback"} />
      <Card title="Callback details">
        <DateTimeField
          label="Callback date and time ? Kathmandu"
          value={dueAt}
          onChange={setDueAt}
        />
        <Field
          label="Preparation notes"
          multiline
          value={notes}
          onChangeText={setNotes}
        />
        <Button
          title={f ? "Save callback" : "Schedule callback"}
          loading={saving}
          onPress={() =>
            action(async () => {
              setSaving(true);
              try {
                if (!dueAt || !Number.isFinite(+new Date(dueAt)))
                  throw new Error("Choose a valid callback date and time.");
                const body = { dueAt: new Date(dueAt).toISOString(), notes };
                if (f) await api.put("/follow-ups/" + f._id, body);
                else
                  await api.post("/follow-ups", {
                    ...body,
                    leadId: route.params.leadId,
                  });
                bump();
                navigation.goBack();
              } finally {
                setSaving(false);
              }
            })
          }
        />
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, lineHeight: 18, color: colors.muted },
  dateBlock: {
    backgroundColor: "#F6F7FB",
    padding: 15,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  dateLabel: { color: colors.muted, fontSize: 12 },
  dateTime: { color: colors.ink, fontSize: 19, fontWeight: "700" },
  actions: { gap: 10 },
});
