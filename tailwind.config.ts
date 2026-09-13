import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#143A2E",
          forest: "#1B4D3E",
          emerald: "#10B981",
          deep: "#0F2B22",
          surface: "#F6F8F6",
          card: "#FFFFFF",
          border: "#E2E8F0",
          text: "#1C2520",
          muted: "#62736B",
          light: "#E9F2EE",
          gold: "#C5A059",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        arabic: ["var(--font-amiri)", "serif"],
      },
      boxShadow: {
        card: "0 2px 8px -1px rgba(22, 61, 49, 0.08), 0 1px 3px -1px rgba(22, 61, 49, 0.05)",
        float: "0 10px 25px -3px rgba(20, 58, 46, 0.15), 0 4px 6px -2px rgba(20, 58, 46, 0.05)",
      },
    },
  },
  plugins: [],
};
export default config;
