import React, { useState, useEffect } from "react";
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { View, Text, Pressable } from "../components/Themed";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  PageHeader,
  Body,
  Button,
  Field,
  Select,
  State,
  EmptyState,
  Pager,
  Badge,
  Form,
  action,
  Notice,
} from "../components/UI";
import { useData } from "../hooks/useData";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
export function CampaignsScreen({ navigation }) {
  const auth = useAuth(),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const r = useData("/campaigns?page=" + page);
  return (
    <Screen>
      <PageHeader
        title="Campaigns"

        actions={
          auth.user.role === "admin" ? (
            <Button
              title="New campaign"
              icon="add"
              onPress={() => setCreating(!creating)}
            />
          ) : null
        }
      />
      {!!creating && (
        <Card title="Create campaign">
          <Form
            fields={[
              { key: "name", label: "Campaign name" },
              { key: "serviceType", label: "Service type" },
              { key: "description", label: "Description", multiline: true },
            ]}
            submitLabel="Create campaign"
            onSubmit={async (values) => {
              await api.post("/campaigns", values);
              setCreating(false);
              auth.bump();
            }}
          />
        </Card>
      )}
      <State resource={r} />
      {r.data?.items.map((c) => (
        <Card key={c._id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text
                style={{ fontSize: 18, fontWeight: "600", color: "#17223B" }}
              >
                {c.name}
              </Text>
              <Body>
                {c.serviceType || c.description || "Calling campaign"}
              </Body>
            </View>
            <Badge>{c.status}</Badge>
          </View>
          <Body>
            {c.counts?.total || 0} contacts · {c.counts?.called || 0} called ·{" "}
            {c.counts?.remaining || 0} remaining
          </Body>
          <Button
            title="Open campaign"
            muted
            onPress={() =>
              navigation.navigate("CampaignDetails", { id: c._id, campaign: c })
            }
          />
        </Card>
      ))}
      {!!(!r.loading && !r.data?.items.length) && (
        <EmptyState
          icon="flag-outline"
          title="No campaigns yet"
          description="Create a campaign, import your contacts, and assign agents."
        />
      )}
      <Pager page={page} setPage={setPage} data={r.data} />
    </Screen>
  );
}
function PickMany({ label, items, value, setValue }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: "#17223B" }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {items.map((item) => {
          const checked = value.includes(item._id);
          return (
            <Pressable
              key={item._id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() =>
                setValue(
                  checked
                    ? value.filter((id) => id !== item._id)
                    : [...value, item._id],
                )
              }
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: checked ? "#169B80" : "#E8EBF2",
                borderRadius: 10,
                backgroundColor: checked ? "#E9F8F3" : "#FFFFFF",
              }}
            >
              <Text
                style={{ fontSize: 12, color: checked ? "#169B80" : "#17223B" }}
              >
                {checked ? "✓ " : ""}
                {item.fullName}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
export function CampaignDetailsScreen({ route, navigation }) {
  const id = route.params.id,
    auth = useAuth(),
    r = useData("/campaigns?limit=100"),
    users = useData("/users?limit=100"),
    queue = useData("/campaigns/" + id + "/queue?limit=100");
  const c =
    r.data?.items.find((item) => item._id === id) || route.params.campaign;
  const [agentIds, setAgents] = useState(
      (c?.agentIds || []).map((a) => a._id || a),
    ),
    [supervisorIds, setSupervisors] = useState(
      (c?.supervisorIds || []).map((a) => a._id || a),
    );
  const people = users.data?.items || [];
  return (
    <Screen>
      <PageHeader title={c?.name || "Campaign"} />
      <Card title="Campaign settings">
        {!!c && (
          <Form
            key={c.updatedAt || c._id}
            initial={c}
            fields={[
              { key: "name", label: "Name" },
              { key: "description", label: "Description", multiline: true },
              { key: "serviceType", label: "Service type" },
              {
                key: "status",
                label: "Status",
                options: ["active", "paused", "completed"],
              },
            ]}
            submitLabel="Save campaign"
            onSubmit={async (data) => {
              await api.put("/campaigns/" + id, data);
              auth.bump();
            }}
          />
        )}
        <PickMany
          label="Assigned agents"
          items={people.filter((u) => u.role === "agent" && u.active)}
          value={agentIds}
          setValue={setAgents}
        />
        {!!(auth.user.role === "admin") && (
          <PickMany
            label="Supervisors"
            items={people.filter((u) => u.role === "supervisor" && u.active)}
            value={supervisorIds}
            setValue={setSupervisors}
          />
        )}
        <Button
          title="Save campaign team"
          onPress={() =>
            action(async () => {
              await api.put("/campaigns/" + id, {
                agentIds,
                ...(auth.user.role === "admin" ? { supervisorIds } : {}),
              });
              auth.bump();
            })
          }
        />
        <Button
          title="Import contacts to this campaign"
          disabled={auth.user.role !== "admin"}
          muted
          onPress={() => navigation.navigate("ImportLeads", { campaignId: id })}
        />
      </Card>
      <Card title="Calling queue">
        <State resource={queue} />
        {queue.data?.items.map((item, index) => (
          <Pressable
            key={item.leadId}
            onPress={() =>
              navigation.navigate("LeadDetails", { id: item.leadId })
            }
            style={{
              flexDirection: "row",
              gap: 12,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderColor: "#E8EBF2",
            }}
          >
            <Text style={{ width: 28, color: "#7B8497" }}>
              {item.position || index + 1}.
            </Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                style={{ fontSize: 14, fontWeight: "600", color: "#17223B" }}
              >
                {item.customerName || item.phone}
              </Text>
              <Body>
                {item.phone} · {item.status}
              </Body>
            </View>
          </Pressable>
        ))}
        {!!(queue.data && !queue.data.items.length) && (
          <Body>No contacts in this campaign.</Body>
        )}
      </Card>
    </Screen>
  );
}
export function ImportLeadsScreen({ route }) {
  const auth = useAuth(),
    [file, setFile] = useState(null),
    [results, setResults] = useState(null),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [uploadProgress, setUploadProgress] = useState(null),
    [error, setError] = useState(""),
    [campaignId, setCampaign] = useState(route?.params?.campaignId || ""),
    [agentId, setAgent] = useState("");
  const campaigns = useData("/campaigns?limit=100"),
    agents = useData("/users?limit=100");
  async function acceptFile(asset) {
    setResults(null);
    setError("");
    setPreview(false);
    if ((asset.size || 0) > 300000)
      throw new Error("Choose a CSV or Excel workbook under 300 KB.");
    const xlsx = /\.xlsx$/i.test(asset.name || "");
    let body;
    if (Platform.OS === "web") {
      const blob =
        asset instanceof Blob ? asset : await (await fetch(asset.uri)).blob();
      if (xlsx) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        body = { xlsxBase64: btoa(binary) };
      } else body = { csv: await blob.text() };
    } else
      body = xlsx
        ? {
            xlsxBase64: await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.Base64,
            }),
          }
        : { csv: await FileSystem.readAsStringAsync(asset.uri) };
    setFile({ name: asset.name, ...body });
  }
  async function pick() {
    const response = await DocumentPicker.getDocumentAsync({
      type: [
        "text/csv",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      copyToCacheDirectory: true,
    });
    if (!response.canceled) await acceptFile(response.assets[0]);
  }
  async function submit(isPreview) {
    setBusy(true);
    setUploadProgress(0);
    setError("");
    try {
      if (!file) throw new Error("Choose a file first.");
      const { name, ...body } = file;
      const response = await api.post(
        "/leads/import",
        {
          ...body,
          preview: isPreview,
          ...(campaignId ? { campaignId } : {}),
          ...(agentId ? { assignedAgentId: agentId } : {}),
        },
        {
          onUploadProgress: (event) =>
            setUploadProgress(
              event.total
                ? Math.round((event.loaded * 100) / event.total)
                : null,
            ),
        },
      );
      setResults(response.data.results);
      setPreview(isPreview);
      if (!isPreview) auth.bump();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const drop =
    Platform.OS === "web"
      ? React.createElement(
          "div",
          {
            role: "button",
            tabIndex: 0,
            "aria-label": "Drop CSV or Excel file",
            onDragOver: (event) => event.preventDefault(),
            onDrop: (event) => {
              event.preventDefault();
              if (event.dataTransfer.files[0])
                void acceptFile(event.dataTransfer.files[0]).catch((e) =>
                  setError(e.message),
                );
            },
            onClick: () => action(pick),
            onKeyDown: (e) => {
              if (e.key === "Enter") void action(pick);
            },
            style: {
              padding: 32,
              border: "2px dashed #B9C9D2",
              borderRadius: 16,
              textAlign: "center",
              fontFamily: "InterRegular, sans-serif",
              color: "#7B8497",
              cursor: "pointer",
            },
          },
          "Drop CSV / Excel here, or choose a file",
        )
      : null;
  return (
    <Screen contentContainerStyle={{ maxWidth: 1100 }}>
      <PageHeader title="Import contacts" />
      <Card title="CSV or Excel workbook">
        <Body>
          Fields: fullName, phone, address, serviceType, serviceNotes, source,
          status, assignedAgentId. Nepal mobile numbers may use 98/97… or +977.
          Maximum 300 KB and 500 rows.
        </Body>
        {drop}
        <Button
          title="Choose CSV or Excel"
          icon="cloud-upload-outline"
          muted
          onPress={() => action(pick)}
        />
        {!!file && <Badge>{file.name}</Badge>}
        <Select
          label="Campaign (optional)"
          value={campaignId}
          options={[
            { label: "No campaign", value: "" },
            ...(campaigns.data?.items || []).map((c) => ({
              value: c._id,
              label: c.name,
            })),
          ]}
          onChange={(value) => {
            setCampaign(value);
            setResults(null);
          }}
        />
        <Select
          label="Assign agent (optional)"
          value={agentId}
          options={[
            { label: "Keep file assignment / unassigned", value: "" },
            ...(agents.data?.items || [])
              .filter((a) => a.role === "agent" && a.active)
              .map((a) => ({ value: a._id, label: a.fullName })),
          ]}
          onChange={(value) => {
            setAgent(value);
            setResults(null);
          }}
        />
        {!!error && <Notice tone="danger">{error}</Notice>}
        {!!busy && (
          <Body>
            {uploadProgress === 100
              ? "Upload complete. Processing contacts…"
              : uploadProgress === null
                ? "Uploading…"
                : "Uploading " + uploadProgress + "%"}
          </Body>
        )}
        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <Button
            title="Preview import"
            loading={busy}
            disabled={!file}
            onPress={() => submit(true)}
          />
          {!!preview && (
            <Button
              title="Import ready contacts"
              loading={busy}
              onPress={() => submit(false)}
            />
          )}
        </View>
      </Card>
      {!!results && (
        <Card
          title={preview ? "Import preview" : "Import results"}
          subtitle={
            results.filter((r) => ["ready", "created"].includes(r.status))
              .length +
            " ready / created · " +
            results.filter((r) => r.status === "duplicate").length +
            " duplicates · " +
            results.filter(
              (r) => r.status === "invalid" || r.status === "error",
            ).length +
            " errors"
          }
        >
          {results.map((item, index) => (
            <View
              key={index}
              style={{
                flexDirection: "row",
                gap: 12,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: "#E8EBF2",
                alignItems: "flex-start",
              }}
            >
              <Text style={{ color: "#7B8497", width: 38 }}>#{item.row}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{ fontSize: 13, color: "#17223B", fontWeight: "600" }}
                >
                  {item.fullName || item.phone || "Row " + item.row}
                </Text>
                <Body>
                  {item.phone}
                  {item.message ? " · " + item.message : ""}
                </Body>
              </View>
              <Badge>{item.status}</Badge>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
