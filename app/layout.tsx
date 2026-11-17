import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "./style.css";
import { RegisterWorker } from "./register-worker";

export const metadata: Metadata = {
  title: "FitnessTrackr",
  description: "Personal nutrition, energy balance, and measurement tracker",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#F5F7FA",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" data-theme="light" suppressHydrationWarning><body>{children}<RegisterWorker /></body></html>;
}
