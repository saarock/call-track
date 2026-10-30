import React, { useState } from "react";
import {
  Alert,
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  Ionicons,
} from "../components/Themed";
import { Linking } from "react-native";
import { CallButton } from "./AgentWorkflowScreens";
import AgentFilterSelect from "../components/AgentFilter";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import AgentFilter from "../components/AgentFilter";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Field,
  Select,
  Form,
  Pager,
  PageHeader,
  Avatar,
  EmptyState,
  SectionHeader,
  InfoRow,
  SearchField,
  Grid,
  action,
  confirm,
} from "../components/UI";
import { colors } from "../utils/theme";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

export const contactFields = [
  { key: "fullName", label: "Full name" },
  {
    key: "phone",
    label: "International phone (+country code)",
    keyboardType: "phone-pad",
  },
  { key: "email", label: "Email (optional)", keyboardType: "email-address" },
  { key: "organization", label: "Company (optional)" },
  { key: "address", label: "Address (optional)", multiline: true },
  { key: "serviceType", label: "Service type (optional)" },
  {
    key: "serviceNotes",
    label: "Service requirements / notes",
    multiline: true,
  },
];

function Identity({ name, subtitle }) {
  return (
    <View style={s.identity}>
      <Avatar name={name || "Customer"} size={44} />
      <View style={s.identityText}>
        <Text style={s.name}>{name || "Customer"}</Text>
        {!!subtitle && <Text style={s.meta}>{subtitle}</Text>}
      </View>
    </View>
  );
}

