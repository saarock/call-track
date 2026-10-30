import React, { useState } from "react";
import { View, Text, StyleSheet } from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  State,
  Button,
  Form,
  Pager,
  duration,
  PageHeader,
  Avatar,
  SearchField,
  EmptyState,
  Grid,
  MetricCard,
  InfoRow,
  SectionHeader,
} from "../components/UI";
import { colors } from "../utils/theme";
import { contactFields } from "./LeadScreens";
import { useData } from "../hooks/useData";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

export function CustomersScreen({ navigation }) {
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  const r = useData(`/customers?page=${page}&q=${encodeURIComponent(search)}`);
  return (
    <Screen>
      <PageHeader title="Customers" />
      <Card>
        <View style={s.searchRow}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <SearchField
              value={q}
              onChangeText={setQ}
              placeholder="Find a customer by name"
            />
          </View>
          <Button
            icon="search-outline"
            title="Search"
            onPress={() => {
              setSearch(q);
              setPage(1);
            }}
          />
        </View>
      </Card>
      <SectionHeader
        title="Customer directory"
        subtitle={
          r.data
            ? `${r.data.total} contacts in this view`
            : "Your authorized customer contacts"
        }
      />
      <State resource={r} />
      {!!(!r.loading && !r.error && !r.data?.items?.length) && (
        <EmptyState
          icon="person-circle-outline"
          title={
            search ? "No matching customers" : "Your relationships live here"
          }
          description={
            search
              ? "Try another name to find the contact you need."
              : "Customers appear here as leads are added to your workspace."
          }
          action={
            <Button
              title="View leads"
              onPress={() =>
                navigation.navigate("Workspace", { screen: "Leads" })
              }
            />
          }
        />
      )}
      <Grid minWidth={300}>
        {r.data?.items.map((c) => (
          <Card key={c._id}>
            <View style={s.identity}>
              <Avatar name={c.fullName} size={48} />
              <View style={s.identityText}>
                <Text style={s.name}>{c.fullName}</Text>
                <Text style={s.meta}>
                  {c.organization || "Individual contact"}
                </Text>
              </View>
            </View>
            <InfoRow icon="call-outline" label="Phone" value={c.phone} />
            {!!c.email && (
              <InfoRow icon="mail-outline" label="Email" value={c.email} />
            )}
            <Button
              muted
              icon="arrow-forward-outline"
              title="View profile"
              onPress={() => navigation.navigate("Customer", { id: c._id })}
            />
          </Card>
        ))}
      </Grid>
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}

export function CustomerScreen({ route, navigation }) {
  const r = useData(`/customers/${route.params.id}/history`);
  const { bump } = useAuth();
  const d = r.data;
  return (
    <Screen>
      <State resource={r} />
      {!!d && (
        <>
          <PageHeader
            title={d.customer.fullName}
            subtitle={
              d.customer.organization ||
              "Contact details and relationship history."
            }
          />
          <Grid minWidth={190}>
            <MetricCard
              label="Call reports"
              value={d.stats.totalCalls}
              icon="call-outline"
              tone="primary"
            />
            <MetricCard
              label="Answered"
              value={d.stats.answered}
              icon="checkmark-circle-outline"
              tone="success"
            />
            <MetricCard
              label="Missed"
              value={d.stats.missed}
              icon="call-outline"
              tone="warning"
            />
            <MetricCard
              label="Reported talk time"
              value={duration(d.stats.talkSeconds)}
              icon="time-outline"
            />
          </Grid>
          <Body>
            Call metrics include your authorized reports. SIM outcomes and
            durations are self-reported.
          </Body>
          <Grid minWidth={350}>
            <Card icon="person-outline" title="Contact details">
              <Form
                key={d.customer.updatedAt}
                initial={d.customer}
                fields={contactFields}
                submitLabel="Update contact"
                onSubmit={async (v) => {
                  await api.put(`/customers/${d.customer._id}`, v);
                  bump();
                }}
              />
            </Card>
            <View style={{ gap: 20 }}>
              <Card icon="call-outline" title="Recent call reports">
                {!d.calls.length && (
                  <Body>No call reports for this customer yet.</Body>
                )}
                {d.calls.map((c) => (
                  <View key={c._id} style={s.historyItem}>
                    <View style={s.historyHead}>
                      <Badge>{c.status}</Badge>
                      <Text style={s.meta}>
                        {new Date(c.initiatedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={s.meta}>
                      {new Date(c.initiatedAt).toLocaleTimeString()}
                    </Text>
                    <Button
                      muted
                      title="View call report"
                      onPress={() =>
                        navigation.navigate("CallDetails", { id: c._id })
                      }
                    />
                  </View>
                ))}
              </Card>
              <Card icon="calendar-outline" title="Follow-ups">
                {!d.followUps.length && <Body>No follow-ups scheduled.</Body>}
                {d.followUps.map((f) => (
                  <View key={f._id} style={s.historyItem}>
                    <View style={s.historyHead}>
                      <Badge
                        tone={f.status === "completed" ? "success" : "warning"}
                      >
                        {f.status}
                      </Badge>
                    </View>
                    <Text style={s.detail}>
                      {new Date(f.dueAt).toLocaleString()}
                    </Text>
                    {!!f.notes && <Body>{f.notes}</Body>}
                  </View>
                ))}
              </Card>
            </View>
          </Grid>
          <Card icon="time-outline" title="Relationship timeline">
            {!d.activities.length && (
              <Body>
                Your customer’s story is just getting started. Updates will
                appear here.
              </Body>
            )}
            {d.activities.map((a) => (
              <View key={a._id} style={s.timeline}>
                <View style={s.dot} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={s.detail}>{a.type}</Text>
                  {!!a.text && <Body>{a.text}</Body>}
                  <Text style={s.meta}>
                    {new Date(a.createdAt).toLocaleString()}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
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
    gap: 12,
  },
  identity: { flexDirection: "row", gap: 13, alignItems: "center" },
  identityText: { flex: 1, gap: 5, minWidth: 0 },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, lineHeight: 19 },
  detail: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    lineHeight: 22,
  },
  historyItem: {
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 12,
  },
  historyHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  timeline: { flexDirection: "row", gap: 14, paddingVertical: 12 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 6,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
});
