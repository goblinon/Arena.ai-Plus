/**
 * LMArena Plus - Popup Script
 * Handles user preferences for token unit display, data provider, and column visibility
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
        'model': true,
        'arena-score': true,
        '95-ci': true,
        'votes': true,
        'organization': true,
        'license': true,
        'pricing': true,
        'elo-per-dollar': true
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

    // Load saved preferences
    async function loadPreferences() {
        try {
            const result = await chrome.storage.sync.get([TOKEN_UNIT_KEY, PROVIDER_KEY, COLUMN_VISIBILITY_KEY]);

            const savedUnit = result[TOKEN_UNIT_KEY] || DEFAULT_TOKEN_UNIT;
            tokenUnitSelect.value = savedUnit.toString();

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
        } catch (error) {
            console.warn('Failed to load preferences:', error);
            tokenUnitSelect.value = DEFAULT_TOKEN_UNIT.toString();
            dataProviderSelect.value = DEFAULT_PROVIDER;
        }
    }

    // Update attribution based on selected provider
    function updateAttribution(provider) {
        const url = PROVIDER_URLS[provider];
        const name = provider.charAt(0).toUpperCase() + provider.slice(1);
        attributionDiv.innerHTML = `All data is provided by <a href="${url}" target="_blank">${name === 'Litellm' ? 'LiteLLM' : name}</a>`;
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
        savePreference(TOKEN_UNIT_KEY, parseInt(e.target.value, 10), 'TOKEN_UNIT_CHANGED');
    });

    dataProviderSelect.addEventListener('change', (e) => {
        const provider = e.target.value;
        updateAttribution(provider);
        savePreference(PROVIDER_KEY, provider, 'PROVIDER_CHANGED');
    });

    // Column visibility checkboxes
    columnCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const visibility = getColumnVisibility();
            savePreference(COLUMN_VISIBILITY_KEY, visibility, 'COLUMN_VISIBILITY_CHANGED');
        });
    });

    // Initialize
    loadPreferences();
})();
