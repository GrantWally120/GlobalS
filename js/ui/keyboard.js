// Keyboard shortcuts (ignored while typing in a field).

export function initKeyboard(app) {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === 'Escape') {
      if (!typing) app.deselect();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const handled = {
      '/': () => app.focusSearch(),
      ' ': () => app.setRate(app.clock.rate === 0 ? app.clock.lastNonZeroRate || 1 : 0),
      '[': () => app.setRate(app.clock.nextRate(-1)),
      ']': () => app.setRate(app.clock.nextRate(+1)),
      n: () => app.backToNow(),
      f: () => app.toggleFollow(),
      o: () => app.setShow('paths', !app.settings.show.paths),
      v: () => app.setStyle(app.settings.style === 'holo' ? 'photo' : 'holo'),
      c: () => app.setShow('constellations', !app.settings.show.constellations),
      g: () => app.setShow('grid', !app.settings.show.grid),
      r: () => app.resetView(),
      '?': () => app.showHelp(),
    }[k.length === 1 ? k.toLowerCase() : k];
    if (handled) {
      e.preventDefault();
      handled();
    } else if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault();
      app.jumpTo(app.clock.now() + (k === 'ArrowRight' ? 3600e3 : -3600e3));
    }
  });
}
