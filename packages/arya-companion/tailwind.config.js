/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Mirror the dark palette in src/theme/themes.ts so utilities
      // like `bg-bg`, `text-text-secondary`, `border-border` stay in
      // sync with the JS theme object consumed by components that
      // still need runtime values.
      colors: {
        bg: "#000000",
        "bg-hover": "#000000",
        "bg-secondary": "#000000",
        "bg-tertiary": "#1A1A1A",
        "bg-input": "#000000",
        "bg-overlay": "rgba(0,0,0,0.6)",
        "bg-translucent": "rgba(0,0,0,0.8)",
        text: "#ECECEC",
        "text-secondary": "#B4B4B4",
        "text-tertiary": "#8E8E8E",
        "text-placeholder": "#6E6E6E",
        "text-inverse": "#171717",
        border: "#3E3E3E",
        "border-focus": "#ECECEC",
        primary: "#ECECEC",
        success: "#10A37F",
        danger: "#EF4444",
        warning: "#F59E0B",
        info: "#60A5FA",
      },
      fontFamily: {
        mono: ["Menlo-Regular", "monospace"],
      },
      borderRadius: {
        pill: "24px",
        card: "16px",
      },
      height: {
        pill: "44px",
      },
    },
  },
  plugins: [],
};
