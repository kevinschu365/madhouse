// Nach dem Turnier: Ergebnisse als CSV (für Excel), Ergebnisliste zum Drucken bzw. als PDF und Urkunden.
// Gedruckt wird über ein eigenes Fenster mit Druck-Layout (im Druckdialog „Als PDF speichern“ wählen).
import { h, toast, sheet } from './dom.js';
import { finalRanking, TOURNAMENT_FORMATS, rulesText, TIEBREAK_TEXT } from '../core/tournament.js';
import { throwRows } from '../game/match.js';
import { playerStats } from '../stats/stats.js';
import { nameOf } from './tournamentView.js';
import { BRAND } from '../config.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dec = (v) => (v ? v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '');
const day = (ts) => new Date(ts || Date.now()).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Werte je Spieler aus allen Würfen des Turniers (nur X01). */
function statsByPlayer(t, matches) {
  const rows = new Map();
  for (const m of matches) {
    if (!m.tournament || m.tournament.id !== t.id || m.status === 'aborted' || (t.stopped || {})[m.id] || m.mode !== 'x01') continue;
    let list = [];
    try { list = throwRows(m); } catch { /* defektes Match */ }
    for (const r of list) (rows.get(r.playerId) || rows.set(r.playerId, []).get(r.playerId)).push(r);
  }
  return new Map([...rows].map(([id, r]) => [id, playerStats(r)]));
}

/** Ergebnis-Text eines Spiels aus Sicht von A: „2 : 1“, „w.o.“, „1 : 1 U“. */
const scoreOf = (g) => (!g.result ? '' : g.result.walkover ? 'kampflos' : `${g.result.legs[g.a] ?? 0} : ${g.result.legs[g.b] ?? 0}${g.result.draw ? ' (U)' : ''}`);

