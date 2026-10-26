// Anleitung: zeigt anleitung.html (dieselbe Datei, aus der auch die PDF entsteht) in der App.
// Eingebettet als iframe, damit sich die Adresse der App nicht ändert (iOS-Kamera-Erlaubnis, siehe app.js).
import { h } from '../dom.js';

export function render(root, params, nav) {
  const frame = h('iframe', {
    src: 'anleitung.html',
    title: 'Anleitung',
    style: { width: '100%', border: '0', display: 'block', background: '#000', borderRadius: '12px' },
  });
  // Höhe an den Inhalt anpassen, damit nur die App-Seite scrollt (kein Scrollen im Scrollen)
  const fit = () => {
    try { frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`; } catch { frame.style.height = '80dvh'; }
  };
  frame.addEventListener('load', () => { fit(); setTimeout(fit, 300); });
  root.appendChild(h('div', { class: 'stack', style: { maxWidth: '560px', margin: '0 auto' } },
    h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Anleitung')),
    frame,
    h('a', { class: 'btn', href: 'anleitung.pdf', target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none', color: 'var(--text)' } }, 'Als PDF öffnen / teilen'),
    h('button', { class: 'btn ghost', onclick: () => nav.go('home') }, 'Zurück zur Startseite'),
  ));
  window.addEventListener('resize', fit);
  return () => window.removeEventListener('resize', fit);
}
