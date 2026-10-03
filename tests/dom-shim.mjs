/**
 * DOM Shim for Node.js unit testing of UI components
 */

export class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.id = '';
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this._innerHTML = '';
    this._textContent = '';
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.dataset = {};
    this.parentElement = null;
    this.parentNode = null;
    this.style = {
      _props: new Map(),
      cssText: '',
      setProperty: (k, v) => {
        this.style._props.set(k, v);
      },
      getPropertyValue: (k) => this.style._props.get(k) || ''
    };
    this.classList = {
      add: (...tokens) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        tokens.forEach((t) => classes.add(t));
        this.className = Array.from(classes).join(' ');
      },
      remove: (...tokens) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        tokens.forEach((t) => classes.delete(t));
        this.className = Array.from(classes).join(' ');
      },
      contains: (token) => this.className.split(' ').includes(token),
      toggle: (token, force) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        const shouldAdd = force !== undefined ? force : !classes.has(token);
        if (shouldAdd) classes.add(token);
        else classes.delete(token);
        this.className = Array.from(classes).join(' ');
        return shouldAdd;
      }
    };
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
    this.children = [];
    parseHtmlToTree(val, this);
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.parentElement = null;
      child.parentNode = null;
      this.children.splice(idx, 1);
    }
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'id') return this.id;
    return this.attributes.get(name) || null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'class') this.className = '';
    if (name === 'id') this.id = '';
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) {
      const list = this.listeners.get(type).filter((l) => l !== listener);
      this.listeners.set(type, list);
    }
  }

  dispatchEvent(event) {
    const type = event.type || event;
    const list = this.listeners.get(type) || [];
    list.forEach((l) => l(event));
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {}, stopPropagation: () => {} });
  }

  focus() {
    this.dispatchEvent({ type: 'focus', target: this });
  }

  blur() {
    this.dispatchEvent({ type: 'blur', target: this });
  }

  select() {}

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const results = this.querySelectorAll(selector);
    return results[0] || null;
  }

  querySelectorAll(selector) {
    const matched = [];
    const walk = (el) => {
      if (matchesSelector(el, selector)) {
        matched.push(el);
      }
      el.children.forEach(walk);
    };
    this.children.forEach(walk);
    return matched;
  }
}

const VOID_TAGS = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);

function parseHtmlToTree(html, parentNode) {
  if (typeof html !== 'string' || !html.trim()) return;

  const tagTokenRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)([^>]*)(\/?)>|([^<]+)/g;
  const stack = [parentNode];
  let match;

  while ((match = tagTokenRegex.exec(html)) !== null) {
    if (match[0].startsWith('<!--')) {
      continue;
    }

    const isClosing = Boolean(match[1]);
    const tagName = match[2];
    const rawAttrs = match[3];
    const isSelfClosing = Boolean(match[4]);
    const textContent = match[5];

    if (textContent) {
      const current = stack[stack.length - 1];
      if (current && textContent.trim()) {
        const textNode = new MockElement('#text');
        textNode.textContent = textContent;
        current.appendChild(textNode);
      }
      continue;
    }

    if (!tagName) continue;

    const tagUpper = tagName.toUpperCase();

    if (isClosing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tagUpper) {
          stack.length = i;
          break;
        }
      }
    } else {
      const el = new MockElement(tagUpper);
      if (rawAttrs) {
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let aMatch;
        while ((aMatch = attrRegex.exec(rawAttrs)) !== null) {
          const aName = aMatch[1];
          const aVal = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] !== undefined ? aMatch[4] : 'true'));
          el.setAttribute(aName, aVal);
        }
      }

      const current = stack[stack.length - 1];
      if (current) {
        current.appendChild(el);
      }

      if (!isSelfClosing && !VOID_TAGS.has(tagUpper)) {
        stack.push(el);
      }
    }
  }
}

function matchesSelector(el, selector) {
  if (!el || !selector) return false;
  if (selector.startsWith('.')) {
    return el.classList.contains(selector.slice(1));
  }
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  if (selector.includes('[') && selector.includes(']')) {
    const raw = selector.replace(/[\[\]]/g, '');
    const parts = raw.split('=');
    const attr = parts[0].trim();
    if (parts.length > 1) {
      const val = parts[1].replace(/['"]/g, '').trim();
      return el.getAttribute(attr) === val;
    }
    return el.hasAttribute(attr);
  }
  return el.tagName === selector.toUpperCase();
}

export function setupDomShim() {
  globalThis.HTMLElement = MockElement;
  globalThis.HTMLButtonElement = MockElement;
  globalThis.HTMLInputElement = MockElement;
  globalThis.HTMLDivElement = MockElement;

  if (typeof globalThis.document === 'undefined') {
    const documentBody = new MockElement('body');
    const documentElement = new MockElement('html');
    documentElement.appendChild(documentBody);

    globalThis.document = {
      createElement: (tagName) => new MockElement(tagName),
      documentElement,
      body: documentBody,
      getElementById: (id) => documentElement.querySelector(`#${id}`),
      querySelector: (sel) => documentElement.querySelector(sel),
      querySelectorAll: (sel) => documentElement.querySelectorAll(sel)
    };
  }

  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      document: globalThis.document,
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
    };
  } else {
    if (!globalThis.window.addEventListener) globalThis.window.addEventListener = () => {};
    if (!globalThis.window.removeEventListener) globalThis.window.removeEventListener = () => {};
  }
}
