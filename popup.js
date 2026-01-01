/*
 * LMArena Plus - Adds pricing and other useful data to LMArena's leaderboard tables.
 * Copyright (C) 2025 LMArena Plus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

(function () {
    'use strict';

    const DEFAULT_TOKEN_UNIT = 1000000; // 1M tokens
    const DEFAULT_PROVIDER = 'openrouter';
    const TOKEN_UNIT_KEY = 'lmarena-token-unit';
    const PROVIDER_KEY = 'lmarena-data-provider';
    const COLUMN_VISIBILITY_KEY = 'lmarena-column-visibility';

    // Default column visibility - all columns visible
    const DEFAULT_COLUMN_VISIBILITY = {
        'rank': true,
        'arena-score': true,
        '95-ci': true,
        'votes': true,
        'organization': true,
        'license': true,
        'pricing': true,
        'bang-for-buck': true,
        'context-window': true,
        'modalities': true
    };

    const PROVIDER_URLS = {
        openrouter: 'https://openrouter.ai',
        helicone: 'https://helicone.ai',
        litellm: 'https://github.com/BerriAI/litellm'
    };

    const tokenUnitSelect = document.getElementById('token-unit');
    const dataProviderSelect = document.getElementById('data-provider');
    const attributionDiv = document.getElementById('attribution');
    const columnCheckboxes = document.querySelectorAll('.column-picker input[type="checkbox"]');
    const pricingLabel = document.getElementById('pricing-label');
    const battleNotificationCheckbox = document.getElementById('battle-notification');
    const notificationHint = document.getElementById('notification-hint');

    // Update pricing label based on token unit
    function updatePricingLabel(unit) {
        const label = unit === 1000000 ? 'Pricing per 1M' : 'Pricing per 100K';
        pricingLabel.textContent = label;
    }

    // Load saved preferences
    async function loadPreferences() {
        try {
            const result = await chrome.storage.sync.get([TOKEN_UNIT_KEY, PROVIDER_KEY, COLUMN_VISIBILITY_KEY, BATTLE_NOTIFICATION_KEY]);

            const savedUnit = result[TOKEN_UNIT_KEY] || DEFAULT_TOKEN_UNIT;
            tokenUnitSelect.value = savedUnit.toString();
            updatePricingLabel(savedUnit);

            const savedProvider = result[PROVIDER_KEY] || DEFAULT_PROVIDER;
            dataProviderSelect.value = savedProvider;
            updateAttribution(savedProvider);

            // Load column visibility
            const savedVisibility = result[COLUMN_VISIBILITY_KEY] || DEFAULT_COLUMN_VISIBILITY;
            columnCheckboxes.forEach(checkbox => {
                const columnId = checkbox.getAttribute('data-column');
                if (columnId && savedVisibility.hasOwnProperty(columnId)) {
                    checkbox.checked = savedVisibility[columnId];
                }
            });

            // Load battle notification setting
            const notificationEnabled = result[BATTLE_NOTIFICATION_KEY] || false;
            battleNotificationCheckbox.checked = notificationEnabled;
            updateNotificationHint();
        } catch (error) {
            console.warn('Failed to load preferences:', error);
            tokenUnitSelect.value = DEFAULT_TOKEN_UNIT.toString();
            dataProviderSelect.value = DEFAULT_PROVIDER;
        }
    }

    // Update notification hint based on permission status
    function updateNotificationHint() {
        // Only show hint for error states - keep UI clean otherwise
        if (!('Notification' in window)) {
            notificationHint.textContent = 'Notifications not supported in this browser';
            notificationHint.className = 'setting-hint setting-hint--error';
            battleNotificationCheckbox.disabled = true;
        } else if (Notification.permission === 'denied') {
            notificationHint.textContent = 'Notifications blocked. Enable in browser settings.';
            notificationHint.className = 'setting-hint setting-hint--error';
        } else {
            // Clear hint for normal states - tooltip explains the feature
            notificationHint.textContent = '';
            notificationHint.className = 'setting-hint';
        }
    }

    // Update attribution based on selected provider
    function updateAttribution(provider) {
        attributionDiv.textContent = 'All data is provided by ';

        // Always show OpenRouter first
        const openRouterLink = document.createElement('a');
        openRouterLink.href = PROVIDER_URLS.openrouter;
        openRouterLink.target = '_blank';
        openRouterLink.textContent = 'OpenRouter';
        attributionDiv.appendChild(openRouterLink);

        // Add secondary provider if not OpenRouter
        if (provider !== 'openrouter') {
            attributionDiv.appendChild(document.createTextNode(', '));
            const secondaryLink = document.createElement('a');
            secondaryLink.href = PROVIDER_URLS[provider];
            secondaryLink.target = '_blank';
            secondaryLink.textContent = provider === 'litellm' ? 'LiteLLM' : 'Helicone';
            attributionDiv.appendChild(secondaryLink);
        }
    }

    // Get current column visibility state
    function getColumnVisibility() {
        const visibility = {};
        columnCheckboxes.forEach(checkbox => {
            const columnId = checkbox.getAttribute('data-column');
            if (columnId) {
                visibility[columnId] = checkbox.checked;
            }
        });
        return visibility;
    }

    // Save preference and notify content scripts
    async function savePreference(key, value, messageType) {
        try {
            await chrome.storage.sync.set({ [key]: value });

            // Notify content scripts to update
            const tabs = await chrome.tabs.query({ url: 'https://lmarena.ai/*' });
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, {
                    type: messageType,
                    value: value
                }).catch(() => {
                    // Tab may not have content script loaded
                });
            }
        } catch (error) {
            console.warn('Failed to save preference:', error);
        }
    }

    // Event listeners
    tokenUnitSelect.addEventListener('change', (e) => {
        const unit = parseInt(e.target.value, 10);
        updatePricingLabel(unit);
        savePreference(TOKEN_UNIT_KEY, unit, 'TOKEN_UNIT_CHANGED');
    });

    dataProviderSelect.addEventListener('change', async (e) => {
        const provider = e.target.value;
        updateAttribution(provider);

        // Save preference first
        await chrome.storage.sync.set({ [PROVIDER_KEY]: provider });

        // Hard reload all LMArena tabs to fetch fresh data from new provider
        const tabs = await chrome.tabs.query({ url: 'https://lmarena.ai/*' });
        for (const tab of tabs) {
            chrome.tabs.reload(tab.id, { bypassCache: true });
        }
    });

    // Column visibility checkboxes
    columnCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const visibility = getColumnVisibility();
            savePreference(COLUMN_VISIBILITY_KEY, visibility, 'COLUMN_VISIBILITY_CHANGED');
        });
    });

    // Battle notification toggle
    battleNotificationCheckbox.addEventListener('change', async () => {
        const enabled = battleNotificationCheckbox.checked;
        await chrome.storage.sync.set({ [BATTLE_NOTIFICATION_KEY]: enabled });
        updateNotificationHint();

        // Notify content scripts
        const tabs = await chrome.tabs.query({ url: 'https://lmarena.ai/*' });
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
                type: 'BATTLE_NOTIFICATION_CHANGED',
                value: enabled
            }).catch(() => { });
        }
    });

    // Display version number
    function displayVersion() {
        const versionSpan = document.getElementById('popup-version');
        if (versionSpan && chrome.runtime.getManifest) {
            const manifest = chrome.runtime.getManifest();
            versionSpan.textContent = `v${manifest.version}`;
        }
    }
    // Minimal tooltip handler (uses shared CSS from styles.css and data from shared.js)
    const tooltip = document.getElementById('popup-tooltip');
    let hideTimeout;

    document.querySelectorAll('[data-tooltip]').forEach(el => {
        el.addEventListener('mouseenter', () => {
            clearTimeout(hideTimeout);
            const key = el.dataset.tooltip;
            const info = COLUMN_TOOLTIPS[key];
            if (!info) return;

            tooltip.innerHTML = `
                <div class="lmarena-price-tooltip__total">${info.title}</div>
                <div class="lmarena-price-tooltip__explanation">${info.description}</div>
            `;
            tooltip.classList.add('lmarena-price-tooltip--visible');

            // Position above the element (like the rest of the extension)
            const rect = el.getBoundingClientRect();
            tooltip.style.left = `${rect.left}px`;
            // First render to get tooltip dimensions
            tooltip.style.top = '0px';
            const tooltipHeight = tooltip.offsetHeight;
            tooltip.style.top = `${rect.top - tooltipHeight - 6}px`;
        });

        el.addEventListener('mouseleave', () => {
            hideTimeout = setTimeout(() => {
                tooltip.classList.remove('lmarena-price-tooltip--visible');
            }, 100);
        });
    });

    // Initialize
    loadPreferences();
    displayVersion();
})();