/** CSV mit Semikolon und BOM (öffnet in deutschem Excel direkt richtig). */
function csv(t, st, matches) {
  const stats = statsByPlayer(t, matches);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  lines.push([t.name, TOURNAMENT_FORMATS[t.format], day(t.createdAt)].map(q).join(';'));
  lines.push('');
  lines.push(['Platz', 'Spieler', 'Average', 'First 9', 'Beste Aufnahme', 'Höchstes Finish', '180er', 'Checkout-Quote'].map(q).join(';'));
  for (const r of finalRanking(t, st)) {
    const s = stats.get(r.id);
    lines.push([r.placeText, nameOf(t, r.id), s ? dec(s.average) : '', s ? dec(s.first9) : '', s ? s.highest || '' : '', s ? s.highestCheckout || '' : '', s ? s.c180 || 0 : '', s && s.checkoutAttempts ? `${Math.round(s.checkoutRate * 100)} %` : ''].map(q).join(';'));
  }
  lines.push('');
  lines.push(['Runde', 'Spieler A', 'Spieler B', 'Ergebnis', 'Sieger', 'Eingetragen'].map(q).join(';'));
  for (const g of st.games.filter((x) => !x.bye)) {
    lines.push([g.roundName, nameOf(t, g.a, g.aLabel), nameOf(t, g.b, g.bLabel), scoreOf(g) || (g.status === 'running' ? 'läuft' : 'offen'),
      g.result ? (g.result.draw ? 'unentschieden' : nameOf(t, g.winnerId)) : '',
      g.match && g.match.manualResult ? 'am PC' : g.result && g.result.walkover ? 'kampflos' : g.result ? 'am Board' : ''].map(q).join(';'));
  }
  return `﻿${lines.join('\r\n')}`;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Druck-Fenster mit eigenem Layout öffnen und den Druckdialog zeigen. */
function printHtml(title, bodyHtml, css) {
  const w = window.open('', '_blank');
  if (!w) { toast('Das Fenster wurde blockiert – Pop-ups für diese Seite erlauben.'); return; }
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 24px; }
    h1 { margin: 0 0 4px; } h2 { margin: 22px 0 8px; font-size: 18px; border-bottom: 2px solid #22c55e; padding-bottom: 3px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; } td, th { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; }
    th { background: #f3f3f3; } .num { text-align: right; font-variant-numeric: tabular-nums; } .dim { color: #666; } .win { font-weight: 700; }
    .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
    ${css || ''}
  </style></head><body>${bodyHtml}<script>setTimeout(() => print(), 300)<\/script></body></html>`);
  w.document.close();
}

/** Ergebnisliste: Platzierung mit Werten, Gruppen-Tabellen, alle Spiele. */
function resultsHtml(t, st, matches) {
  const stats = statsByPlayer(t, matches);
  const rank = finalRanking(t, st);
  const rows = rank.map((r) => {
    const s = stats.get(r.id);
    return `<tr><td>${esc(r.placeText)}</td><td class="${r.place === 1 ? 'win' : ''}">${esc(nameOf(t, r.id))}</td><td class="num">${s ? dec(s.average) : ''}</td><td class="num">${s ? s.highest || '' : ''}</td><td class="num">${s ? s.highestCheckout || '' : ''}</td><td class="num">${s ? s.c180 || 0 : ''}</td></tr>`;
  }).join('');
  const groups = st.groups.length ? `<h2>${t.format === 'rr' ? 'Tabelle' : 'Gruppen'}</h2><p class="dim">${esc(TIEBREAK_TEXT)}</p><div class="groups">${st.groups.map((g) => `<div><b>${st.groups.length > 1 ? esc(g.name) : ''}</b><table><tr><th>#</th><th>Spieler</th><th class="num">S</th><th class="num">U</th><th class="num">N</th><th class="num">Legs</th></tr>${g.table.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(nameOf(t, r.id))}</td><td class="num">${r.won}</td><td class="num">${r.drawn || 0}</td><td class="num">${r.lost}</td><td class="num">${r.legsFor}:${r.legsAgainst}</td></tr>`).join('')}</table></div>`).join('')}</div>` : '';
  const games = st.games.filter((g) => !g.bye).map((g) => `<tr><td class="dim">${esc(g.roundName)}</td><td class="${g.winnerId === g.a ? 'win' : ''}">${esc(nameOf(t, g.a, g.aLabel))}</td><td class="num">${esc(scoreOf(g) || (g.status === 'running' ? 'läuft' : '–'))}</td><td class="${g.winnerId === g.b ? 'win' : ''}">${esc(nameOf(t, g.b, g.bLabel))}</td></tr>`).join('');
  return `<h1>🏆 ${esc(t.name)}</h1><div class="dim">${esc(TOURNAMENT_FORMATS[t.format])} · ${t.players.length} Spieler · ${esc(rulesText(t))} · ${day(t.createdAt)} · ${esc(BRAND.name)}</div>
    <h2>Platzierung</h2><table><tr><th>Platz</th><th>Spieler</th><th class="num">Average</th><th class="num">Beste Aufnahme</th><th class="num">Höchstes Finish</th><th class="num">180er</th></tr>${rows}</table>
    ${groups}<h2>Alle Spiele</h2><table>${games}</table>`;
}

/**
 * Aushang für die Wand: je Gruppe die Spieler und alle Spiele mit Feldern zum Eintragen (bzw. schon das Ergebnis),
 * danach der K.-o.-Baum als Liste je Runde. Zum Ausdrucken, z. B. für Leute ohne Handy.
 */
function aushangHtml(t, st) {
  const games = (list) => `<table class="sched">${list.filter((g) => !g.bye).map((g) => `<tr><td class="dim">${esc(g.roundName.replace(/^Gruppe \w · /, ''))}</td><td>${esc(nameOf(t, g.a, g.aLabel))}</td><td class="score">${g.result ? esc(scoreOf(g)) : '____ : ____'}</td><td>${esc(nameOf(t, g.b, g.bLabel))}</td><td class="dim">${g.status === 'done' ? '✓' : '☐'}</td></tr>`).join('')}</table>`;
  const groups = st.groups.map((g) => `<section class="grp"><h2>${st.groups.length > 1 ? esc(g.name) : 'Spielplan'}</h2>
    <div class="players">${g.players.map((id) => `<span>${esc(nameOf(t, id))}</span>`).join('')}</div>${games(g.games)}</section>`).join('');
  const ko = st.koRounds.length ? `<section class="ko"><h2>K.-o.-Runde</h2>${st.koRounds.map((r) => `<h3>${esc(r.name)}</h3>${games(r.games)}`).join('')}</section>` : '';
  return `<h1>🎯 ${esc(t.name)}</h1><div class="dim">${esc(TOURNAMENT_FORMATS[t.format])} · ${esc(rulesText(t))}${t.format === 'gko' ? ' · Platz 1 und 2 jeder Gruppe kommen weiter' : ''} · Stand ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</div>
    <div class="groups">${groups}</div>${ko}<p class="dim small">${esc(TIEBREAK_TEXT)}</p>`;
}
const AUSHANG_CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  .groups { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm 8mm; }
  .grp, .ko h3, .ko table { break-inside: avoid; }
  .players { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 6px; font-weight: 700; }
  .sched td { padding: 3px 4px; } .sched .score { text-align: center; white-space: nowrap; font-weight: 700; }
  .ko { margin-top: 8mm; } .ko h3 { margin: 10px 0 4px; font-size: 14px; } .small { font-size: 11px; }`;

/** Urkunden: eine Seite je Platz (Podest oder alle Spieler). */
function certificatesHtml(t, st, matches, list) {
  const stats = statsByPlayer(t, matches);
  return list.map((r) => {
    const s = stats.get(r.id);
    const extra = s ? [s.average ? `Average ${dec(s.average)}` : '', s.highestCheckout ? `Höchstes Finish ${s.highestCheckout}` : '', s.c180 ? `${s.c180}× 180` : ''].filter(Boolean).join(' · ') : '';
    return `<section class="cert"><div class="frame">
      <div class="brand">${esc(BRAND.name)}</div><div class="kind">Urkunde</div>
      <div class="name">${esc(nameOf(t, r.id))}</div>
      <div class="place">${r.place === 1 ? '🏆 Turniersieger' : `belegte den ${esc(r.placeText)} Platz`}</div>
      <div class="event">beim Turnier „${esc(t.name)}“ am ${day(t.createdAt)}</div>
      ${extra ? `<div class="extra">${esc(extra)}</div>` : ''}
      <div class="sign"><span>Turnierleitung</span></div></div></section>`;
  }).join('');
}
const CERT_CSS = `
  @page { size: A4 landscape; margin: 0; } body { margin: 0; }
  .cert { width: 297mm; height: 210mm; box-sizing: border-box; padding: 14mm; page-break-after: always; display: flex; }
  .frame { flex: 1; border: 3mm double #22c55e; border-radius: 6mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6mm; text-align: center; }
  .brand { letter-spacing: .3em; text-transform: uppercase; color: #16a34a; font-weight: 800; }
  .kind { font-size: 22mm; font-weight: 900; font-family: Georgia, serif; }
  .name { font-size: 16mm; font-weight: 800; border-bottom: 1px solid #999; padding: 0 12mm 2mm; }
  .place { font-size: 9mm; font-weight: 700; } .event { font-size: 6mm; color: #444; } .extra { font-size: 5mm; color: #16a34a; }
  .sign { margin-top: 10mm; width: 70mm; border-top: 1px solid #333; padding-top: 2mm; font-size: 4mm; color: #555; }`;

/** Auswahl: CSV, Ergebnisliste drucken/PDF, Urkunden (Podest oder alle). */
export function exportSheet(t, st, matches) {
  const safe = (t.name || 'Turnier').replace(/[^\wäöüÄÖÜß -]/g, '').trim().replace(/\s+/g, '-');
  const rank = finalRanking(t, st);
  const sh = sheet(h('div', { class: 'stack' },
    h('h2', {}, '📄 Drucken & Export'),
    st.done ? null : h('div', { class: 'small warn' }, 'Das Turnier läuft noch – Platzierung und Werte sind ein Zwischenstand.'),
    h('button', { class: 'btn', onclick: () => { download(`${safe}-Ergebnisse.csv`, csv(t, st, matches), 'text/csv;charset=utf-8'); toast('📊 CSV gespeichert'); } }, '📊 Ergebnisse als CSV (Excel)'),
    h('button', { class: 'btn', onclick: () => printHtml(`${t.name} – Aushang`, aushangHtml(t, st), AUSHANG_CSS) }, '🗒️ Aushang: Gruppen & Spielplan (A4, zum Eintragen)'),
    h('button', { class: 'btn', onclick: () => printHtml(`${t.name} – Ergebnisse`, resultsHtml(t, st, matches)) }, '🖨️ Ergebnisliste drucken / als PDF'),
    h('button', { class: 'btn', onclick: () => printHtml(`${t.name} – Urkunden`, certificatesHtml(t, st, matches, rank.filter((r) => r.place <= 3)), CERT_CSS) }, '🏆 Urkunden Platz 1–3'),
    h('button', { class: 'btn', onclick: () => printHtml(`${t.name} – Urkunden`, certificatesHtml(t, st, matches, rank), CERT_CSS) }, `📜 Urkunden für alle (${rank.length})`),
    h('div', { class: 'small dim' }, 'PDF: im Druckdialog als Drucker „Als PDF speichern“ wählen.'),
    h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
}
