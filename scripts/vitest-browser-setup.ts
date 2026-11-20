// jsdom has no layout engine or top layer. Keep API shims here; browser checks
// cover real resizing, focus, inertness, and modal stacking.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
}

if (typeof window !== 'undefined' && typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window !== 'undefined') {
  // findBy* waits 1 s by default. Lazy chunks and renders can pass that on a loaded machine;
  // 3 s stays under the 5 s test timeout, so a missing element still fails.
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 3000 });
}
