import { JSDOM } from 'jsdom';

/**
 * A minimal browser for component tests.
 *
 * No testing-library: these tests drive React directly through `createRoot` and
 * `act`, which is enough for the behaviour under test (does the widget appear,
 * is Submit disabled, does a callback update state) and keeps the dependency
 * footprint to jsdom plus the esbuild JSX transform in tests/setup.mjs.
 *
 * ## Why the globals are installed before react-dom is imported
 *
 * react-dom decides AT IMPORT TIME whether the browser supports native `input`
 * events. With no `document` in scope it assumes not, and falls back to a legacy
 * IE code path that calls `element.attachEvent` — which jsdom does not implement,
 * so the first real keystroke throws and react-hook-form never records a value.
 *
 * So the jsdom window is created at module scope and react-dom is imported after
 * it, via top-level await. One window is reused for the whole file; `setupDom()`
 * resets its body between tests rather than building a new one, which also keeps
 * React's module-level state consistent.
 *
 * Cloudflare's real script is never loaded. `installTurnstileStub` puts a fake
 * `window.turnstile` in place whose `render` hands back the callbacks, so a test
 * can fire the success, expiry and error paths deliberately.
 */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://marketing.unitedmortgage.com/custom-requests',
  pretendToBeVisual: true,
});

// Node 24 defines some of these (notably `navigator`) as getter-only on
// globalThis, so a plain assignment throws. defineProperty replaces them.
const GLOBAL_KEYS = [
  'window', 'document', 'navigator', 'getComputedStyle',
  'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement',
  'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
];

for (const key of GLOBAL_KEYS) {
  const value = key === 'window' ? dom.window : dom.window[key];
  if (value === undefined) continue;
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

// React 19 checks this before allowing act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Imported only now that a document exists — see the note above.
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

/** Reset the shared document between tests. */
export function setupDom() {
  dom.window.document.body.innerHTML = '';
  delete dom.window.turnstile;
  return dom;
}

export function teardownDom() {
  dom.window.document.body.innerHTML = '';
  delete dom.window.turnstile;
}

/**
 * A stand-in for Cloudflare's `window.turnstile`.
 *
 * Records every render/reset/remove and exposes the options object, so a test
 * can invoke the exact callbacks the real widget would: `callback(token)`,
 * `expired-callback()`, `error-callback()`.
 */
export function installTurnstileStub() {
  const state = { renders: [], resets: [], removes: [], nextId: 1 };

  globalThis.window.turnstile = {
    render(container, options) {
      const id = `widget-${state.nextId++}`;
      state.renders.push({ id, container, options });
      return id;
    },
    reset(id) {
      state.resets.push(id);
    },
    remove(id) {
      state.removes.push(id);
    },
  };

  state.latest = () => state.renders[state.renders.length - 1];
  /** Fire the success callback of the most recently rendered widget. */
  state.succeed = async (token) => {
    await act(async () => {
      state.latest().options.callback(token);
    });
  };
  state.expire = async () => {
    await act(async () => {
      state.latest().options['expired-callback']();
    });
  };
  state.error = async () => {
    await act(async () => {
      state.latest().options['error-callback']();
    });
  };

  return state;
}

/** Render `element` into a fresh container and return helpers to drive it. */
export async function render(element) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    root,
    html: () => container.innerHTML,
    text: () => container.textContent,
    find: (selector) => container.querySelector(selector),
    findAll: (selector) => [...container.querySelectorAll(selector)],
    byTestId: (id) => container.querySelector(`[data-testid="${id}"]`),
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
    click: async (el) => {
      await act(async () => {
        el.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    /**
     * Set a value the way a user would. The native prototype setter bypasses
     * React's own value tracker, so the change is not discarded as a no-op. The
     * prototype is chosen per element because the form mixes input, select and
     * textarea.
     */
    type: async (el, value) => {
      const { HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, Event } = globalThis.window;
      const prototype =
        el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    check: async (el, checked = true) => {
      const { HTMLInputElement, Event } = globalThis.window;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(el, checked);
        el.dispatchEvent(new Event('click', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

export { act };
