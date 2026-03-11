/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        board: {
          bg: '#1a1a2e',
          sidebar: '#16213e',
          card: '#0f3460',
          text: '#e0e0e0',
          textMuted: '#888888',
        },
        entity: {
          person: '#e0e0e0',
          company: '#3498db',
          organisation: '#2ecc71',
          government: '#e74c3c',
        },
        topic: {
          lobbying: '#e74c3c',
          campaignFinance: '#3498db',
          govContracts: '#2ecc71',
          taxEvasion: '#f39c12',
          environmental: '#9b59b6',
          boardMemberships: '#1abc9c',
        }
      }
    },
  },
  plugins: [],
}
