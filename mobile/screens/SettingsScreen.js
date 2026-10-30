import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "../components/Themed";
import { Ionicons } from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  State,
  Form,
  Select,
  Pager,
  action,
  confirm,
  PageHeader,
  Avatar,
  EmptyState,
  Grid,
  Notice,
  InfoRow,
} from "../components/UI";
import { useAuth } from "../context/AuthContext";
import { useData } from "../hooks/useData";
import { api } from "../services/api";
import { ThemeOptions } from "../components/ThemeToggle";

function SettingsLink({ icon, title, description, onPress, danger = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        s.settingsLink,
        pressed && { backgroundColor: "#F6F7FB" },
      ]}
    >
      <View style={[s.linkIcon, danger && { backgroundColor: "#FFF1F1" }]}>
        <Ionicons
          name={icon}
          size={19}
          color={danger ? "#C44747" : "#147D70"}
        />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={[s.linkTitle, danger && { color: "#C44747" }]}>
          {title}
        </Text>
        <Text style={s.linkDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color="#A4ACBD" />
    </Pressable>
  );
}

export default function SettingsScreen({ navigation }) {
  const auth = useAuth();
  return (
    <Screen>
      <PageHeader title="Settings" />
      <Card>
        <View style={s.profile}>
          <Avatar name={auth.user.fullName} size={70} />
          <View style={{ flex: 1, gap: 8, minWidth: 190 }}>
            <Text style={s.profileName}>{auth.user.fullName}</Text>
            <Body>{auth.user.email}</Body>
            <View style={s.badges}>
              <Badge>
                {auth.user.role === "admin" ? "Workspace admin" : "Team member"}
              </Badge>
              <Badge>
                {auth.callMode === "demo" ? "Demo workspace" : "SIM calling"}
              </Badge>
            </View>
          </View>
          <View style={s.memberCode}>
            <Text style={s.overline}>MEMBER CODE</Text>
            <Text style={s.code}>{auth.user.agentCode}</Text>
          </View>
        </View>
      </Card>
      <Card
        title="Appearance"

        icon="color-palette-outline"
      >
        <ThemeOptions />
      </Card>
      <Grid minWidth={340}>
        <Card
          title="Your availability"

          icon="radio-outline"
        >
          <Select
            label="Current status"
            value={auth.user.availability}
            options={["Available", "Busy", "On Break", "Online"]}
            onChange={(value) =>
              action(async () => {
                await api.patch("/users/me/availability", {
                  availability: value,
                });
                await auth.refreshSession();
                auth.bump();
              })
            }
          />
          <View style={s.connection}>
            <View
              style={[
                s.dot,
                { backgroundColor: auth.connected ? "#12A57B" : "#D99A32" },
              ]}
            />
            <Text style={s.connectionText}>
              {auth.connected
                ? "Connected to your workspace"
                : "Reconnecting to your workspace"}
            </Text>
          </View>
        </Card>
        <Card
          title="Account"

          icon="person-circle-outline"
        >
          <SettingsLink
            icon="lock-closed-outline"
            title="Change password"
            description="Update the password for your account."
            onPress={() => navigation.navigate("Password")}
          />
          <SettingsLink
            icon="notifications-outline"
            title="Notifications"
            description="Stay on top of your team's latest updates."
            onPress={() => navigation.navigate("Notifications")}
          />
        </Card>
      </Grid>
      {!!(auth.user.role === "admin") && (
        <Card
          title="Workspace management"

          icon="business-outline"
        >
          <Grid minWidth={280}>
            <SettingsLink
              icon="options-outline"
              title="Company settings"
              description="Company details, timezone and lead pipeline."
              onPress={() => navigation.navigate("CompanySettings")}
            />
            <SettingsLink
              icon="people-outline"
              title="Manage agents"
              description="People, permissions and account access."
              onPress={() => navigation.navigate("Agents")}
            />
          </Grid>
        </Card>
      )}
      <Card title="Session" icon="shield-checkmark-outline">
        <SettingsLink
          icon="log-out-outline"
          title="Sign out on all devices"
          description="End your active CallTrack sessions."
          danger
          onPress={() => confirm("Sign out?", auth.logout)}
        />
      </Card>
    </Screen>
  );
}

