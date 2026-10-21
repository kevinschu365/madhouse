// Zentrale Stelle für App-Name, Farben und Logo.
// Hier ändern – alles andere in der App liest diese Werte.
// (Die Farben stehen zusätzlich in manifest.webmanifest und index.html <meta name="theme-color">,
//  weil iOS diese Dateien liest, bevor JavaScript läuft. Bei Farbänderung dort mit anpassen.)

export const BRAND = {
  name: 'Madhouse',
  shortName: 'Madhouse',
  colors: {
    background: '#000000',
    surface: '#0d0d0d',
    surface2: '#1a1a1a',
    accent: '#22c55e',      // Grün
    accentDim: '#14532d',
    text: '#ffffff',
    textDim: '#9ca3af',
    danger: '#ef4444',
    warn: '#f59e0b',
  },
  // Platzhalter-Logo als SVG (stilisierte Dartscheibe).
  logoSvg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="6"/>
    <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="3" opacity=".6"/>
    <circle cx="50" cy="50" r="6" fill="currentColor"/>
  </svg>`,
};

export const APP_VERSION = '1.0.2';
