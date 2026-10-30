import React, { useEffect, useState } from "react";
import { View, Text } from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  PageHeader,
  Button,
  Body,
  Badge,
  State,
  Avatar,
  Grid,
  EmptyState,
  duration,
} from "../components/UI";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { localTime } from "../utils/dateTime";
export default function MonitorScreen({ navigation }) {
  const r = useData("/monitor"),
    auth = useAuth(),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const agents = (r.data?.items || []).filter(
    (agent) => agent.role === "agent",
  );
  const [received, setReceived] = useState(Date.now());
  useEffect(() => setReceived(Date.now()), [r.data?.serverTime]);
  const serverNow =
    now + (r.data?.serverTime ? +new Date(r.data.serverTime) - received : 0);
  function fresh(agent) {
    return (
      agent.call?.source === "android-telecom" &&
      agent.call.deviceActive &&
      serverNow - +new Date(agent.phoneObservedAt) < 45000
    );
  }
  const onCall = agents.filter(
    (agent) =>
      fresh(agent) && ["ACTIVE", "HOLDING"].includes(agent.call.deviceState),
  ).length;
  return (
    <Screen>
      <PageHeader
        title="Live monitoring"
        actions={
          <Button title="Refresh" muted icon="refresh" onPress={r.refresh} />
        }
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Badge tone={auth.connected ? "success" : "warning"}>
          {auth.connected ? "Live updates" : "Updates disconnected"}
        </Badge>
        <Body>
          {agents.filter((a) => a.online).length} online ·{" "}
          {agents.length - agents.filter((a) => a.online).length} offline ·{" "}
          {onCall} verified on call
        </Body>
      </View>
      <State resource={r} />
      <Grid minWidth={330}>
        {agents.map((agent) => {
          const call = agent.call,
            current = fresh(agent),
            connected =
              current &&
              call.answeredAt &&
              ["ACTIVE", "HOLDING"].includes(call.deviceState);
          const seconds = connected
            ? Math.max(
                0,
                Math.floor((serverNow - new Date(call.answeredAt)) / 1000),
              )
            : null;
          const state = current
            ? {
                ACTIVE: "On call",
                HOLDING: "On hold",
                RINGING: "Incoming",
                DIALING: "Dialing",
                CONNECTING: "Connecting",
                SELECT_PHONE_ACCOUNT: "Selecting SIM",
              }[call.deviceState] || "Phone active"
            : call?.source === "android-telecom"
              ? "Phone state unavailable"
              : call
                ? "Awaiting report · unverified"
                : agent.online
                  ? "CRM " + agent.availability
                  : "Offline";
          return (
            <Card key={agent._id}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <Avatar name={agent.fullName} size={42} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: "#17223B",
                    }}
                  >
                    {agent.fullName}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#7B8497" }}>
                    {agent.agentCode} ·{" "}
                    {agent.online ? "CRM online" : "CRM offline"}
                  </Text>
                </View>
                <Badge tone={current ? "success" : "neutral"}>{state}</Badge>
              </View>
              {!!call && (
                <View style={{ gap: 6 }}>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: "#17223B",
                    }}
                  >
                    {call.customerId?.fullName || call.phone}
                  </Text>
                  <Body>
                    {call.phone} · {call.direction || "Direction unavailable"}
                  </Body>
                  {!!call.campaignId?.name && (
                    <Body>{call.campaignId.name}</Body>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 15,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 24,
                        fontWeight: "600",
                        color: "#17223B",
                      }}
                    >
                      {seconds === null ? "—" : duration(seconds)}
                    </Text>
                    <Text style={{ fontSize: 11, color: "#7B8497" }}>
                      {connected
                        ? "Connected duration"
                        : current
                          ? "No observed connection"
                          : "No verified live duration"}
                    </Text>
                  </View>
                  {!!(current && call.initiatedAt) && (
                    <Body>Started {localTime(call.initiatedAt)}</Body>
                  )}
                </View>
              )}
              <View style={{ gap: 5 }}>
                <Text style={{ fontSize: 11, color: "#7B8497" }}>
                  Phone sync: {localTime(agent.phoneObservedAt)}
                </Text>
                <Text style={{ fontSize: 11, color: "#7B8497" }}>
                  Last recorded activity:{" "}
                  {localTime(
                    call?.deviceObservedAt ||
                      agent.lastCallAt ||
                      agent.lastLoginAt,
                  )}
                </Text>
              </View>
              {!!call?.leadId && (
                <Button
                  title="Customer details"
                  muted
                  compact
                  onPress={() =>
                    navigation.navigate("LeadDetails", {
                      id: call.leadId._id || call.leadId,
                    })
                  }
                />
              )}
            </Card>
          );
        })}
      </Grid>
      {!!(!r.loading && !agents.length) && (
        <EmptyState
          icon="headset-outline"
          title="No agents in this view"
          description="Assign agents to this team to see their activity."
        />
      )}
    </Screen>
  );
}
