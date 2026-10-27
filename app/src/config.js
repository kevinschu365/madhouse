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
  // Logo: Monogramm „M“, die Mittelspitze ist ein Dart, der im grünen Ring landet.
  // (App-Symbol: icons/icon.svg, PNGs erzeugt mit werkzeuge/icons.ps1)
  logoSvg: `<svg viewBox="88 52 336 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="256" cy="372" r="52" fill="none" stroke="#22c55e" stroke-width="16"/>
    <circle cx="256" cy="372" r="16" fill="#22c55e"/>
    <g fill="none" stroke="#fff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="118,410 118,130 222,290"/><polyline points="394,410 394,130 290,290"/>
    </g>
    <polygon points="256,62 228,100 256,138 284,100" fill="#22c55e" stroke="#000" stroke-width="5" stroke-linejoin="round"/>
    <line x1="256" y1="130" x2="256" y2="168" stroke="#9ca3af" stroke-width="8" stroke-linecap="round"/>
    <line x1="256" y1="168" x2="256" y2="262" stroke="#fff" stroke-width="24" stroke-linecap="round"/>
    <line x1="256" y1="262" x2="256" y2="362" stroke="#d4d4d4" stroke-width="8" stroke-linecap="round"/>
  </svg>`,
};

export const APP_VERSION = '1.8.1';
