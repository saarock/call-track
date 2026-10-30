import React, { useState } from "react";
import { View, Text, StyleSheet, Switch } from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Form,
  Pager,
  confirm,
  PageHeader,
  Avatar,
  EmptyState,
  Grid,
  InfoRow,
  Notice,
  Select,
} from "../components/UI";
import { colors } from "../utils/theme";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
const fields = [
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email", keyboardType: "email-address" },
  { key: "phone", label: "Phone number (optional)", keyboardType: "phone-pad" },
  { key: "agentCode", label: "Employee ID" },
];
export function AgentsScreen({ navigation }) {
  const [page, setPage] = useState(1),
    auth = useAuth(),
    r = useData("/users?page=" + page),
    admin = auth.user.role === "admin";
  return (
    <Screen>
      <PageHeader
        title={admin ? "Agents & supervisors" : "Your agents"}
        subtitle={
          admin
            ? "Manage private company accounts, team access and lead assignments."
            : "Activity and performance for your assigned team."
        }
        actions={
          admin ? (
            <Button
              title="Create account"
              icon="person-add-outline"
              onPress={() => navigation.navigate("AgentEdit")}
            />
          ) : null
        }
      />
      <State resource={r} />
      {!!(!r.loading && !r.data?.items?.length) && (
        <EmptyState
          icon="people-outline"
          title="No team members"
          description={
            admin
              ? "Create an agent account to begin assigning customer numbers."
              : "Ask an administrator to assign agents to your supervisor account."
          }
        />
      )}
      <Grid minWidth={300}>
        {r.data?.items.map((a) => (
          <Card key={a._id}>
            <View style={s.identity}>
              <Avatar
                name={a.fullName}
                size={49}
                style={{ borderRadius: 26 }}
              />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={s.name}>{a.fullName}</Text>
                <Text style={s.meta}>{a.agentCode}</Text>
              </View>
            </View>
            <View style={s.badges}>
              <Badge tone={a.active ? "success" : "neutral"}>
                {a.active ? "Active" : "Disabled"}
              </Badge>
              <Badge>
                {a.role === "admin"
                  ? "Administrator"
                  : a.role === "supervisor"
                    ? "Supervisor"
                    : "Agent"}
              </Badge>
            </View>
            <InfoRow label="Email" value={a.email} />
            {!!(a.role === "agent") && (
              <>
                <View style={s.stats}>
                  {[
                    ["Leads", a.assignedLeads || 0],
                    ["Observed calls", a.totalCalls || 0],
                    ["Talk min", Math.floor((a.talkSeconds || 0) / 60)],
                  ].map(([name, value]) => (
                    <View key={name} style={s.stat}>
                      <Text style={s.statValue}>{value}</Text>
                      <Text style={s.statLabel}>{name}</Text>
                    </View>
                  ))}
                </View>
                <Button
                  title="View call performance"
                  muted
                  onPress={() =>
                    navigation.navigate("Workspace", {
                      screen: "Calls",
                      params: { agentId: a._id },
                    })
                  }
                />
              </>
            )}
            {!!(admin && a.role !== "admin") && (
              <Button
                title={
                  a.role === "supervisor" ? "Manage supervisor" : "Manage agent"
                }
                muted
                icon="create-outline"
                onPress={() =>
                  navigation.navigate("AgentEdit", { id: a._id, agent: a })
                }
              />
            )}
          </Card>
        ))}
      </Grid>
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}
function SupervisorTeam({ account, onSaved }) {
  const members = useData("/users?role=agent&limit=100"),
    campaigns = useData("/campaigns?limit=100");
  const [agents, setAgents] = useState(
      (account.supervisedAgentIds || []).map(String),
    ),
    [assigned, setAssigned] = useState(
      (account.assignedCampaignIds || []).map(String),
    );
  const toggle = (set, id, checked) =>
    set((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((value) => value !== id),
    );
  return (
    <Card title="Supervisor team">
      <State resource={members} />
      {members.data?.items?.map((a) => (
        <View key={a._id} style={s.identity}>
          <Switch
            accessibilityLabel={"Supervise " + a.fullName}
            value={agents.includes(a._id)}
            onValueChange={(checked) => toggle(setAgents, a._id, checked)}
          />
          <Text style={s.name}>{a.fullName}</Text>
        </View>
      ))}
      <Text style={s.name}>Assigned campaigns</Text>
      <State resource={campaigns} />
      {campaigns.data?.items?.map((c) => (
        <View key={c._id} style={s.identity}>
          <Switch
            accessibilityLabel={"Manage campaign " + c.name}
            value={assigned.includes(c._id)}
            onValueChange={(checked) => toggle(setAssigned, c._id, checked)}
          />
          <Text style={s.name}>{c.name}</Text>
        </View>
      ))}
      <Button
        title="Save supervisor access"
        onPress={() =>
          confirm(
            "Update supervisor access and sign out existing sessions?",
            () =>
              api.put("/users/" + account._id + "/team", {
                agentIds: agents,
                campaignIds: assigned,
              }),
            onSaved,
          )
        }
      />
    </Card>
  );
}
export function AgentEditScreen({ route, navigation }) {
  const account = route.params?.agent,
    auth = useAuth();
  const done = () => {
    auth.bump();
    navigation.goBack();
  };
  if (auth.user.role !== "admin")
    return (
      <Screen>
        <Notice>Only administrators can change employee accounts.</Notice>
      </Screen>
    );
  return (
    <Screen>
      <PageHeader
        title={
          account
            ? "Manage " +
              (account.role === "supervisor" ? "supervisor" : "agent")
            : "Create employee account"
        }
      />
      <Card title="Account information">
        <Form
          initial={account || { role: "agent" }}
          fields={[
            ...fields,
            ...(!account
              ? [
                  {
                    key: "role",
                    label: "Role",
                    options: [
                      { label: "Agent", value: "agent" },
                      { label: "Supervisor", value: "supervisor" },
                    ],
                  },
                  {
                    key: "password",
                    label: "Initial password (12–72 characters)",
                    secure: true,
                  },
                ]
              : []),
          ]}
          submitLabel={account ? "Save account changes" : "Create account"}
          onSubmit={async (v) => {
            if (account) await api.put("/users/" + account._id, v);
            else await api.post("/users", v);
            done();
          }}
        />
      </Card>
      {!!(account?.role === "supervisor") && (
        <SupervisorTeam account={account} onSaved={done} />
      )}
      {!!account && (
        <>
          <Card title="Reset password">
            <Form
              fields={[
                {
                  key: "password",
                  label: "New password (12–72 characters)",
                  secure: true,
                },
              ]}
              submitLabel="Reset employee password"
              onSubmit={async (values) => {
                await api.patch("/users/" + account._id + "/password", values);
                done();
              }}
            />
          </Card>
          <Card title="Account access">
            <Badge tone={account.active ? "success" : "neutral"}>
              {account.active ? "Enabled" : "Disabled"}
            </Badge>
            <Body>
              Call records and customer history are retained when an employee is
              disabled or removed. Active calls must be finished, and customer
              leads reassigned before removing an account.
            </Body>
            <Button
              title={account.active ? "Deactivate account" : "Activate account"}
              muted
              onPress={() =>
                confirm(
                  "Change employee account access?",
                  () =>
                    api.patch("/users/" + account._id + "/status", {
                      active: !account.active,
                    }),
                  done,
                )
              }
            />
            <Button
              title="Remove employee account"
              muted
              tone="danger"
              onPress={() =>
                confirm(
                  "Remove this employee's access? Their history will be retained.",
                  () => api.delete("/users/" + account._id),
                  done,
                )
              }
            />
          </Card>
        </>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, lineHeight: 19 },
  badges: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  stats: {
    flexDirection: "row",
    backgroundColor: colors.background,
    paddingVertical: 16,
    borderRadius: 12,
  },
  stat: { flex: 1, alignItems: "center", gap: 5 },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.ink },
  statLabel: { fontSize: 10, color: colors.muted },
});
