/* Мини-движок прототипа: шаблон с {{...}}, <sc-if>, <sc-for>, onClick/onChange,
   компонент с state/setState. Перерисовка через простой diff, чтобы не сбивались
   прокрутка и фокус в полях ввода. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const p = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, p);
      if (this.__render) this.__schedule();
    }
  }
  window.DCLogic = DCLogic;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scope) {
    const parts = path.split('.');
    let cur;
    if (Object.prototype.hasOwnProperty.call(scope.locals, parts[0])) cur = scope.locals[parts[0]];
    else cur = scope.vals[parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function evalValue(str, scope) {
    const m = str.match(WHOLE);
    if (m) return lookup(m[1], scope);
    return str.replace(HOLE, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });
  }
  function fixHref(v) {
    return typeof v === 'string' ? v.replace(/([A-Za-z]+)\.dc\.html/, (_, n) => (window.__PAGE_MAP__ && window.__PAGE_MAP__[n]) || n.toLowerCase() + '.html') : v;
  }

  // --- шаблон -> виртуальные узлы
  function build(node, scope, out) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      out.push({ text: t.indexOf('{{') >= 0 ? evalValue(t, scope) : t });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-if') {
      const v = evalValue(node.getAttribute('value') || '', scope);
      if (v && v !== 'false') for (const c of node.childNodes) build(c, scope, out);
      return;
    }
    if (tag === 'sc-for') {
      const list = evalValue(node.getAttribute('list') || '', scope);
      const as = node.getAttribute('as') || 'item';
      if (Array.isArray(list)) {
        list.forEach((item, i) => {
          const s = { vals: scope.vals, locals: Object.assign({}, scope.locals, { [as]: item, $index: i }) };
          for (const c of node.childNodes) build(c, s, out);
        });
      }
      return;
    }
    const v = { tag, ns: node.namespaceURI, attrs: {}, events: {}, props: {}, children: [] };
    for (const a of Array.from(node.attributes)) {
      const name = a.name;
      if (name.indexOf('hint-') === 0) continue;
      const lname = name.toLowerCase();
      if (lname === 'onclick' || lname === 'onchange' || lname === 'oninput') {
        const fn = evalValue(a.value, scope);
        if (typeof fn === 'function') {
          if (lname === 'onclick') v.events.click = fn;
          else v.events.input = fn;
        }
        continue;
      }
      let val = a.value.indexOf('{{') >= 0 ? evalValue(a.value, scope) : a.value;
      if (lname === 'href') val = fixHref(val);
      if ((tag === 'input' || tag === 'textarea') && lname === 'value') { v.props.value = val == null ? '' : String(val); continue; }
      if (val === undefined || val === null) continue;
      v.attrs[name] = typeof val === 'string' ? val : String(val);
    }
    for (const c of node.childNodes) build(c, scope, v.children);
    out.push(v);
  }

  // --- создание и обновление DOM
  function create(v) {
    if ('text' in v) return document.createTextNode(v.text);
    const el = v.ns === SVG_NS ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    el.__v = { tag: v.tag, attrs: {} };
    el.__h = {};
    update(el, v);
    for (const c of v.children) el.appendChild(create(c));
    return el;
  }
  function same(el, v) {
    if ('text' in v) return el.nodeType === 3;
    return el.nodeType === 1 && el.__v && el.__v.tag === v.tag;
  }
  function update(el, v) {
    const old = el.__v.attrs;
    for (const k in old) if (!(k in v.attrs)) el.removeAttribute(k);
    for (const k in v.attrs) if (old[k] !== v.attrs[k]) el.setAttribute(k, v.attrs[k]);
    el.__v.attrs = v.attrs;
    for (const type of ['click', 'input']) {
      const fn = v.events[type];
      if (fn && !el.__h[type]) {
        el.addEventListener(type, (e) => { const h = el.__h[type]; if (h) h(e); });
      }
      el.__h[type] = fn || null;
    }
    if ('value' in v.props && el.value !== v.props.value) el.value = v.props.value;
  }
  function patch(parent, vnodes) {
    const kids = parent.childNodes;
    for (let i = 0; i < vnodes.length; i++) {
      const v = vnodes[i];
      const el = kids[i];
      if (!el) { parent.appendChild(create(v)); continue; }
      if (!same(el, v)) { parent.replaceChild(create(v), el); continue; }
      if ('text' in v) { if (el.nodeValue !== v.text) el.nodeValue = v.text; continue; }
      update(el, v);
      patch(el, v.children);
    }
    while (parent.childNodes.length > vnodes.length) parent.removeChild(parent.lastChild);
  }

  window.mountPrototype = function (Component, tplId, mountId) {
    const tpl = document.getElementById(tplId);
    const root = document.getElementById(mountId);
    const comp = new Component({});
    let queued = false;
    comp.__schedule = () => { if (!queued) { queued = true; Promise.resolve().then(() => { queued = false; render(); }); } };
    function render() {
      let vals;
      try { vals = comp.renderVals() || {}; } catch (e) { console.error(e); return; }
      const out = [];
      const scope = { vals, locals: {} };
      for (const c of tpl.content.childNodes) build(c, scope, out);
      patch(root, out);
    }
    comp.__render = render;
    render();
  };
})();
