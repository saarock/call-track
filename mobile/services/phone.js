import { Linking } from "react-native";
export async function openPhoneDialer(phone) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error("A valid international phone number is required");
  try {
    await Linking.openURL(`tel:${phone}`);
  } catch {
    throw new Error(
      "The phone app could not be opened, or the request was canceled. Use a physical phone with calling available. No call is confirmed by CallTrack.",
    );
  }
  // Resolving openURL only means the system accepted the URL. It is not proof of a call.
}
