import type { Metadata, Viewport } from "next";
import "./globals.compiled.css";

export const metadata: Metadata = {
  title: "Aldi Cart",
  description: "Scan Aldi items in-store and track your shopping total",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Aldi Cart",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0019a5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-AU">
      <body className="min-h-dvh flex flex-col bg-aldi-bg text-aldi-text">
        {children}
      </body>
    </html>
  );
}
