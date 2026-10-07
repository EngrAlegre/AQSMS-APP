import * as Network from "expo-network";
import { Platform } from "react-native";

export interface NetworkHint {
  onWifi: boolean | null;
  phoneIp: string | null;
  warning: string | null;
}

const IPV4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/;

/**
 * Best-effort "wrong Wi-Fi" check. Assumes a typical /24 home/farm network:
 * the phone and Pi should share the first three IP octets.
 */
export async function checkLocalNetwork(piHost: string | null): Promise<NetworkHint> {
  // Browsers can't report Wi-Fi state or local IP reliably; only meaningful on the phone.
  if (Platform.OS === "web") return { onWifi: null, phoneIp: null, warning: null };
  let onWifi: boolean | null = null;
  let phoneIp: string | null = null;
  try {
    const state = await Network.getNetworkStateAsync();
    onWifi = state.type === Network.NetworkStateType.WIFI;
  } catch {}
  try {
    const ip = await Network.getIpAddressAsync();
    phoneIp = ip && ip !== "0.0.0.0" ? ip : null;
  } catch {}

  let warning: string | null = null;
  if (onWifi === false) {
    warning = "This phone is not connected to Wi-Fi. Join the pond's local Wi-Fi network.";
  } else if (phoneIp && piHost) {
    const a = phoneIp.match(IPV4)?.[1];
    const b = piHost.match(IPV4)?.[1];
    if (a && b && a !== b) {
      warning = `Phone IP ${phoneIp} looks like a different network than the Pi (${piHost}). You may be on the wrong Wi-Fi.`;
    }
  }
  return { onWifi, phoneIp, warning };
}