export function LeadsScreen({ navigation }) {
  const { user, settings, bump } = useAuth();
  const [agentId, setAgent] = useState(""),
    [dates, setDates] = useState({});
  const [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  const [status, setStatus] = useState(""),
    [page, setPage] = useState(1);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]),
    [bulkAgent, setBulkAgent] = useState("");
  const [archived, setArchived] = useState(false),
    [showDates, setShowDates] = useState(false);
  const canCreate =
    user.role === "admin" ||
    (user.role === "agent" && settings.agentCanCreateCustomers);
  const r = useData(
    `/leads?page=${page}&agentId=${agentId}${dates.from ? "&from=" + encodeURIComponent(dates.from) : ""}${dates.to ? "&to=" + encodeURIComponent(dates.to) : ""}&q=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&archived=${archived}`,
  );
  function applySearch() {
    setSearch(q);
    setPage(1);
  }
  async function importCSV() {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "text/plain"],
      copyToCacheDirectory: true,
    });
    if (pick.canceled) return;
    const file = pick.assets[0];
    if (file.size > 300000) throw new Error("CSV must be under 300 KB");
    const csv =
      Platform.OS === "web"
        ? await (await fetch(file.uri)).text()
        : await FileSystem.readAsStringAsync(file.uri);
    const { data } = await api.post("/leads/import", { csv });
    const result = data.results
      .map(
        (x) => `Row ${x.row}: ${x.status}${x.message ? " · " + x.message : ""}`,
      )
      .join("\n");
    if (Platform.OS === "web") window.alert("Import results\n\n" + result);
    else Alert.alert("Import results", result);
    bump();
  }
  return (
    <Screen>
      <PageHeader
        title="Leads"

        actions={
          canCreate ? (
            <Button
              icon="add-outline"
              title="Add lead"
              onPress={() => navigation.navigate("NewLead")}
            />
          ) : null
        }
      />
      <Card icon="options-outline" title="Filters">
        <View style={s.searchRow}>
          <View style={s.searchInput}>
            <SearchField
              value={q}
              onChangeText={setQ}
              placeholder="Search a name or phone number"
            />
          </View>
          <Button title="Search" icon="search-outline" onPress={applySearch} />
          <Button
            title={showDates ? "Hide dates" : "Date range"}
            icon="calendar-outline"
            muted
            onPress={() => setShowDates(!showDates)}
          />
        </View>
        <Select
          label="Lead status"
          value={status}
          options={[
            { label: "All statuses", value: "" },
            ...settings.leadStatuses,
          ]}
          onChange={(v) => {
            setStatus(v);
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
        {!!showDates && (
          <View style={s.datePanel}>
            <Body>Filter by creation date. The end date is exclusive.</Body>
            <Form
              key={JSON.stringify(dates)}
              initial={dates}
              fields={[
                { key: "from", label: "From (YYYY-MM-DD)" },
                { key: "to", label: "To (YYYY-MM-DD)" },
              ]}
              submitLabel="Apply date range"
              onSubmit={async (v) => {
                setDates(v);
                setPage(1);
              }}
            />
            {!!(dates.from || dates.to) && (
              <Button
                title="Clear dates"
                muted
                onPress={() => {
                  setDates({});
                  setPage(1);
                }}
              />
            )}
          </View>
        )}
        {!!(user.role === "admin") && (
          <View style={s.toolbar}>
            <Button
              muted
              title={archived ? "View active leads" : "View archived"}
              icon="archive-outline"
              onPress={() => {
                setArchived(!archived);
                setPage(1);
              }}
            />
            <Button
              muted
              title="Import CSV / Excel"
              icon="cloud-upload-outline"
              onPress={() => navigation.navigate("ImportLeads")}
            />
          </View>
        )}
      </Card>

      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        {!!(user.role !== "agent") && (
          <Button
            title={selectMode ? "Done selecting" : "Select contacts"}
            muted
            icon="checkbox-outline"
            onPress={() => {
              setSelectMode(!selectMode);
              if (selectMode) setSelected([]);
            }}
          />
        )}
        <Button
          title="Campaigns"
          muted
          icon="flag-outline"
          onPress={() => navigation.navigate("Campaigns")}
        />
        <Button
          title="Callbacks"
          muted
          icon="calendar-outline"
          onPress={() => navigation.navigate("AllFollowUps")}
        />
      </View>
      {!!(user.role !== "agent" && selected.length > 0) && (
        <Card
          title="Bulk assignment"
          subtitle={selected.length + " selected contacts"}
        >
          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
            <Button
              title="Select this page"
              muted
              onPress={() =>
                setSelected((r.data?.items || []).map((l) => l._id))
              }
            />
            <Button
              title="Clear selection"
              muted
              onPress={() => setSelected([])}
            />
          </View>
          <AgentFilterSelect value={bulkAgent} onChange={setBulkAgent} />
          <Button
            title="Assign selected contacts"
            disabled={!selected.length || !bulkAgent}
            onPress={() =>
              action(async () => {
                const response = await api.post("/leads/bulk-assign", {
                  leadIds: selected,
                  agentId: bulkAgent,
                });
                const errors = response.data.results.filter(
                  (x) => !["assigned", "updated", "success"].includes(x.status),
                );
                if (errors.length)
                  throw new Error(
                    errors.map((x) => x.message || x.status).join("; "),
                  );
                setSelected([]);
                bump();
              })
            }
          />
        </Card>
      )}
      <SectionHeader
        title={archived ? "Archived leads" : "Contacts"}
        subtitle={
          r.data ? `${r.data.total} matching records` : "Your current pipeline"
        }
      />
      <State resource={r} />
      {!!(!r.loading && !r.error && !r.data?.items?.length) && (
        <EmptyState
          icon="people-outline"
          title="No leads"
          description={
            search || status || agentId || dates.from || dates.to
              ? "Try another search or clear the filters."
              : "Add or import contacts to get started."
          }
          action={
            canCreate ? (
              <Button
                title="Add lead"
                onPress={() => navigation.navigate("NewLead")}
              />
            ) : null
          }
        />
      )}
      {!!r.data?.items.length && (
        <Card style={{ padding: 0, gap: 0 }}>
          {r.data.items.map((lead, index) => (
            <View
              key={lead._id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 16,
                borderBottomWidth: index === r.data.items.length - 1 ? 0 : 1,
                borderColor: colors.border,
              }}
            >
              {!!selectMode && (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={"Select " + lead.customerId?.fullName}
                  accessibilityState={{ checked: selected.includes(lead._id) }}
                  onPress={() =>
                    setSelected(
                      selected.includes(lead._id)
                        ? selected.filter((id) => id !== lead._id)
                        : [...selected, lead._id],
                    )
                  }
                  style={{ padding: 6 }}
                >
                  <Ionicons
                    name={
                      selected.includes(lead._id)
                        ? "checkbox"
                        : "square-outline"
                    }
                    size={22}
                    color={
                      selected.includes(lead._id)
                        ? colors.primary
                        : colors.muted
                    }
                  />
                </Pressable>
              )}
              <Avatar name={lead.customerId?.fullName} size={42} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"Open lead " + lead.customerId?.fullName}
                onPress={() =>
                  navigation.navigate("LeadDetails", { id: lead._id })
                }
                style={{ flex: 1, minWidth: 0, gap: 4 }}
              >
                <Text
                  style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}
                >
                  {(page - 1) * 25 + index + 1}.{" "}
                  {lead.customerId?.fullName || lead.customerId?.phone}
                </Text>
                <Text style={s.meta}>{lead.customerId?.phone}</Text>
                <Text style={{ ...s.meta, fontSize: 11 }}>
                  {lead.assignedAgentId?.fullName || "Unassigned"}
                </Text>
              </Pressable>
              <View style={{ gap: 6, alignItems: "flex-end", maxWidth: 120 }}>
                <Badge>{lead.status}</Badge>
                {!!(lead.priority === "High") && (
                  <Badge tone="warning">High priority</Badge>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"View " + lead.customerId?.fullName}
                onPress={() =>
                  navigation.navigate("LeadDetails", { id: lead._id })
                }
                style={{ padding: 8 }}
              >
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.muted}
                />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}

export function NewLeadScreen({ navigation }) {
  const { settings, bump, user } = useAuth();
  const isAgent = user.role === "agent";
  return (
    <Screen>
      <PageHeader title={isAgent ? "Add customer" : "Add a lead"} />
      <Card icon="person-add-outline" title="Contact & opportunity">
        <Form
          initial={{
            priority: "Normal",
            status: isAgent ? "Assigned" : "New",
            source: "Manual",
          }}
          fields={[
            ...contactFields,
            { key: "source", label: "Lead source" },
            {
              key: "priority",
              label: "Priority",
              options: ["Low", "Normal", "High"],
            },
            { key: "status", label: "Status", options: settings.leadStatuses },
          ]}
          submitLabel={isAgent ? "Add customer" : "Create lead"}
          onSubmit={async (v) => {
            const { data } = await api.post("/leads", v);
            bump();
            navigation.replace("LeadDetails", { id: data._id });
          }}
        />
      </Card>
    </Screen>
  );
}

export function LeadDetailsScreen({ route, navigation }) {
  const { id } = route.params;
  const auth = useAuth();
  const r = useData(`/leads/${id}`),
    history = useData(`/leads/${id}/activities?limit=100`);
  const l = r.data;
  const [note, setNote] = useState("");
  return (
    <Screen>
      <State resource={r} />
      {!!l && (
        <>
          <PageHeader
            title={l.customerId.fullName}

            actions={<Badge>{l.archived ? "Archived lead" : l.status}</Badge>}
          />
          <Grid minWidth={310}>
            <Card icon="person-outline" title="Contact">
              <Identity
                name={l.customerId.fullName}
                subtitle={l.customerId.organization || "Individual contact"}
              />
              <View style={s.badges}>
                <Badge>{l.status}</Badge>
                <Badge tone={l.priority === "High" ? "warning" : "neutral"}>
                  {l.priority} priority
                </Badge>
              </View>
              <InfoRow
                icon="call-outline"
                label="Phone"
                value={l.customerId.phone}
              />
              <InfoRow
                icon="mail-outline"
                label="Email"
                value={l.customerId.email || "Not provided"}
              />
              <InfoRow
                icon="person-circle-outline"
                label="Owner"
                value={l.assignedAgentId?.fullName || "Unassigned"}
              />
              <Button
                muted
                title="View customer profile"
                onPress={() =>
                  navigation.navigate("Customer", { id: l.customerId._id })
                }
              />
            </Card>
            <Card icon="arrow-forward-circle-outline" title="Actions">
              {!!(
                auth.user.role === "agent" &&
                !l.archived &&
                !l.customerId.doNotCall
              ) && (
                <CallButton
                  contact={{
                    phone: l.customerId.phone,
                    customerName: l.customerId.fullName,
                    leadId: id,
                  }}
                />
              )}
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                {["whatsapp", "sms"].map((channel) => (
                  <Button
                    key={channel}
                    muted
                    title={channel === "whatsapp" ? "WhatsApp" : "SMS"}
                    onPress={() =>
                      action(async () => {
                        const response = await api.post(
                          "/communications/compose",
                          { leadId: id, channel, text: "" },
                        );
                        await Linking.openURL(response.data.url);
                      })
                    }
                  />
                ))}
              </View>
              <Button
                title="Schedule follow-up"
                icon="calendar-outline"
                onPress={() =>
                  navigation.navigate("NewFollowUp", { leadId: id })
                }
              />
              <Button
                muted
                title="View call reports"
                icon="document-text-outline"
                onPress={() => navigation.navigate("LeadCalls", { leadId: id })}
              />
              {!!(auth.user.role === "admin") && (
                <>
                  <Button
                    muted
                    title="Assign / reassign agent"
                    icon="people-outline"
                    onPress={() => navigation.navigate("AssignLead", { id })}
                  />
                  <Button
                    muted
                    tone="danger"
                    title="Delete lead"
                    onPress={() =>
                      confirm(
                        "Delete this lead? Call history is retained.",
                        () => api.delete("/leads/" + id),
                        () => {
                          auth.bump();
                          navigation.navigate("Workspace", { screen: "Leads" });
                        },
                      )
                    }
                  />
                  <Button
                    muted
                    title={l.archived ? "Restore lead" : "Archive lead"}
                    icon="archive-outline"
                    onPress={() =>
                      confirm(
                        l.archived ? "Restore lead?" : "Archive lead?",
                        () =>
                          api.patch(`/leads/${id}/archive`, {
                            archived: !l.archived,
                          }),
                        auth.bump,
                      )
                    }
                  />
                </>
              )}
            </Card>
          </Grid>
          <Grid minWidth={340}>
            <Card icon="options-outline" title="Lead status">
              <Form
                key={l.updatedAt}
                initial={{
                  status: l.status,
                  priority: l.priority,
                  source: l.source,
                }}
                fields={[
                  {
                    key: "status",
                    label: "Pipeline stage",
                    options: auth.settings.leadStatuses,
                  },
                  {
                    key: "priority",
                    label: "Priority",
                    options: ["Low", "Normal", "High"],
                  },
                  { key: "source", label: "Lead source" },
                ]}
                submitLabel="Save lead details"
                onSubmit={async (v) => {
                  await api.put(`/leads/${id}`, v);
                  auth.bump();
                }}
              />
            </Card>
            <Card icon="create-outline" title="Add a note">
              <Field
                label="Conversation note"
                multiline
                value={note}
                onChangeText={setNote}
              />
              <Button
                title="Save note"
                icon="add-outline"
                onPress={() =>
                  action(async () => {
                    await api.post(`/leads/${id}/notes`, { note });
                    setNote("");
                    auth.bump();
                  })
                }
              />
            </Card>
          </Grid>
          <Card icon="time-outline" title="History">
            <State resource={history} />
            {!!(
              !history.loading &&
              !history.error &&
              !history.data?.items?.length
            ) && (
              <Body>No activity yet. Notes and updates will appear here.</Body>
            )}
            {history.data?.items.map((a) => (
              <View key={a._id} style={s.timelineRow}>
                <View style={s.timelineDot} />
                <View style={s.timelineContent}>
                  <Text style={s.timelineTitle}>
                    {a.type}
                    {a.details?.after ? " → " + a.details.after : ""}
                  </Text>
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

export function AssignLeadScreen({ route, navigation }) {
  const [page, setPage] = useState(1);
  const r = useData(`/users?limit=25&page=${page}`);
  const { bump } = useAuth();
  const agents = (r.data?.items || []).filter(
    (a) => a.active && a.role === "agent",
  );
  return (
    <Screen>
      <PageHeader title="Choose an agent" />
      <State resource={r} />
      {!!(!r.loading && !r.error && !agents.length) && (
        <EmptyState
          icon="people-outline"
          title="No eligible agents on this page"
          description="Only active agent accounts can receive leads. Try the next page or create an agent account."
        />
      )}
      <Grid minWidth={300}>
        {agents.map((a) => (
          <Card key={a._id}>
            <Identity name={a.fullName} subtitle={a.agentCode || "Agent"} />
            <Badge tone="success">Active agent</Badge>
            <InfoRow icon="mail-outline" label="Email" value={a.email} />
            <Button
              title="Assign lead"
              icon="checkmark-outline"
              onPress={() =>
                confirm(
                  `Assign to ${a.fullName}?`,
                  () =>
                    api.patch(`/leads/${route.params.id}/assign`, {
                      agentId: a._id,
                    }),
                  () => {
                    bump();
                    navigation.goBack();
                  },
                )
              }
            />
          </Card>
        ))}
      </Grid>
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}

const s = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metadata: { gap: 10, paddingVertical: 4 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  searchInput: { flex: 1, minWidth: 220 },
  toolbar: { flexDirection: "row", gap: 10, flexWrap: "wrap", paddingTop: 4 },
  datePanel: {
    gap: 14,
    padding: 18,
    backgroundColor: "#F6F7FB",
    borderRadius: 12,
  },
  helper: { fontSize: 12, color: colors.muted, lineHeight: 19 },
  timelineRow: { flexDirection: "row", gap: 14, paddingVertical: 10 },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  timelineContent: {
    flex: 1,
    gap: 5,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timelineTitle: { fontSize: 14, color: colors.ink, fontWeight: "600" },
});
