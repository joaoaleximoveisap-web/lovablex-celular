/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#F8F9F7",
        brand: { DEFAULT: "#17352F", soft: "#E7EFEC" },
        action: { DEFAULT: "#37866B", hover: "#2F7560", soft: "#E8F3EE" },
        ink: "#202522",
        muted: "#737B76",
        line: "#E6E9E6",
        danger: { DEFAULT: "#B4442F", soft: "#FBEDEA" },
        warn: { DEFAULT: "#9A6A12", soft: "#FBF3E2" },
      },
      fontFamily: { sans: ['"Manrope Variable"', "Manrope", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
      borderRadius: { card: "16px" },
      boxShadow: {
        card: "0 1px 2px rgba(23,53,47,0.04), 0 4px 16px rgba(23,53,47,0.05)",
        float: "0 8px 30px rgba(23,53,47,0.12)",
      },
    },
  },
  plugins: [],
};
