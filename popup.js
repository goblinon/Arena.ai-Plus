/*
 * Arena.ai Plus – Popup Script
 * Copyright (C) 2025 Arena.ai Plus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

(function () {
    'use strict';

    const DEFAULT_TOKEN_UNIT = 1000000;
    const DEFAULT_PROVIDER = 'openrouter';
    const TOKEN_UNIT_KEY = 'lmarena-token-unit';
    const PROVIDER_KEY = 'lmarena-data-provider';
    const COLUMN_VISIBILITY_KEY = 'lmarena-column-visibility';

    const DEFAULT_COLUMN_VISIBILITY = {
        'rank': true,
        'arena-score': true,
        'votes': true,
        'pricing': true,
        'bang-for-buck': true,
        'model-age': true,
        'context-window': true,
        'modalities': true
    };

    const PROVIDER_URLS = {
        openrouter: 'https://openrouter.ai',
        helicone: 'https://helicone.ai',
        litellm: 'https://github.com/BerriAI/litellm'
    };

    // DOM refs
    const tokenUnitSelect = document.getElementById('token-unit');
    const dataProviderSelect = document.getElementById('data-provider');
    const attributionDiv = document.getElementById('attribution');
    const pricingLabel = document.getElementById('pricing-label');
    const battleNotificationInput = document.getElementById('battle-notification');
    const notificationToggle = document.getElementById('notification-toggle');
    const notificationHint = document.getElementById('notification-hint');
    const columnItems = document.querySelectorAll('.column-item');

    // ---- Column checkbox toggle with animation ----
    function toggleColumnItem(item) {
        const input = item.querySelector('input[type="checkbox"]');
        const cb = item.querySelector('.checkbox');
        if (!input || !cb) return;

        input.checked = !input.checked;
        cb.classList.toggle('checked', input.checked);

        // Trigger ripple animation on check
        if (input.checked) {
            cb.classList.remove('ripple');
            void cb.offsetWidth; // force reflow
            cb.classList.add('ripple');
        }

        savePreference(COLUMN_VISIBILITY_KEY, getColumnVisibility(), 'COLUMN_VISIBILITY_CHANGED');
    }

    columnItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't toggle if user clicked the item for tooltip purposes on a non-checkbox area
            if (e.target.closest('.badge')) return;
            toggleColumnItem(item);
        });
    });

    // ---- Notification toggle ----
    notificationToggle.addEventListener('click', () => {
        const newState = !battleNotificationInput.checked;
        battleNotificationInput.checked = newState;
        notificationToggle.classList.toggle('on', newState);
        savePreference(BATTLE_NOTIFICATION_KEY, newState, 'BATTLE_NOTIFICATION_CHANGED');
        updateNotificationHint();
    });

    // ---- Pricing label ----
    function updatePricingLabel(unit) {
        pricingLabel.textContent = unit === 1000000 ? 'Pricing per 1M' : 'Pricing per 100K';
    }

    // ---- Load saved preferences ----
    async function loadPreferences() {
        try {
            const result = await chrome.storage.sync.get([TOKEN_UNIT_KEY, PROVIDER_KEY, COLUMN_VISIBILITY_KEY, BATTLE_NOTIFICATION_KEY]);

            const savedUnit = result[TOKEN_UNIT_KEY] || DEFAULT_TOKEN_UNIT;
            tokenUnitSelect.value = savedUnit.toString();
            updatePricingLabel(savedUnit);

            const savedProvider = result[PROVIDER_KEY] || DEFAULT_PROVIDER;
            dataProviderSelect.value = savedProvider;
            updateAttribution(savedProvider);

            // Column visibility
            const savedVisibility = result[COLUMN_VISIBILITY_KEY] || DEFAULT_COLUMN_VISIBILITY;
            columnItems.forEach(item => {
                const input = item.querySelector('input[type="checkbox"]');
                const cb = item.querySelector('.checkbox');
                if (!input || !cb) return;
                const columnId = input.getAttribute('data-column');
                if (columnId && savedVisibility.hasOwnProperty(columnId)) {
                    input.checked = savedVisibility[columnId];
                    cb.classList.toggle('checked', input.checked);
                }
            });

            // Notification
            const notificationEnabled = result[BATTLE_NOTIFICATION_KEY] ?? true;
            battleNotificationInput.checked = notificationEnabled;
            notificationToggle.classList.toggle('on', notificationEnabled);
            updateNotificationHint();
        } catch (error) {
            console.warn('Failed to load preferences:', error);
            tokenUnitSelect.value = DEFAULT_TOKEN_UNIT.toString();
            dataProviderSelect.value = DEFAULT_PROVIDER;
        }
    }

    // ---- Notification hint ----
    function updateNotificationHint() {
        if (!('Notification' in window)) {
            notificationHint.textContent = 'Notifications not supported in this browser';
            notificationHint.className = 'notification-hint notification-hint--error';
            notificationToggle.style.pointerEvents = 'none';
            notificationToggle.style.opacity = '0.5';
        } else if (Notification.permission === 'denied') {
            notificationHint.textContent = 'Notifications blocked. Enable in browser settings.';
            notificationHint.className = 'notification-hint notification-hint--error';
        } else {
            notificationHint.textContent = '';
            notificationHint.className = 'notification-hint';
        }
    }

    // ---- Attribution ----
    function updateAttribution(provider) {
        attributionDiv.textContent = 'All data is provided by ';

        const openRouterLink = document.createElement('a');
        openRouterLink.href = PROVIDER_URLS.openrouter;
        openRouterLink.target = '_blank';
        openRouterLink.textContent = 'OpenRouter';
        attributionDiv.appendChild(openRouterLink);

        if (provider !== 'openrouter') {
            attributionDiv.appendChild(document.createTextNode(', '));
            const secondaryLink = document.createElement('a');
            secondaryLink.href = PROVIDER_URLS[provider];
            secondaryLink.target = '_blank';
            secondaryLink.textContent = provider === 'litellm' ? 'LiteLLM' : 'Helicone';
            attributionDiv.appendChild(secondaryLink);
        }
    }

    // ---- Column visibility state ----
    function getColumnVisibility() {
        const visibility = {};
        columnItems.forEach(item => {
            const input = item.querySelector('input[type="checkbox"]');
            if (input) {
                const columnId = input.getAttribute('data-column');
                if (columnId) visibility[columnId] = input.checked;
            }
        });
        return visibility;
    }

    // ---- Save & notify content scripts ----
    async function savePreference(key, value, messageType) {
        try {
            await chrome.storage.sync.set({ [key]: value });
            const tabs = await chrome.tabs.query({ url: 'https://arena.ai/*' });
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, { type: messageType, value }).catch(() => { });
            }
        } catch (error) {
            console.warn('Failed to save preference:', error);
        }
    }

    // ---- Select event listeners ----
    tokenUnitSelect.addEventListener('change', (e) => {
        const unit = parseInt(e.target.value, 10);
        updatePricingLabel(unit);
        savePreference(TOKEN_UNIT_KEY, unit, 'TOKEN_UNIT_CHANGED');
    });

    dataProviderSelect.addEventListener('change', async (e) => {
        const provider = e.target.value;
        updateAttribution(provider);
        await chrome.storage.sync.set({ [PROVIDER_KEY]: provider });
        const tabs = await chrome.tabs.query({ url: 'https://arena.ai/*' });
        for (const tab of tabs) {
            chrome.tabs.reload(tab.id, { bypassCache: true });
        }
    });

    // ---- Version display ----
    function displayVersion() {
        const versionSpan = document.getElementById('popup-version');
        if (versionSpan && chrome.runtime.getManifest) {
            versionSpan.textContent = `v${chrome.runtime.getManifest().version}`;
        }
    }

    // ---- Tooltip handler ----
    const tooltip = document.getElementById('popup-tooltip');
    let hideTimeout;

    document.querySelectorAll('[data-tooltip]').forEach(el => {
        el.addEventListener('mouseenter', () => {
            clearTimeout(hideTimeout);
            const info = COLUMN_TOOLTIPS[el.dataset.tooltip];
            if (!info) return;

            tooltip.innerHTML = `
                <div class="lmarena-price-tooltip__header">
                    <span class="lmarena-price-tooltip__header-title">${info.title}</span>
                    <span class="lmarena-price-tooltip__header-brand">
                        <span class="lmarena-price-tooltip__header-brand-text"><em>Arena</em>.ai Plus</span>
                        <img src="icons/arenaaiplus-icon.svg" class="lmarena-price-tooltip__header-icon" alt="">
                    </span>
                </div>
                <div class="lmarena-price-tooltip__explanation">${info.description}</div>
            `;
            tooltip.classList.add('lmarena-price-tooltip--visible');

            const rect = el.getBoundingClientRect();
            tooltip.style.left = `${rect.left}px`;
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

    // ---- Initialize ----
    loadPreferences();
    displayVersion();
})();
