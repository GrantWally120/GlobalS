// Tiny DOM helpers. Text always goes through textContent (never innerHTML) — names come from data.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el('li', { class: 'x', onclick: fn, 'aria-selected': true }, 'text', childNode) */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

export function svg(tag, attrs = {}, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/** Set text only when it changed (avoids layout churn in 4 Hz updates). */
export function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

/** Definition list rows: [[label, value, className?], …] */
export function fillKv(dl, rows) {
  const want = rows.length * 2;
  while (dl.children.length > want) dl.lastChild.remove();
  rows.forEach(([k, v, cls], i) => {
    let dt = dl.children[2 * i];
    let dd = dl.children[2 * i + 1];
    if (!dt) {
      dt = dl.appendChild(document.createElement('dt'));
      dd = dl.appendChild(document.createElement('dd'));
    }
    setText(dt, k);
    setText(dd, v);
    dd.className = cls || '';
  });
}
