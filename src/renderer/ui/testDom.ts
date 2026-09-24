/**
 * A very small DOM for specs that must re-render a component (M12d: render
 * counts, the reveal across completion). Specs run under node and the allowed
 * dependencies hold no DOM library, so this implements only what react-dom's
 * client needs for the bubbles: nodes, attributes, styles, innerHTML as a
 * string, no layout and no events. Not for app code.
 */

type Listener = (event: unknown) => void;

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  readonly ownerDocument: FakeDocument;
  readonly nodeType: number;
  readonly nodeName: string;

  constructor(ownerDocument: FakeDocument | null, nodeType: number, nodeName: string) {
    this.ownerDocument = ownerDocument ?? (this as unknown as FakeDocument);
    this.nodeType = nodeType;
    this.nodeName = nodeName;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get parentElement(): FakeNode | null {
    return this.parentNode;
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  contains(other: FakeNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  get textContent(): string {
    return this.childNodes.map(child => child.textContent).join('');
  }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value !== '') this.appendChild(new FakeText(this.ownerDocument, value));
  }

  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

class FakeText extends FakeNode {
  nodeValue: string;
  constructor(ownerDocument: FakeDocument, value: string) {
    super(ownerDocument, 3, '#text');
    this.nodeValue = value;
  }
  get data(): string {
    return this.nodeValue;
  }
  override get textContent(): string {
    return this.nodeValue;
  }
  override set textContent(value: string) {
    this.nodeValue = value;
  }
}

class FakeComment extends FakeText {}

/** Tags and the text of `innerHTML`, enough for a spec to read what was painted. */
const htmlText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly namespaceURI: string;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> & { setProperty: (name: string, value: string) => void; removeProperty: (name: string) => void };
  private html: string | null = null;

  constructor(ownerDocument: FakeDocument, tag: string, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(ownerDocument, 1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
    this.namespaceURI = namespaceURI;
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => {
        style[name] = value;
      },
      removeProperty: (name: string) => {
        delete style[name];
      },
    });
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  removeAttributeNS(_ns: string | null, name: string): void {
    this.removeAttribute(name);
  }

  get innerHTML(): string {
    return this.html ?? '';
  }
  set innerHTML(value: string) {
    this.textContent = '';
    this.html = value;
  }
  override get textContent(): string {
    return this.html !== null ? htmlText(this.html) : super.textContent;
  }
  override set textContent(value: string) {
    this.html = null;
    super.textContent = value;
  }

  /** Elements under this one (itself included) whose `data-testid` is `id`. */
  byTestId(id: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeNode) => {
      if (node instanceof FakeElement && node.getAttribute('data-testid') === id) found.push(node);
      node.childNodes.forEach(walk);
    };
    walk(this);
    return found;
  }

  focus(): void {}
  blur(): void {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  scrollIntoView(): void {}
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  visibilityState = 'visible';
  defaultView: unknown = null;

  constructor() {
    super(null, 9, '#document');
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  get activeElement(): FakeElement {
    return this.body;
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  createElementNS(namespaceURI: string, tag: string): FakeElement {
    return new FakeElement(this, tag, namespaceURI);
  }
  createTextNode(value: string): FakeText {
    return new FakeText(this, value);
  }
  createComment(value: string): FakeComment {
    return new FakeComment(this, value);
  }
  hasFocus(): boolean {
    return true;
  }
}

export type TestElement = FakeElement;

/**
 * Installs `document`, `window` and the few globals react-dom and the room
 * read, and returns a container to render into. Call once per spec file.
 */
export const installTestDom = (): { document: FakeDocument; container: FakeElement } => {
  const document = new FakeDocument();
  const scope = globalThis as Record<string, unknown>;
  class HTMLIFrameElement {}
  class IntersectionObserver {
    observe(): void {}
    disconnect(): void {}
  }
  const win = {
    document,
    HTMLIFrameElement,
    IntersectionObserver,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 16),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  };
  document.defaultView = win;
  Object.assign(scope, {
    document,
    window: Object.assign(scope, win),
    HTMLIFrameElement,
    HTMLElement: FakeElement,
    Element: FakeElement,
    Node: FakeNode,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { document, container };
};
