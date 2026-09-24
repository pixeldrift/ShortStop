import type { Metadata, Viewport } from "next";
import { Open_Sans, Ubuntu } from "next/font/google";
import "./globals.css";

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
});

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "ShortStop",
  description: "Step-by-step navigation for school bus drivers.",
  manifest: "/manifest.json",
  // iOS Safari's own "Add to Home Screen" reads `apple` directly, not
  // manifest.json's own icons array (that's what Android/desktop
  // installs use, via the manifest link above) - both need to be set
  // for the app to get a real icon on every platform's homescreen.
  // `icon` is the plain browser-tab favicon, unrelated to either
  // install path - favicon.ico as a sizes:"any" fallback for whatever
  // can't use the PNGs (old browsers, OS taskbar pinning), the PNGs
  // themselves for everywhere that can, at the sizes those contexts
  // actually request. This used to come for free from src/app/
  // favicon.ico (Next's own file-based icon convention - a file
  // literally at that path auto-generates its own <link> tag, no
  // metadata needed), but that file now lives under public/icons/
  // instead, outside where that convention looks - so it needs to be
  // wired in here explicitly, the same as apple already was.
  icons: {
    icon: [
      { url: "/icons/favicon.ico", sizes: "any" },
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

// No <meta name="viewport"> at all used to mean Next.js's own built-in
// default (width=device-width, initial-scale=1, nothing pinning the
// *maximum*) - every text input in this app already renders at 16px+
// (EditRouteScreen.tsx's own inputClass, text-base) specifically so
// Mobile Safari's "zoom the page to make a small input legible" heuristic
// never has a font-size small enough to trigger, but that heuristic is
// only ever a size *floor*, not something a page can otherwise opt out
// of - and on the real tablet this app actually runs on, focusing the
// Location field still zoomed in on tap, then (Mobile Safari's own
// long-standing bug, not anything this app's JS does) often failed to
// zoom back out once the on-screen keyboard closed, leaving the whole
// page stuck zoomed in. maximumScale: 1 caps how far in the viewport can
// ever go, at exactly the scale it already loads at - the standard fix
// for this exact class of bug, and harmless for a driver's own pinch-
// zoom since nothing here is precise enough work (turn-by-turn text,
// route rows) to ever need zooming in past 100% in the first place.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${openSans.variable} ${ubuntu.variable} h-full antialiased`}
    >
      <body className="h-dvh flex flex-col overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
