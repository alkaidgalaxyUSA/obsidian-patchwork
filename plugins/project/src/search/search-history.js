// Copyright 2000-2025 JetBrains s.r.o. and contributors. SPDX-License-Identifier: Apache-2.0
// Adapted from SearchHistoryList.kt and HistoryIterator.kt; see SOURCE.md.
export function saveSearch(history, text, category) {
    if (!text) return;
    const existing = history.findIndex(item => item.text === text && item.category === category);
    if (existing >= 0) history.splice(existing, 1);
    history.push({ text, category });
    if (history.filter(item => item.category === category).length > 50) history.splice(history.findIndex(item => item.category === category), 1);
}

export function historyItems(history, category) {
    return [...new Set(history.filter(item => category === "all" || item.category === category).map(item => item.text))].slice(-50);
}
