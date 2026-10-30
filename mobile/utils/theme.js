import { Platform } from "react-native";

export const fonts = {
  regular: "InterRegular",
  medium: "InterMedium",
  semibold: "InterSemiBold",
  bold: "InterBold",
  extraBold: "InterExtraBold",
};
export const fontFamily = fonts.regular;
export const lightColors = {
  primary: "#147D70",
  primaryDark: "#0F695E",
  primarySoft: "#E9F8F3",
  primaryLight: "#E9F8F3",
  ink: "#17223B",
  navy: "#151C30",
  muted: "#607089",
  background: "#F6F7FB",
  surface: "#FFFFFF",
  border: "#E8EBF2",
  white: "#FFFFFF",
  warning: "#A56813",
  warningSoft: "#FFF6E7",
  danger: "#D04B60",
  dangerSoft: "#FFF0F2",
  success: "#169B80",
  successSoft: "#E9F8F3",
  teal: "#169B80",
};
export const darkColors = {
  primary: "#76D8BF",
  primaryDark: "#59C5AB",
  primarySoft: "#193A35",
  primaryLight: "#193A35",
  ink: "#EDF2FC",
  navy: "#0D1423",
  muted: "#A1AEC4",
  background: "#101725",
  surface: "#1A2435",
  border: "#303D53",
  white: "#FFFFFF",
  warning: "#F0C074",
  warningSoft: "#3B3022",
  danger: "#F38C9D",
  dangerSoft: "#3C2633",
  success: "#66D6B5",
  successSoft: "#193A35",
  teal: "#66D6B5",
};
// The shared primitives resolve these baseline tokens for the current appearance.
export const colors = lightColors;
export const shadows = {
  card: Platform.select({
    web: { boxShadow: "0 3px 16px rgba(23,34,59,0.035)" },
    default: {
      shadowColor: "#17223B",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.035,
      shadowRadius: 12,
      elevation: 1,
    },
  }),
};
