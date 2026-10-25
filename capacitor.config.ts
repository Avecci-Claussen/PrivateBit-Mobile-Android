import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.privatebit.wallet",
  appName: "PrivateBit",
  webDir: process.env.PB_WEBDIR ?? "www",
  loggingBehavior: "none",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: { androidScheme: "https", cleartext: false },
  plugins: {
    SystemBars: { insetsHandling: "css", style: "DARK" },
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
  },
};
export default config;
