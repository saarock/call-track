import React, { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Ionicons,
  useWindowDimensions,
} from "../components/Themed";
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useDialer } from "../context/DialerContext";
import { useTheme } from "../context/ThemeContext";
import { fonts } from "../utils/theme";
import { Avatar, Button, action } from "../components/UI";
import AppHeader, { Brand } from "../components/AppHeader";
import { nativePhone, appVariant } from "../services/telecom";
import {
  CampaignsScreen,
  CampaignDetailsScreen,
  ImportLeadsScreen,
} from "../screens/CampaignScreens";
import * as AdminFeatures from "../screens/AdminWorkspaceScreens";
import RecordingsScreen from "../screens/RecordingScreens";
import MonitorScreen from "../screens/MonitorScreen";
import LoginScreen from "../screens/LoginScreen";
import {
  LeadsScreen,
  NewLeadScreen,
  LeadDetailsScreen,
  AssignLeadScreen,
} from "../screens/LeadScreens";
import { AgentEditScreen, AgentsScreen } from "../screens/AgentScreens";
import { CustomerScreen, CustomersScreen } from "../screens/CustomerScreens";
import { NewFollowUpScreen, FollowUpsScreen } from "../screens/FollowUpScreens";
import {
  PasswordScreen,
  CompanySettingsScreen,
  NotificationsScreen,
} from "../screens/SettingsScreen";
import {
  LocalCallDetailsScreen,
  AgentLeadsScreen,
  AgentRecentsScreen,
  TelephoneScreen,
  AgentFollowUpsScreen,
  AgentProfileScreen,
  AfterCallScreen,
  BusinessCallDetailsScreen,
} from "../screens/AgentWorkflowScreens";
import {
  SimpleDashboardScreen,
  AdminCallsScreen,
  AdminCallDetailsScreen,
  SimpleSettingsScreen,
} from "../screens/AdminWorkspaceScreens";
const Stack = createNativeStackNavigator(),
  Tabs = createBottomTabNavigator();
const agentTabs = [
  ["Leads", "Leads", "people-outline", AgentLeadsScreen],
  ["Recents", "Recents", "time-outline", AgentRecentsScreen],
  ["Dialer", "Dialer", "keypad-outline", TelephoneScreen],
  ["FollowUps", "Follow-ups", "calendar-outline", AgentFollowUpsScreen],
  ["Profile", "Profile", "person-circle-outline", AgentProfileScreen],
];
const adminTabs = [
  ["Dashboard", "Dashboard", "grid-outline", SimpleDashboardScreen],
  ["Leads", "Leads", "people-outline", LeadsScreen],
  ["Agents", "Agents", "headset-outline", AgentsScreen],
  ["Calls", "Calls", "call-outline", AdminCallsScreen],
  ["Settings", "Settings", "settings-outline", SimpleSettingsScreen],
];
const titles = {
  LocalCallDetails: "Call details",
  Recordings: "Recordings",
  LiveMonitoring: "Live monitoring",
  Campaigns: "Campaigns",
  CampaignDetails: "Campaign details",
  ImportLeads: "Import contacts",
  Analytics: "Reports & performance",
  AuditLog: "Audit logs",
  Integrations: "Integrations",
  MyPerformance: "My performance",
  NewLead: "Add lead",
  LeadDetails: "Customer details",
  AssignLead: "Assign agent",
  AgentEdit: "Agent account",
  Customer: "Customer history",
  NewFollowUp: "Schedule callback",
  AfterCall: "Call result",
  CallDetails: "Call details",
  LeadCalls: "Call history",
  Password: "Change password",
  CompanySettings: "Company settings",
  Notifications: "Notifications",
  Customers: "Customers",
  AllFollowUps: "Follow-ups",
};
const parents = {
  NewLead: "Leads",
  LeadDetails: "Leads",
  AssignLead: "Leads",
  AgentEdit: "Agents",
  Customer: "Leads",
  Customers: "Leads",
  NewFollowUp: "FollowUps",
  AfterCall: "Leads",
  CallDetails: "Calls",
  LeadCalls: "Calls",
  Password: "Settings",
  CompanySettings: "Settings",
  Notifications: "Settings",
  AllFollowUps: "Dashboard",
};

