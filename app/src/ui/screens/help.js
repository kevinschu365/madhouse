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
  // Inhaltsverzeichnis: Sprungmarken (#turnier …) scrollen die App-Seite, denn der Rahmen selbst scrollt nicht
  const jump = (id) => {
    try {
      const el = id && frame.contentDocument.getElementById(id);
      // scrollIntoView scrollt auch die App-Seite um den Rahmen herum (die Anleitung ist gezoomt – selbst rechnen wäre ungenau)
      if (el) el.scrollIntoView({ block: 'start' });
    } catch { /* Rahmen noch nicht geladen */ }
  };
  frame.addEventListener('load', () => {
    fit(); setTimeout(fit, 300);
    try {
      frame.contentDocument.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        e.preventDefault();
        jump(a.getAttribute('href').slice(1));
      });
      if (params.section) setTimeout(() => jump(params.section), 350); // direkt zu einem Kapitel öffnen
    } catch { /* anderer Ursprung: Sprünge gehen dann im Rahmen selbst */ }
  });
  const toTop = h('button', { class: 'tocjump', onclick: () => window.scrollTo({ top: 0 }) }, '↑ Inhalt');
  root.appendChild(h('div', { class: 'stack', style: { maxWidth: '560px', margin: '0 auto' } },
    h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go(params.back || 'home') }, '‹'), h('h1', {}, 'Anleitung')),
    toTop,
    frame,
    h('a', { class: 'btn', href: 'anleitung.pdf', target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none', color: 'var(--text)' } }, 'Als PDF öffnen / teilen'),
    h('button', { class: 'btn ghost', onclick: () => nav.go(params.back || 'home') }, 'Zurück'),
  ));
  window.addEventListener('resize', fit);
  return () => window.removeEventListener('resize', fit);
}
