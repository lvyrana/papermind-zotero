/* Copyright (C) 2026 lvyrana · SPDX-License-Identifier: AGPL-3.0-only */
/* global Zotero, document, setTimeout */
// The pane fragment may be inserted after this script runs, so wait briefly for it.
(function render(attempt = 0) {
  const root = document.getElementById('litfinch-prefs-root')
  if (root && !root.dataset.ready) {
    root.dataset.ready = '1'
    Zotero.LitFinchPrefs?.render(root)
  } else if (!root && attempt < 40) setTimeout(() => render(attempt + 1), 50)
})()
