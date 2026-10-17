/**
 * Tiny element builder: h('div.card', { onclick }, 'text', child).
 * Props: `class`, `style` (object), `html` (trusted markup only), on* handlers,
 * anything else becomes an attribute.
 */
export function h(tag, props = {}, ...children) {
  if (!isProps(props)) {
    children.unshift(props);
    props = {};
  }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    // ARIA states are spelled out: aria-pressed="false" is meaningful, an empty value is not
    if (k.startsWith('aria-') && typeof v === 'boolean') {
      el.setAttribute(k, String(v));
      continue;
    }
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.classList.add(...String(v).split(' ').filter(Boolean));
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** A plain object literal is props; anything else (text, nodes, arrays, null) is a child. */
function isProps(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node);
}
