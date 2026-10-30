import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { View, Text, Pressable, Switch } from "../components/Themed";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Screen from "../components/Screen";
import Card from "../components/Card";
import {
  Body,
  Badge,
  Button,
  Field,
  Select,
  State,
  Pager,
  PageHeader,
  EmptyState,
  Notice,
  action,
  confirm,
  duration,
} from "../components/UI";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useData } from "../hooks/useData";
import { useRecordings } from "../context/RecordingContext";
import { newOperationId } from "../services/telecom";
import AgentFilter from "../components/AgentFilter";
import { localTime, validCalendarDate } from "../utils/dateTime";
const row = {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};
const small = { fontSize: 12, color: "#7B8497", lineHeight: 18 };
function extension(record) {
  return (
    {
      "audio/wav": "wav",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/ogg": "ogg",
      "audio/webm": "webm",
    }[record.mimeType] || "audio"
  );
}
async function download(record) {
  const filename =
      "CallTrack-recording-" + record._id + "." + extension(record),
    url = "/recordings/" + record._id + "/media?download=1";
  if (Platform.OS === "web") {
    const response = await api.get(url, { responseType: "blob" }),
      uri = URL.createObjectURL(response.data),
      a = document.createElement("a");
    a.href = uri;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
  } else {
    const dest = FileSystem.cacheDirectory + filename,
      result = await FileSystem.downloadAsync(
        api.defaults.baseURL + url,
        dest,
        {
          headers: { Authorization: api.defaults.headers.common.Authorization },
        },
      );
    if (result.status !== 200) throw new Error("Recording download failed.");
    try {
      await Sharing.shareAsync(dest, { mimeType: record.mimeType });
    } finally {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    }
  }
}
function AudioFilePlayer({ record }) {
  const auth = useAuth(),
    player = useAudioPlayer(null, { updateInterval: 500 }),
    status = useAudioPlayerStatus(player),
    uri = useRef(null),
    owner = useRef(auth.user?._id),
    active = useRef(true);
  owner.current = auth.user?._id;
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      try {
        player.pause();
      } catch {}
      if (uri.current) {
        if (Platform.OS === "web") URL.revokeObjectURL(uri.current);
        else void FileSystem.deleteAsync(uri.current, { idempotent: true });
        uri.current = null;
      }
    };
  }, [auth.user?._id]);
  async function load() {
    const requestedOwner = auth.user?._id;
    setLoading(true);
    setError("");
    let target;
    try {
      const url = "/recordings/" + record._id + "/media";
      if (Platform.OS === "web") {
        const response = await api.get(url, {
          responseType: "blob",
          headers: { Authorization: "Bearer " + auth.token },
        });
        target = URL.createObjectURL(response.data);
      } else {
        target =
          FileSystem.cacheDirectory +
          "calltrack-play-" +
          newOperationId() +
          "." +
          extension(record);
        const response = await FileSystem.downloadAsync(
          api.defaults.baseURL + url,
          target,
          { headers: { Authorization: "Bearer " + auth.token } },
        );
        if (response.status !== 200) throw new Error("Recording unavailable.");
      }
      if (!active.current || owner.current !== requestedOwner) {
        if (Platform.OS === "web") URL.revokeObjectURL(target);
        else await FileSystem.deleteAsync(target, { idempotent: true });
        return;
      }
      if (uri.current) {
        if (Platform.OS === "web") URL.revokeObjectURL(uri.current);
        else await FileSystem.deleteAsync(uri.current, { idempotent: true });
      }
      uri.current = target;
      player.replace({ uri: target });
    } catch (e) {
      if (active.current && owner.current === requestedOwner)
        setError(e.message);
    } finally {
      if (active.current && owner.current === requestedOwner) setLoading(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={row}>
        {!uri.current || !status.isLoaded ? (
          <Button
            title={uri.current ? "Reload audio" : "Load audio"}
            muted
            compact
            loading={loading}
            onPress={() => action(load)}
          />
        ) : (
          <>
            <Button
              title={status.playing ? "Pause" : "Play"}
              icon={status.playing ? "pause" : "play"}
              compact
              onPress={() => {
                if (status.playing) player.pause();
                else {
                  if (status.didJustFinish) void player.seekTo(0);
                  player.play();
                }
              }}
            />
            <Button
              title="Restart"
              muted
              compact
              onPress={() => action(() => player.seekTo(0))}
            />
            <Text style={small}>
              {duration(status.currentTime)} / {duration(status.duration)}
            </Text>
          </>
        )}
      </View>
      {!!status.isBuffering && <Body>Buffering…</Body>}
      {!!error && (
        <Text accessibilityRole="alert" style={{ ...small, color: "#D04B60" }}>
          {error}
        </Text>
      )}
    </View>
  );
}
function RecordingRow({ record, onChange }) {
  const auth = useAuth(),
    [open, setOpen] = useState(false),
    call = record.callId;
  return (
    <View
      style={{
        gap: 12,
        paddingVertical: 15,
        borderBottomWidth: 1,
        borderColor: "#E8EBF2",
      }}
    >
      <View style={{ ...row, justifyContent: "space-between" }}>
        <View style={{ flex: 1, minWidth: 180, gap: 5 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: "#17223B" }}>
            {call?.customerId?.fullName || call?.phone || record.originalName}
          </Text>
          <Text style={small}>
            {call?.phone} · {call?.agentId?.fullName || "Agent"} ·{" "}
            {localTime(call?.initiatedAt || record.createdAt)}
          </Text>
        </View>
        <Badge
          tone={
            record.status === "available"
              ? "success"
              : record.status === "failed"
                ? "danger"
                : "neutral"
          }
        >
          {record.status}
        </Badge>
      </View>
      <Text style={small}>
        Attached file · Source not independently verified
      </Text>
      <Text style={small}>
        Call: {call?.durationKnown ? duration(call.talkSeconds) : "Unknown"} ·
        Audio:{" "}
        {record.durationKnown
          ? duration(record.durationSeconds)
          : "Shown in player"}{" "}
        · {(record.bytes / 1048576).toFixed(1)}MB
      </Text>
      {!!record.failureReason && (
        <Text style={{ ...small, color: "#D04B60" }}>
          {record.failureReason}
        </Text>
      )}
      {!!(record.status === "available") && (
        <View style={row}>
          <Button
            title={open ? "Close player" : "Open player"}
            muted
            compact
            icon="play-outline"
            onPress={() => setOpen(!open)}
          />
          <Button
            title="Download"
            muted
            compact
            icon="download-outline"
            onPress={() => action(() => download(record))}
          />
          {!!(auth.user.role === "admin") && (
            <Button
              title="Delete"
              muted
              compact
              tone="danger"
              onPress={() =>
                confirm(
                  "Delete this recording?",
                  () => api.delete("/recordings/" + record._id),
                  onChange,
                )
              }
            />
          )}
        </View>
      )}
      {!!(open && record.status === "available") && (
        <AudioFilePlayer record={record} />
      )}
    </View>
  );
}
export function RecordingUploadQueue() {
  const r = useRecordings();
  if (!r?.items.length) return null;
  return (
    <Card
      title="Pending audio uploads"
      subtitle={r.items.length + " saved on this device"}
    >
      <Button
        title="Retry uploads"
        muted
        loading={!!r.uploading}
        onPress={() => action(r.retry)}
      />
      {r.items.map((item) => (
        <View
          key={item.uploadId}
          style={{
            gap: 8,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderColor: "#E8EBF2",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#17223B" }}>
            {item.name}
          </Text>
          <Text style={small}>
            {r.uploading === item.uploadId
              ? Math.round(r.progress * 100) + "% uploaded"
              : "Saved for retry"}
            {item.error ? " · " + item.error : ""}
          </Text>
          {!!(r.uploading !== item.uploadId) && (
            <Button
              title="Remove pending file"
              muted
              compact
              onPress={() =>
                confirm(
                  "Remove this device copy? Keep the original audio file.",
                  () => r.discard(item),
                )
              }
            />
          )}
        </View>
      ))}
    </Card>
  );
}
export function RecordingAttachments({ callId }) {
  const auth = useAuth(),
    queue = useRecordings(),
    config = useData("/recordings/config"),
    list = useData("/recordings?callId=" + callId);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const allowed = config.data?.enabled && config.data?.storageConfigured;
  async function choose() {
    setBusy(true);
    try {
      if (!consent) throw new Error("Confirm authorization and consent first.");
      const pick = await DocumentPicker.getDocumentAsync({
        type: ["audio/*", "video/mp4"],
        copyToCacheDirectory: true,
      });
      if (!pick.canceled) {
        await queue.stage(callId, pick.assets[0], consent);
        setConsent(false);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Recordings">
      <State resource={list} />
      {list.data?.items.map((record) => (
        <RecordingRow
          key={record._id}
          record={record}
          onChange={list.refresh}
        />
      ))}
      {!!(!list.loading && !list.data?.items.length) && (
        <Badge tone="neutral">Recording unavailable</Badge>
      )}
      {!!allowed && (
        <>
          <View style={row}>
            <Switch
              accessibilityLabel="Recording authorization and consent confirmed"
              value={consent}
              onValueChange={setConsent}
            />
            <Text style={{ ...small, flex: 1 }}>
              I am authorized to attach this audio and required recording
              consent was obtained.
            </Text>
          </View>
          <Button
            title="Attach existing audio"
            muted
            icon="attach"
            disabled={!consent}
            loading={busy}
            onPress={() => action(choose)}
          />
          <Text style={small}>
            Existing WAV, MP3, M4A, Ogg or WebM · Max20MB
          </Text>
        </>
      )}
      {!allowed && (
        <Text style={small}>
          {!config.data?.storageConfigured
            ? "Private recording storage is not configured."
            : "Recording attachments are disabled."}
        </Text>
      )}
      {!!queue.items.some((item) => item.callId === callId) && (
        <Button
          title="View upload status"
          muted
          compact
          onPress={() => queue.retry()}
        />
      )}
    </Card>
  );
}
export default function RecordingsScreen() {
  const auth = useAuth(),
    [page, setPage] = useState(1),
    [phone, setPhone] = useState(""),
    [query, setQuery] = useState(""),
    [agentId, setAgent] = useState(""),
    [status, setStatus] = useState(""),
    [dates, setDates] = useState({}),
    [settingsOpen, setSettingsOpen] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const config = useData("/recordings/config");
  const params = new URLSearchParams({
    page: String(page),
    phone: query,
    ...(agentId ? { agentId } : {}),
    ...(status ? { status } : {}),
    ...(dates.from ? { from: dates.from + "T00:00:00+05:45" } : {}),
    ...(dates.to
      ? {
          to: new Date(
            +new Date(dates.to + "T00:00:00+05:45") + 86400000,
          ).toISOString(),
        }
      : {}),
    ...(dates.campaignId ? { campaignId: dates.campaignId } : {}),
  });
  const list = useData("/recordings?" + params),
    campaigns = useData("/campaigns?limit=100");
  return (
    <Screen>
      <PageHeader
        title="Recordings"
        actions={
          auth.user.role === "admin" ? (
            <Button
              title="Recording settings"
              muted
              icon="settings-outline"
              onPress={() => setSettingsOpen(!settingsOpen)}
            />
          ) : null
        }
      />
      {!!(settingsOpen && config.data) && (
        <RecordingSettings config={config.data} onSaved={config.refresh} />
      )}
      <Card>
        <View style={row}>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Field label="Phone number" value={phone} onChangeText={setPhone} />
          </View>
          <Button
            title="Search"
            onPress={() => {
              setQuery(phone);
              setPage(1);
            }}
          />
        </View>
        {!!(auth.user.role !== "agent") && (
          <AgentFilter
            value={agentId}
            onChange={(value) => {
              setAgent(value);
              setPage(1);
            }}
          />
        )}
        <Select
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { label: "All", value: "" },
            { label: "Available", value: "available" },
            { label: "Pending", value: "processing" },
            { label: "Failed", value: "failed" },
            { label: "Deleted", value: "deleted" },
          ]}
        />
        <Select
          label="Campaign"
          value={dates.campaignId || ""}
          onChange={(campaignId) => {
            setDates({ ...dates, campaignId });
            setPage(1);
          }}
          options={[
            { label: "All campaigns", value: "" },
            ...(campaigns.data?.items || []).map((c) => ({
              label: c.name,
              value: c._id,
            })),
          ]}
        />
        <View style={row}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field
              label="From · YYYY-MM-DD"
              placeholder="YYYY-MM-DD"
              value={from}
              onChangeText={setFrom}
            />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field
              label="To · YYYY-MM-DD"
              placeholder="YYYY-MM-DD"
              value={to}
              onChangeText={setTo}
            />
          </View>
          <Button
            title="Apply dates"
            muted
            onPress={() =>
              action(async () => {
                if (
                  (from && !validCalendarDate(from)) ||
                  (to && !validCalendarDate(to))
                )
                  throw new Error("Use valid YYYY-MM-DD dates.");
                if (from && to && from > to)
                  throw new Error(
                    "The end date must not precede the start date.",
                  );
                setDates({ ...dates, from, to });
                setPage(1);
              })
            }
          />
          <Button
            title="Clear"
            muted
            onPress={() => {
              setFrom("");
              setTo("");
              setQuery("");
              setPhone("");
              setAgent("");
              setDates({});
              setStatus("");
            }}
          />
        </View>
      </Card>
      <RecordingUploadQueue />
      <State resource={list} />
      {!!list.data?.items.length && (
        <Card>
          {list.data.items.map((record) => (
            <RecordingRow
              key={record._id}
              record={record}
              onChange={list.refresh}
            />
          ))}
        </Card>
      )}
      {!!(!list.loading && !list.error && !list.data?.items.length) && (
        <EmptyState
          icon="musical-notes-outline"
          title="No recordings"
          description="Attach an authorized recording file from a call's details."
        />
      )}
      <Pager page={page} setPage={setPage} data={list.data} />
      <Notice tone="neutral" title="SIM audio">
        Automatic two-sided recording and live audio listening depend on a
        supported device or authorized telephony provider.
      </Notice>
    </Screen>
  );
}
function RecordingSettings({ config, onSaved }) {
  const [enabled, setEnabled] = useState(config.enabled),
    [days, setDays] = useState(String(config.retentionDays)),
    [busy, setBusy] = useState(false);
  return (
    <Card title="Recording settings">
      <View style={row}>
        <Switch
          accessibilityLabel="Allow authorized audio attachments"
          value={enabled}
          onValueChange={setEnabled}
        />
        <Text style={{ fontSize: 13, color: "#17223B", flex: 1 }}>
          Allow authorized audio attachments
        </Text>
      </View>
      <Field
        label="Retention days"
        keyboardType="number-pad"
        value={days}
        onChangeText={setDays}
      />
      <Body>Existing files only. This does not enable SIM audio capture.</Body>
      <Badge tone={config.storageConfigured ? "success" : "warning"}>
        {config.storageConfigured
          ? "Encrypted private storage configured"
          : "Storage key is not configured"}
      </Badge>
      <Button
        title="Save recording settings"
        loading={busy}
        onPress={() =>
          action(async () => {
            setBusy(true);
            try {
              await api.put("/recordings/config", {
                enabled,
                retentionDays: Number(days),
              });
              onSaved();
            } finally {
              setBusy(false);
            }
          })
        }
      />
    </Card>
  );
}
