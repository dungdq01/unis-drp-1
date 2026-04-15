import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sl: {
          // Sky-white palette
          bg:           "#f0f4f8",
          "bg-warm":    "#f7f9fc",
          sidebar:      "#ffffff",
          card:         "rgba(255, 255, 255, 0.72)",
          "card-solid": "#ffffff",
          elevated:     "#f8fafd",
          // Borders
          border:       "rgba(148, 173, 215, 0.25)",
          "border-hi":  "rgba(96, 137, 204, 0.35)",
          "border-accent": "rgba(59, 130, 246, 0.3)",
          // Sky blues
          sky:          "#0ea5e9",
          "sky-light":  "#38bdf8",
          "sky-dim":    "#e0f2fe",
          "sky-deep":   "#0284c7",
          blue:         "#3b82f6",
          "blue-l":     "#60a5fa",
          "blue-dim":   "#eff6ff",
          "blue-mid":   "#dbeafe",
          // Semantic
          green:        "#10b981",
          "green-l":    "#34d399",
          "green-dim":  "#ecfdf5",
          amber:        "#f59e0b",
          "amber-dim":  "#fffbeb",
          red:          "#ef4444",
          "red-dim":    "#fef2f2",
          purple:       "#8b5cf6",
          "purple-dim": "#f5f3ff",
          // Text
          text:         "#0f172a",
          "text-2":     "#475569",
          "text-3":     "#94a3b8",
          "text-inv":   "#ffffff",
        },
      },
      keyframes: {
        "pulse-dot": {
          "0%,100%": { opacity: "1" },
          "50%":     { opacity: "0.4" },
        },
        "float": {
          "0%,100%": { transform: "translateY(0)" },
          "50%":     { transform: "translateY(-4px)" },
        },
        "shimmer": {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "float":     "float 3s ease-in-out infinite",
        "shimmer":   "shimmer 2.5s linear infinite",
      },
      boxShadow: {
        // Layered soft shadows for depth
        "card":        "0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03)",
        "card-hover":  "0 4px 16px rgba(14, 165, 233, 0.08), 0 8px 32px rgba(15, 23, 42, 0.06)",
        "card-active": "0 0 0 2px rgba(14, 165, 233, 0.2), 0 4px 16px rgba(14, 165, 233, 0.1)",
        "glow-sky":    "0 0 20px rgba(14, 165, 233, 0.15), 0 0 40px rgba(14, 165, 233, 0.05)",
        "glow-green":  "0 0 12px rgba(16, 185, 129, 0.2)",
        "inner-glow":  "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
        "sidebar":     "4px 0 24px rgba(15, 23, 42, 0.04)",
        "topbar":      "0 1px 0 rgba(148, 173, 215, 0.15), 0 4px 12px rgba(15, 23, 42, 0.02)",
      },
      backgroundImage: {
        // Sky gradient backgrounds
        "sky-gradient":    "linear-gradient(180deg, #f0f4f8 0%, #e0f2fe 50%, #bae6fd 100%)",
        "sky-subtle":      "linear-gradient(180deg, #f7f9fc 0%, #eff6ff 100%)",
        "sky-radial":      "radial-gradient(ellipse at top, #e0f2fe 0%, #f0f4f8 60%)",
        "card-sheen":      "linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(248,250,253,0.7) 100%)",
        "accent-gradient": "linear-gradient(135deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%)",
        "glass-border":    "linear-gradient(135deg, rgba(148,173,215,0.3) 0%, rgba(14,165,233,0.15) 50%, rgba(148,173,215,0.1) 100%)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
