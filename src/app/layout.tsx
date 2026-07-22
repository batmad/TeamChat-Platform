import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_METADATA_TITLE,
  description: process.env.NEXT_PUBLIC_METADATA_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        {children}

        <Toaster
          position="bottom-center"
          theme="dark"
          closeButton
          richColors
          toastOptions={{
            style: {
              background: "var(--color-slate-950)",
              color: "#e2e8f0",
              borderColor: "#1e293b",
            },
          }}
        />
      </body>
    </html>
  );
}
