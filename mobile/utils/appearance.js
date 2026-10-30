import { StyleSheet } from "react-native";
import { darkColors, fonts } from "./theme";

const surfaces = new Map(
  Object.entries({
    "#FFFFFF": darkColors.surface,
    "#F6F7FB": darkColors.background,
    "#FAFBFD": "#151F30",
    "#F7F8FC": "#202B3E",
    "#F8F9FD": "#202B3E",
    "#F9FAFD": "#151F30",
    "#F2F3F8": "#131D2D",
    "#F0F2F6": "#273246",
    "#E9F8F3": darkColors.primarySoft,
    "#F3EDFA": "#322844",
    "#F4EDFB": "#322844",
    "#FFF6E7": darkColors.warningSoft,
    "#FFF0F2": darkColors.dangerSoft,
    "#E9F8F3": darkColors.successSoft,
    "#151C30": darkColors.navy,
    "#147D70": "#16836F",
    "#0F695E": "#0F695E",
    "#E8EBF2": darkColors.border,
    "#F0F2F8": "#273246",
  }),
);
const foregrounds = new Map(
  Object.entries({
    "#17223B": darkColors.ink,
    "#7B8497": darkColors.muted,
    "#147D70": darkColors.primary,
    "#0F695E": "#8CE4CE",
    "#A56813": darkColors.warning,
    "#D04B60": darkColors.danger,
    "#169B80": darkColors.success,
    "#8A62C5": "#C8A3F4",
    "#9661C6": "#C8A3F4",
    "#B42318": "#FFAAA1",
    "#A34238": "#FFAAA1",
    "#C44747": "#FF9DAB",
    "#18866A": "#66D6B5",
    "#0F9C7A": "#66D6B5",
  }),
);
function rgba(value) {
  if (typeof value !== "string") return null;
  if (value.toLowerCase() === "white") return [255, 255, 255, 1];
  if (value.toLowerCase() === "black") return [0, 0, 0, 1];
  let hex = value.replace(/^#/, "");
  if (!/^[a-f0-9]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length))
    return null;
  if (hex.length <= 4) hex = [...hex].map((char) => char + char).join("");
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}
function hsl(red, green, blue) {
  const r = red / 255,
    g = green / 255,
    b = blue / 255,
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min,
    saturation = delta / (1 - Math.abs(2 * light - 1));
  let hue =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation, light];
}
function hslColor(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1)),
    m = lightness - chroma / 2;
  const rgb =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return (
    "#" +
    rgb
      .map((value) =>
        Math.round((value + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const colorCache = new Map();
export function appearanceColor(value, role, isDark) {
  if (!isDark) return value;
  const cacheKey = role + ":" + value;
  if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);
  const channels = rgba(value);
  if (!channels) return value;
  if (channels[3] < 1) {
    if (role === "background" && channels[3] > 0.5) {
      const opaque =
        "#" +
        channels
          .slice(0, 3)
          .map((channel) => channel.toString(16).padStart(2, "0"))
          .join("");
      const base = appearanceColor(opaque, role, true);
      return typeof base === "string" && base.startsWith("#")
        ? base +
            Math.round(channels[3] * 255)
              .toString(16)
              .padStart(2, "0")
        : base;
    }
    return value;
  }
  const [r, g, b] = channels;
  const normalized =
    "#" +
    [r, g, b]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  const [h, s, l] = hsl(r, g, b);
  let result = value;
  if (role === "background") {
    result =
      surfaces.get(normalized) ||
      (l > 0.78
        ? hslColor(
            s < 0.08 ? 220 : h,
            Math.min(0.32, s),
            s < 0.08 ? 0.14 : 0.18,
          )
        : value);
  } else if (role === "border") {
    result = l > 0.7 ? darkColors.border : value;
  } else {
    result =
      foregrounds.get(normalized) ||
      (l < 0.65
        ? hslColor(
            s < 0.12 ? 220 : h,
            Math.min(s, 0.65),
            s < 0.12 ? 0.76 : 0.75,
          )
        : value);
  }
  colorCache.set(cacheKey, result);
  return result;
}
const colorProperties = [
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "textDecorationColor",
  "tintColor",
];
export function appearanceStyle(style, isDark, text = false) {
  const flattened = StyleSheet.flatten(style) || {};
  const result = { ...flattened };
  for (const key of colorProperties) {
    if (result[key] != null)
      result[key] = appearanceColor(
        result[key],
        key === "backgroundColor"
          ? "background"
          : key.startsWith("border")
            ? "border"
            : "foreground",
        isDark,
      );
  }
  if (text) {
    const weight =
      flattened.fontWeight === "bold"
        ? 700
        : Number(flattened.fontWeight) || 400;
    result.fontFamily =
      weight >= 800
        ? fonts.extraBold
        : weight >= 700
          ? fonts.bold
          : weight >= 600
            ? fonts.semibold
            : weight >= 500
              ? fonts.medium
              : fonts.regular;
    // Each registered font already contains its own weight, including on Android.
    result.fontWeight = "normal";
    if (result.color == null)
      result.color = isDark ? darkColors.ink : "#17223B";
  }
  if (isDark && result.boxShadow)
    result.boxShadow = "0 4px 18px rgba(0,0,0,0.12)";
  return result;
}