function MobileTabs({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: "#FFFFFF",
        borderTopWidth: 1,
        borderColor: "#E8EBF2",
        paddingTop: 10,
        paddingBottom: Math.max(10, insets.bottom),
      }}
    >
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const option = descriptors[route.key].options;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={option.title || route.name}
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const e = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!e.defaultPrevented) navigation.navigate(route.name);
            }}
            style={{
              flex: 1,
              alignItems: "center",
              gap: 6,
              paddingVertical: 3,
            }}
          >
            <Ionicons
              name={option.icon}
              size={23}
              color={focused ? "#169B80" : "#7B8497"}
            />
            <Text
              style={{
                fontSize: 10,
                fontWeight: focused ? "700" : "500",
                color: focused ? "#169B80" : "#7B8497",
              }}
            >
              {option.title || route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Workspace({ desktop, agent }) {
  const tabs = agent ? agentTabs : adminTabs;
  return (
    <Tabs.Navigator
      tabBar={desktop ? () => null : (props) => <MobileTabs {...props} />}
      screenOptions={{
        headerShown: !desktop,
        header: ({ navigation }) => <AppHeader agent={agent} onNotifications={() => navigation.getParent()?.navigate("Notifications")} />,
      }}
    >
      {tabs.map(([name, title, icon, component]) => (
        <Tabs.Screen
          key={name}
          name={name}
          component={component}
          options={{ title, icon }}
        />
      ))}
    </Tabs.Navigator>
  );
}
export default function RootNavigator() {
  const auth = useAuth(),
    d = useDialer(),
    theme = useTheme(),
    nav = useNavigationContainerRef(),
    { width } = useWindowDimensions();
  const desktop = width >= 1024,
    agent = auth.user?.role === "agent";
  const [current, setCurrent] = useState(""),
    [ready, setReady] = useState(false),
    [publicPhone, setPublicPhone] = useState(false);
  const shown = useRef(new Set()),
    dialSeen = useRef(null),
    leadSeen = useRef(null);
  useEffect(() => {
    if (d.dialRequest && dialSeen.current !== d.dialRequest.key) {
      if (auth.user && ready) {
        dialSeen.current = d.dialRequest.key;
        nav.navigate("Workspace", {
          screen: "Dialer",
          params: { phone: d.dialRequest.phone },
        });
      } else if (!auth.user) {
        dialSeen.current = d.dialRequest.key;
        setPublicPhone(true);
      }
    }
  }, [d.dialRequest, auth.user, ready]);
  useEffect(() => {
    if (!ready || !agent || AppState.currentState !== "active") return;
    if (d.leadRequest && leadSeen.current !== d.leadRequest.key) {
      leadSeen.current = d.leadRequest.key;
      nav.navigate("LeadDetails", { id: d.leadRequest.id });
      return;
    }
    const draft = d.pendingReports.find((item) => !shown.current.has(item.key));
    if (draft && current !== "AfterCall" && !d.capabilities.activeCallCount) {
      shown.current.add(draft.key);
      nav.navigate("AfterCall", { key: draft.key });
    }
  }, [
    ready,
    agent,
    d.resume,
    d.pendingReports.map((v) => v.key).join("|"),
    d.leadRequest?.key,
    d.capabilities.activeCallCount,
    current,
  ]);
  const nativeAgent = Boolean(nativePhone) && appVariant() === "agent";
  if ((publicPhone && !auth.user) || (auth.loading && nativeAgent)) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingTop: 32,
        }}
      >
        <TelephoneScreen
          publicMode
          onClose={auth.loading ? undefined : () => setPublicPhone(false)}
        />
      </View>
    );
  }
  if (auth.loading)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  const tabs = agent ? agentTabs : adminTabs;
  const go = (name) => {
    if (nav.isReady()) nav.navigate("Workspace", { screen: name });
  };
  const active = parents[current] || current;
  const pageTitle =
    (current === "NewLead" && agent ? "Add customer" : titles[current]) || tabs.find(([name]) => name === active)?.[1] || "";
  return (
    <NavigationContainer
      ref={nav}
      onReady={() => {
        setReady(true);
        setCurrent(nav.getCurrentRoute()?.name || "");
      }}
      onStateChange={() => setCurrent(nav.getCurrentRoute()?.name || "")}
      theme={{
        ...DefaultTheme,
        dark: theme.isDark,
        fonts: {
          regular: { fontFamily: fonts.regular, fontWeight: "normal" },
          medium: { fontFamily: fonts.medium, fontWeight: "normal" },
          bold: { fontFamily: fonts.bold, fontWeight: "normal" },
          heavy: { fontFamily: fonts.extraBold, fontWeight: "normal" },
        },
        colors: {
          ...DefaultTheme.colors,
          primary: theme.colors.primary,
          background: theme.colors.background,
          card: theme.colors.surface,
          border: theme.colors.border,
          text: theme.colors.ink,
        },
      }}
    >
      <View
        style={{ flex: 1, flexDirection: "row", backgroundColor: "#F6F7FB" }}
      >
        {!!(auth.user && desktop) && (
          <View
            style={{
              width: 232,
              padding: 20,
              backgroundColor: "#151C30",
              gap: 30,
            }}
          >
            <View style={{ paddingVertical: 12 }}>
              <Brand agent={agent} inverse />
            </View>
            <View style={{ gap: 7, flex: 1 }}>
              {tabs.map(([name, title, icon]) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  accessibilityState={{ selected: active === name }}
                  onPress={() => go(name)}
                  style={({ hovered }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 13,
                    padding: 15,
                    borderRadius: 12,
                    backgroundColor:
                      active === name
                        ? "#263B42"
                        : hovered
                          ? "#202A41"
                          : "transparent",
                  })}
                >
                  <Ionicons
                    name={icon}
                    size={20}
                    color={active === name ? "#69D6B5" : "#A6B4CB"}
                  />
                  <Text
                    style={{
                      color: active === name ? "#FFFFFF" : "#A6B4CB",
                      fontSize: 13,
                      fontWeight: active === name ? "600" : "400",
                    }}
                  >
                    {title}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => go(agent ? "Profile" : "Settings")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 12,
                borderTopWidth: 1,
                borderColor: "#303950",
              }}
            >
              <Avatar
                name={auth.user.fullName}
                size={38}
                style={{ borderRadius: 20 }}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}
                >
                  {auth.user.fullName}
                </Text>
                <Text style={{ color: "#A6B4CB", fontSize: 10 }}>
                  {auth.connected ? "Connected" : "Offline / reconnecting"}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {!!(auth.user && desktop) && (
            <AppHeader desktop agent={agent} title={pageTitle}
              onBack={titles[current] ? () => nav.canGoBack() ? nav.goBack() : go(agent ? "Leads" : "Dashboard") : undefined}
              onNotifications={() => nav.navigate("Notifications")}
              onProfile={() => go(agent ? "Profile" : "Settings")}
              fullName={auth.user.fullName}
            />
          )}
          {!!(agent && d.capabilities.activeCallCount > 0) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to active phone call"
              onPress={() => action(d.showPhone)}
              style={{
                backgroundColor: "#169B80",
                padding: 11,
                alignItems: "center",
              }}
            >
              <Text
                style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}
              >
                Phone call in progress · Return to call
              </Text>
            </Pressable>
          )}
          <Stack.Navigator
            screenOptions={{
              headerShown: !desktop,
              header: ({ navigation, options, back }) => <AppHeader agent={agent} title={options.title} onBack={back ? () => navigation.goBack() : undefined} onNotifications={() => navigation.navigate("Notifications")} />,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            {!auth.user ? (
              <Stack.Screen name="Login" options={{ headerShown: false }}>
                {() => (
                  <View style={{ flex: 1 }}>
                    <LoginScreen />
                    {!!nativeAgent && (
                      <Button
                        title="Open phone dialer"
                        icon="keypad"
                        muted
                        onPress={() => setPublicPhone(true)}
                        style={{ margin: 12 }}
                      />
                    )}
                  </View>
                )}
              </Stack.Screen>
            ) : (
              <>
                <Stack.Screen name="Workspace" options={{ headerShown: false }}>
                  {() => <Workspace desktop={desktop} agent={agent} />}
                </Stack.Screen>
                {Object.entries({
                  LocalCallDetails: LocalCallDetailsScreen,
                  Recordings: RecordingsScreen,
                  LiveMonitoring: MonitorScreen,
                  Campaigns: CampaignsScreen,
                  CampaignDetails: CampaignDetailsScreen,
                  ImportLeads: ImportLeadsScreen,
                  ...(AdminFeatures.AnalyticsScreen
                    ? { Analytics: AdminFeatures.AnalyticsScreen }
                    : {}),
                  ...(AdminFeatures.AuditLogScreen
                    ? { AuditLog: AdminFeatures.AuditLogScreen }
                    : {}),
                  ...(AdminFeatures.IntegrationsScreen
                    ? { Integrations: AdminFeatures.IntegrationsScreen }
                    : {}),
                  ...(AdminFeatures.MyPerformanceScreen
                    ? { MyPerformance: AdminFeatures.MyPerformanceScreen }
                    : {}),
                  NewLead: NewLeadScreen,
                  LeadDetails: LeadDetailsScreen,
                  AssignLead: AssignLeadScreen,
                  AgentEdit: AgentEditScreen,
                  Customer: CustomerScreen,
                  Customers: CustomersScreen,
                  NewFollowUp: NewFollowUpScreen,
                  AllFollowUps: FollowUpsScreen,
                  AfterCall: AfterCallScreen,
                  CallDetails: agent
                    ? BusinessCallDetailsScreen
                    : AdminCallDetailsScreen,
                  LeadCalls: agent ? AgentRecentsScreen : AdminCallsScreen,
                  Password: PasswordScreen,
                  CompanySettings: CompanySettingsScreen,
                  Notifications: NotificationsScreen,
                }).map(([name, component]) => (
                  <Stack.Screen
                    name={name}
                    key={name}
                    component={component}
                    options={{ title: name === "NewLead" && agent ? "Add customer" : titles[name] }}
                  />
                ))}
              </>
            )}
          </Stack.Navigator>
        </View>
      </View>
    </NavigationContainer>
  );
}