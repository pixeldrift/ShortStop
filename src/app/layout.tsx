import type { Metadata } from "next";
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
