(() => {
  const SETTINGS_REQUEST_TIMEOUT_MS = 30_000;
  let nativeLocale = detectBrowserLocale();
  let themePreference = "system";
  let lastNativePreferences;

  function detectBrowserLocale() {
    for (const tag of [...(navigator.languages ?? []), navigator.language]) {
      const locale = tag?.toLowerCase().split("-")[0];
      if (locale === "zh" || locale === "en") return locale;
    }
    return "zh";
  }

  function isTopLevelLoopbackPage() {
    try {
      return (
        window.top === window &&
        location.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(location.hostname)
      );
    } catch {
      return false;
    }
  }

  function settingsMethod(input) {
    try {
      const rawUrl =
        typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      const url = new URL(rawUrl, location.href);
      if (url.origin !== location.origin) return undefined;
      return /^\/api\/settings\.(describe|update|replace|mutate)$/.exec(url.pathname)?.[1];
    } catch {
      return undefined;
    }
  }

  function syncNativePreferences() {
    const key = `${themePreference}:${nativeLocale}`;
    if (key === lastNativePreferences) return;
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return;

    lastNativePreferences = key;
    void invoke("sync_dsh_preferences", {
      theme: themePreference,
      locale: nativeLocale,
    }).catch(() => {
      if (lastNativePreferences === key) lastNativePreferences = undefined;
    });
  }

  async function adoptSettingsResponse(response, method) {
    try {
      const payload = await response.json();
      if (payload?.result?.ok !== true) return;
      const value = payload.result.value;
      const descriptors = method === "describe" ? value?.namespaces : [value];
      if (!Array.isArray(descriptors)) return;

      for (const descriptor of descriptors) {
        const preference = descriptor?.value?.preference;
        if (
          descriptor?.ns === "ui-theme" &&
          ["light", "dark", "system"].includes(preference)
        ) {
          themePreference = preference;
        }
        if (descriptor?.ns === "locale" && ["zh", "en"].includes(preference)) {
          nativeLocale = preference;
        }
      }
      syncNativePreferences();
    } catch {
      // DSH remains authoritative; a later settings response will retry the sync.
    }
  }

  function installPreferenceBridge() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const method = settingsMethod(args[0]);
      const response = await originalFetch(...args);
      if (method) void adoptSettingsResponse(response.clone(), method);
      return response;
    };

    const rpcId = `openharness-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    void (async () => {
      try {
        const response = await originalFetch("/api/settings.describe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(SETTINGS_REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            type: "client-request",
            rpcId,
            method: "settings.describe",
            payload: {},
          }),
        });
        await adoptSettingsResponse(response, "describe");
      } finally {
        // Even when DSH settings are unavailable, initialize native chrome from browser defaults.
        syncNativePreferences();
      }
    })().catch(() => {});
  }

  function caretAtPoint(x, y) {
    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(x, y);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    return undefined;
  }

  function pointHitsText(x, y) {
    const caret = caretAtPoint(x, y);
    if (caret === undefined) return undefined;
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return false;

    const text = caret.node.data;
    for (const index of new Set([caret.offset - 1, caret.offset])) {
      if (index < 0 || index >= text.length || !/\S/.test(text[index])) continue;
      const character = document.createRange();
      character.setStart(caret.node, index);
      character.setEnd(caret.node, index + 1);
      for (const rect of character.getClientRects()) {
        const horizontalTolerance = 2;
        if (
          x >= rect.left - horizontalTolerance &&
          x <= rect.right + horizontalTolerance &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function isEditable(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])"))
    );
  }

  function suppressBlankDoubleClick(event) {
    if (event.button !== 0 || event.detail !== 2 || isEditable(event.target)) return;
    if (pointHitsText(event.clientX, event.clientY) !== false) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
  }

  if (!isTopLevelLoopbackPage()) return;
  document.addEventListener("mousedown", suppressBlankDoubleClick, true);
  document.addEventListener("dblclick", suppressBlankDoubleClick, true);

  installPreferenceBridge();
})();
