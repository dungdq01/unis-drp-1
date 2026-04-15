import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { PipelineBar } from "@/components/pipeline-bar";
import { GuideFab } from "@/components/guide-fab";

export const metadata: Metadata = {
  title: "UNIS SCP — Supply Chain Planning",
  description: "Smartlog Supply Chain Planning v3.5 — UNIS Group",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-[#f0f2f5] text-[#111827] antialiased overflow-hidden">
        <div className="flex h-screen w-screen overflow-hidden">
          {/* Fixed sidebar */}
          <Sidebar />

          {/* Main area: pipeline + content */}
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            <PipelineBar />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
            <GuideFab />
          </div>
        </div>
      </body>
    </html>
  );
}
