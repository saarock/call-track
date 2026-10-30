import React, { useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Body, Button, action } from "./UI";
import { api } from "../services/api";
export default function PrivateAppUpdate({ variant = "agent" }) {
  const [update, setUpdate] = useState(null),
    [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try {
      const v = Constants.expoConfig?.android?.versionCode || 0;
      setUpdate(
        (await api.get("/app-updates?variant=" + variant + "&versionCode=" + v))
          .data,
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    try {
      const filename =
        "CallTrack-" + (variant === "agent" ? "Dialer" : "CRM") + ".apk";
      if (Platform.OS === "web") {
        const response = await api.get(update.downloadPath, {
          responseType: "blob",
        });
        const url = URL.createObjectURL(response.data);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const dest = FileSystem.cacheDirectory + filename;
        const response = await FileSystem.downloadAsync(
          api.defaults.baseURL + update.downloadPath,
          dest,
          {
            headers: {
              Authorization: api.defaults.headers.common.Authorization,
            },
          },
        );
        if (response.status !== 200)
          throw new Error("The private APK download failed.");
        await Sharing.shareAsync(dest, {
          mimeType: "application/vnd.android.package-archive",
        });
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        title="Check for app updates"
        muted
        loading={busy}
        onPress={() => action(check)}
      />
      {!!update && (
        <Body>
          {!update.configured
            ? "No private APK release is configured."
            : update.updateAvailable
              ? "Version " + update.version + " is available."
              : "Configured release: " + update.version}
        </Body>
      )}
      {!!update?.configured && (
        <>
          <Body>
            Company package ·{" "}
            {update.signing === "company"
              ? "Company signed"
              : "Preview for testing"}{" "}
            · SHA-256: {update.sha256}
          </Body>
          <Button
            title="Download private APK"
            disabled={busy}
            onPress={() => action(download)}
          />
        </>
      )}
    </>
  );
}
