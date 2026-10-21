// Kleine DOM-Hilfen ohne Framework.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let toastTimer = null;
export function toast(text, ms = 2200) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' }, text);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

let bannerTimer = null;
export function banner(text, ms = 1600) {
  document.querySelectorAll('.banner').forEach((t) => t.remove());
  const b = h('div', { class: 'banner' }, text);
  document.body.appendChild(b);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.remove(), ms);
}

/** Unteres Blatt (Sheet). Gibt { el, close } zurück. */
export function sheet(content, { onClose, dismissable = true } = {}) {
  const bg = h('div', { class: 'overlay-bg' });
  const box = h('div', { class: 'sheet' }, content);
  bg.appendChild(box);
  const close = () => { bg.remove(); onClose && onClose(); };
  if (dismissable) bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  return { el: box, close };
}

export function confirmDialog(title, text, { ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
  return new Promise((resolve) => {
    let s;
    const done = (v) => { s.close(); resolve(v); };
    s = sheet(h('div', { class: 'stack' },
      h('h2', {}, title),
      text ? h('p', { class: 'dim' }, text) : null,
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, ok),
      h('button', { class: 'btn ghost', onclick: () => done(false) }, cancel),
    ), { onClose: () => resolve(false) });
  });
}

export function promptDialog(title, value = '', { ok = 'Speichern', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let s;
    const input = h('input', { value, placeholder, maxlength: 24, autocapitalize: 'words', enterkeyhint: 'done' });
    const done = (v) => { s.close(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    s = sheet(h('div', { class: 'stack' },
      h('h2', {}, title), input,
      h('button', { class: 'btn primary', onclick: () => done(input.value) }, ok),
      h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Abbrechen'),
    ), { onClose: () => resolve(null) });
    setTimeout(() => input.focus(), 50);
  });
}