export function CompanySettingsScreen() {
  const auth = useAuth();
  const r = useData("/settings");
  return (
    <Screen>
      <PageHeader title="Company settings" />
      <State resource={r} />
      {!!r.data && (
        <Card
          title="Workspace preferences"

          icon="business-outline"
        >
          <Form
            key={r.data.updatedAt}
            initial={{
              ...r.data,
              leadStatuses: r.data.leadStatuses.join(", "),
            }}
            fields={[
              { key: "name", label: "Company name" },
              {
                key: "timezone",
                label: "Timezone (for example, Asia/Kathmandu)",
              },
              {
                key: "agentCanCreateCustomers",
                label: "Allow agents to add customers",
                boolean: true,
              },
              {
                key: "leadStatuses",
                label: "Lead pipeline stages, separated by commas",
                multiline: true,
              },
            ]}
            submitLabel="Save workspace settings"
            onSubmit={async (values) => {
              await api.put("/settings", {
                ...values,
                leadStatuses: values.leadStatuses
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              });
              await auth.refreshSession();
              auth.bump();
            }}
          />
        </Card>
      )}
      <Notice title="How SIM calling works" icon="call-outline">
        The Android dialer records observed call states and timing when
        configured as the default phone app. Agents save business outcomes
        separately. Existing authorized audio files can be attached when
        recording storage is enabled.
      </Notice>
    </Screen>
  );
}

export function PasswordScreen() {
  const auth = useAuth();
  return (
    <Screen>
      <PageHeader title="Change password" />
      <Card
        title="Set a new password"

        icon="lock-closed-outline"
      >
        <Form
          fields={[
            { key: "currentPassword", label: "Current password", secure: true },
            { key: "newPassword", label: "New password", secure: true },
          ]}
          onSubmit={async (values) => {
            await api.put("/auth/password", values);
            await auth.clear();
          }}
          submitLabel="Update password and sign out"
        />
      </Card>
      <Notice
        title="You will need to sign in again"
        icon="information-circle-outline"
      >
        Updating your password ends your existing sessions. Use your new
        password the next time you sign in.
      </Notice>
    </Screen>
  );
}

export function NotificationsScreen({ navigation }) {
  const [page, setPage] = useState(1);
  const r = useData("/notifications?page=" + page);
  const { bump } = useAuth();
  const items = r.data?.items || [];
  return (
    <Screen>
      <PageHeader title="Notifications" />
      <State resource={r} />
      {!!(!r.loading && !r.error && !items.length) && (
        <EmptyState
          icon="notifications-outline"
          title="You're all caught up"
          description="New assignments and workspace updates will appear here."
        />
      )}
      {items.map((notification) => (
        <Card key={notification._id}>
          <View style={s.notification}>
            <View
              style={[
                s.linkIcon,
                !notification.readAt && { backgroundColor: "#E9F8F3" },
              ]}
            >
              <Ionicons
                name={
                  notification.readAt
                    ? "mail-open-outline"
                    : "notifications-outline"
                }
                size={22}
                color={notification.readAt ? "#8B94A7" : "#147D70"}
              />
            </View>
            <View style={{ flex: 1, gap: 11 }}>
              <View style={s.badges}>
                <Badge>{notification.readAt ? "Read" : "New update"}</Badge>
                <Text style={s.notificationDate}>
                  {new Date(notification.createdAt).toLocaleString()}
                </Text>
              </View>
              <Text style={s.notificationText}>{notification.text}</Text>
              <View style={s.badges}>
                {!notification.readAt && (
                  <Button
                    muted
                    title="Mark read"
                    onPress={() =>
                      action(
                        () =>
                          api.patch(
                            "/notifications/" + notification._id + "/read",
                          ),
                        bump,
                      )
                    }
                  />
                )}
                {!!notification.leadId && (
                  <Button
                    muted
                    title="Open lead"
                    onPress={() =>
                      navigation.navigate("LeadDetails", {
                        id: notification.leadId,
                      })
                    }
                  />
                )}
              </View>
            </View>
          </View>
        </Card>
      ))}
      {!!r.data?.total && <Pager page={page} setPage={setPage} data={r.data} />}
    </Screen>
  );
}

const s = StyleSheet.create({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 20,
    paddingVertical: 8,
  },
  profileName: {
    fontSize: 23,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: "#17223B",
  },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 9,
  },
  memberCode: {
    paddingHorizontal: 21,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: "#F7F8FC",
    gap: 7,
  },
  overline: {
    color: "#8992A5",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  code: { color: "#39445D", fontSize: 14, fontWeight: "700" },
  settingsLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 5,
    gap: 14,
    borderRadius: 10,
  },
  linkIcon: {
    width: 43,
    height: 43,
    borderRadius: 12,
    backgroundColor: "#F1F0FD",
    alignItems: "center",
    justifyContent: "center",
  },
  linkTitle: { color: "#29344D", fontSize: 13, fontWeight: "600" },
  linkDescription: { color: "#8B93A4", fontSize: 11, lineHeight: 18 },
  connection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 12,
    paddingTop: 17,
    borderTopColor: "#E8EBF2",
    borderTopWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  connectionText: { fontSize: 11, color: "#7B8497" },
  notification: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  notificationDate: { color: "#929BAD", fontSize: 10 },
  notificationText: { color: "#35405A", fontSize: 14, lineHeight: 23 },
});
