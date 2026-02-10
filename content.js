/*
 * Arena.ai Plus - Adds pricing and other useful data to Arena.ai's leaderboard tables.
 * Copyright (C) 2025 Arena.ai Plus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

(function () {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const CONFIG = {
    PROVIDERS: {
      helicone: {
        url: 'https://www.helicone.ai/api/llm-costs',
        name: 'Helicone'
      },
      litellm: {
        url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
        name: 'LiteLLM'
      },
      openrouter: {
        url: 'https://openrouter.ai/api/v1/models',
        name: 'OpenRouter'
      }
    },
    COLUMN_MARKER: 'data-lmarena-price-injected',
    ROW_MARKER: 'data-lmarena-row-processed',
    TOOLTIP_SHOW_DELAY: 50,
    TOOLTIP_HIDE_DELAY: 100,
    TOKEN_UNIT_KEY: 'lmarena-token-unit',
    PROVIDER_KEY: 'lmarena-data-provider',
    COLUMN_VISIBILITY_KEY: 'lmarena-column-visibility',
    BATTLE_NOTIFICATION_KEY: 'lmarena-battle-notification',
    DEFAULT_TOKEN_UNIT: 1000000,
    DEFAULT_PROVIDER: 'openrouter',
    DEFAULT_COLUMN_VISIBILITY: {
      'rank': true,
      'arena-score': true,
      'votes': true,
      'pricing': true,
      'bang-for-buck': true,
      'context-window': true,
      'modalities': true
    }
  };

  // Global settings
  let currentTokenUnit = CONFIG.DEFAULT_TOKEN_UNIT;
  let currentProvider = CONFIG.DEFAULT_PROVIDER;
  let currentColumnVisibility = { ...CONFIG.DEFAULT_COLUMN_VISIBILITY };
  let battleNotificationEnabled = false;

  // ============================================
  // Token Unit Helpers
  // ============================================
  function getTokenUnitLabel(unit) {
    switch (unit) {
      case 1000000: return '1M';
      case 100000: return '100K';
      default: return '1M';
    }
  }

  function convertCostToUnit(costPer1M, targetUnit) {
    return costPer1M * (targetUnit / 1000000);
  }

  function formatCost(cost) {
    return cost.toFixed(2);
  }

  // ============================================
  // Elo per Dollar Helpers (Logarithmic Formula with Rank Penalty)
  // ============================================
  const ELO_BASELINE = 1000;

  // Rank decay base: Each rank gets this % of the previous rank's score
  // 1.0 = no penalty (all ranks equal)
  // 0.97 = gentle exponential decay (recommended)
  // 0.95 = moderate decay
  // 0.90 = aggressive decay
  const RANK_DECAY_BASE = 0.85;

  /**
   * Calculate Value Score using logarithmic price compression with exponential rank penalty
   * Formula: (Elo - baseline) / log(1 + Price) × RANK_DECAY_BASE^(rank - 1)
   * 
   * This formula compresses the "price penalty" - for a business, the difference
   * between $5 and $30 is not "6x the pain", it's just a higher tier of operating cost.
   * 
   * The exponential rank penalty ensures:
   * - Top ranks (1-10) are penalized gently
   * - Lower ranks (50+) are penalized more aggressively
   * 
   * @param {number} arenaScore - The model's Arena Score (Elo)
   * @param {number} inputCostPer1M - Input cost per 1M tokens
   * @param {number} outputCostPer1M - Output cost per 1M tokens
   * @param {number} rank - The model's rank (1 = best, higher = worse)
   * @returns {number|null} - Value score or null if not calculable
   */
  function calculateBangForBuck(arenaScore, inputCostPer1M, outputCostPer1M, rank = 1) {
    if (!arenaScore || arenaScore <= ELO_BASELINE) return null; // Need Elo > baseline for positive score
    const blendedPrice = (inputCostPer1M + outputCostPer1M) / 2;
    if (blendedPrice <= 0) return null; // Free models get N/A (can't calculate value ratio)
    // Base formula: (Elo - baseline) / log(1 + Price)
    const baseScore = (arenaScore - ELO_BASELINE) / Math.log(1 + blendedPrice);
    // Apply exponential rank penalty: multiply by RANK_DECAY_BASE^(rank-1)
    // Rank 1 gets full score (1.0), each subsequent rank loses a fixed %
    const safeRank = Math.max(rank, 1);
    const rankMultiplier = Math.pow(RANK_DECAY_BASE, safeRank - 1);
    return baseScore * rankMultiplier;
  }

  async function loadPreferences() {
    try {
      const result = await chrome.storage.sync.get([
        CONFIG.TOKEN_UNIT_KEY,
        CONFIG.PROVIDER_KEY,
        CONFIG.COLUMN_VISIBILITY_KEY,
        CONFIG.BATTLE_NOTIFICATION_KEY
      ]);
      currentTokenUnit = result[CONFIG.TOKEN_UNIT_KEY] || CONFIG.DEFAULT_TOKEN_UNIT;
      currentProvider = result[CONFIG.PROVIDER_KEY] || CONFIG.DEFAULT_PROVIDER;
      currentColumnVisibility = result[CONFIG.COLUMN_VISIBILITY_KEY] || { ...CONFIG.DEFAULT_COLUMN_VISIBILITY };
      battleNotificationEnabled = result[CONFIG.BATTLE_NOTIFICATION_KEY] ?? true;
    } catch (error) {
      console.warn('[LMArena Plus] Failed to load preferences:', error);
      currentTokenUnit = CONFIG.DEFAULT_TOKEN_UNIT;
      currentProvider = CONFIG.DEFAULT_PROVIDER;
      currentColumnVisibility = { ...CONFIG.DEFAULT_COLUMN_VISIBILITY };
      battleNotificationEnabled = false;
    }
  }

  // ============================================
  // Column Visibility Helpers
  // ============================================
  const COLUMN_NAME_TO_INDEX = {
    'rank': 0,
    'model': 1,
    'arena-score': 2,
    'votes': 3
  };

  function applyColumnVisibility() {
    // Apply visibility to regular table columns
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      // Get header cells to determine column indices
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (!headerRow) return;

      const headers = Array.from(headerRow.querySelectorAll('th, td'));

      // Build index map from actual column headers
      const indexMap = {};
      headers.forEach((header, idx) => {
        // Skip ALL LMArena Plus injected headers
        if (header.hasAttribute && header.hasAttribute(CONFIG.COLUMN_MARKER)) {
          return;
        }
        if (header.classList.contains('lmarena-price-header') ||
          header.classList.contains('lmarena-bfb-header') ||
          header.classList.contains('lmarena-ctx-header') ||
          header.classList.contains('lmarena-mod-header')) {
          return;
        }

        const text = header.textContent.toLowerCase().trim();

        // More specific matching to avoid false positives
        // Rank Spread column - ONLY match if it contains BOTH 'rank' AND 'spread'
        // Regular rank columns (just '#' or 'Rank') should NOT be affected
        if (text.includes('rank') && text.includes('spread')) {
          indexMap['rank'] = idx;
        }
        // Arena score - specifically "score" column, not just containing "score"
        else if (text === 'arena score' || text === 'score' || text.includes('arena score')) {
          indexMap['arena-score'] = idx;
        }
        // Votes
        else if (text.includes('vote')) {
          indexMap['votes'] = idx;
        }
        // NOTE: Model column is NOT mapped - it should NEVER be hidden
      });

      // Apply visibility to all rows
      const allRows = table.querySelectorAll('tr');
      allRows.forEach(row => {
        const cells = row.querySelectorAll('th, td');

        // Regular columns (excluding model which is always visible)
        for (const [columnId, colIdx] of Object.entries(indexMap)) {
          if (cells[colIdx]) {
            cells[colIdx].style.display = currentColumnVisibility[columnId] ? '' : 'none';
          }
        }
      });
    });

    // Apply visibility to LMArena Plus columns
    const pricingHeaders = document.querySelectorAll('.lmarena-price-header');
    const pricingCells = document.querySelectorAll('.lmarena-price-cell');
    const bfbHeaders = document.querySelectorAll('.lmarena-bfb-header');
    const bfbCells = document.querySelectorAll('.lmarena-bfb-cell');
    const ctxHeaders = document.querySelectorAll('.lmarena-ctx-header');
    const ctxCells = document.querySelectorAll('.lmarena-ctx-cell');
    const modHeaders = document.querySelectorAll('.lmarena-mod-header');
    const modCells = document.querySelectorAll('.lmarena-mod-cell');

    const pricingVisible = currentColumnVisibility['pricing'];
    const bfbVisible = currentColumnVisibility['bang-for-buck'];
    const ctxVisible = currentColumnVisibility['context-window'];
    const modVisible = currentColumnVisibility['modalities'];

    pricingHeaders.forEach(el => el.style.display = pricingVisible ? '' : 'none');
    pricingCells.forEach(el => el.style.display = pricingVisible ? '' : 'none');
    bfbHeaders.forEach(el => el.style.display = bfbVisible ? '' : 'none');
    bfbCells.forEach(el => el.style.display = bfbVisible ? '' : 'none');
    ctxHeaders.forEach(el => el.style.display = ctxVisible ? '' : 'none');
    ctxCells.forEach(el => el.style.display = ctxVisible ? '' : 'none');
    modHeaders.forEach(el => el.style.display = modVisible ? '' : 'none');
    modCells.forEach(el => el.style.display = modVisible ? '' : 'none');


  }

  // ============================================
  // Loading State Manager
  // ============================================
  class LoadingManager {
    setLoading(cells, loading, cellType = 'price') {
      const classMap = {
        'price': 'lmarena-price-cell--loading',
        'bfb': 'lmarena-bfb-cell--loading',
        'ctx': 'lmarena-ctx-cell--loading',
        'mod': 'lmarena-mod-cell--loading'
      };
      const loadingClass = classMap[cellType] || classMap['price'];

      cells.forEach(cell => {
        if (loading) {
          cell.textContent = 'Loading';
          cell.classList.add(loadingClass);
          cell.classList.remove('lmarena-price-cell--na', 'lmarena-bfb-cell--na', 'lmarena-ctx-cell--na', 'lmarena-mod-cell--na');
        } else {
          cell.classList.remove(loadingClass);
        }
      });
    }
  }

  // ============================================
  // Notification Manager (Simplified)
  // ============================================
  class NotificationManager {
    constructor() {
      this.observer = null;
      this.lastButtonState = false; // Track if buttons were visible last check
    }

    start() {
      console.log('[LMArena Plus] NotificationManager.start() called');
      if (this.observer) {
        console.log('[LMArena Plus] Observer already exists, returning');
        return;
      }

      console.log('[LMArena Plus] Starting observation');
      this._startObserving();
    }

    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }

    setEnabled(enabled) {
      if (enabled) {
        this.start();
      } else {
        this.stop();
      }
    }

    _startObserving() {
      this.observer = new MutationObserver(() => {
        this._checkForCompletion();
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      this._checkForCompletion();
    }

    _checkForCompletion() {
      if (!battleNotificationEnabled) return;

      // Simple check: look for any voting/rating buttons
      const buttons = document.querySelectorAll('button');
      let votingButtonsVisible = false;

      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

        // Any of these indicate generation is complete
        if (text.includes('is better') ||
          text.includes('both are good') ||
          text.includes('both are bad') ||
          ariaLabel.includes('like this response') ||
          ariaLabel.includes('dislike this response')) {
          votingButtonsVisible = true;
          break;
        }
      }

      // Only notify when buttons first appear (transition from false to true)
      if (votingButtonsVisible && !this.lastButtonState) {
        console.log('[LMArena Plus] Generation complete, sending notification');
        this._sendNotification();
      }

      this.lastButtonState = votingButtonsVisible;
    }

    async _sendNotification() {
      console.log('[LMArena Plus] _sendNotification called');

      if (!('Notification' in window)) {
        console.log('[LMArena Plus] Notification API not available');
        return;
      }

      console.log('[LMArena Plus] Notification.permission =', Notification.permission);

      if (Notification.permission === 'default') {
        console.log('[LMArena Plus] Requesting permission...');
        const permission = await Notification.requestPermission();
        console.log('[LMArena Plus] Permission result:', permission);
        if (permission !== 'granted') return;
      }

      if (Notification.permission !== 'granted') {
        console.log('[LMArena Plus] Permission not granted, exiting');
        return;
      }

      console.log('[LMArena Plus] document.visibilityState =', document.visibilityState);

      // Don't notify if tab is visible, just flash title
      if (document.visibilityState === 'visible') {
        console.log('[LMArena Plus] Tab visible, flashing title only');
        this._flashTitle();
        return;
      }

      console.log('[LMArena Plus] Creating notification...');
      const notification = new Notification('Arena.ai Ready! 🏆', {
        body: 'Generation complete - ready to vote!',
        icon: chrome.runtime.getURL('icons/icon128.png'),
        tag: 'lmarena-ready',
        renotify: true,
        requireInteraction: false
      });
      console.log('[LMArena Plus] Notification created:', notification);

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      this._flashTitle();
    }

    _flashTitle() {
      const originalTitle = document.title;
      let isFlashing = true;
      let flashCount = 0;

      const flashInterval = setInterval(() => {
        if (flashCount >= 6 || document.visibilityState === 'visible') {
          document.title = originalTitle;
          clearInterval(flashInterval);
          return;
        }

        document.title = isFlashing ? '🏆 Ready to Vote!' : originalTitle;
        isFlashing = !isFlashing;
        flashCount++;
      }, 1000);
    }
  }

  // ============================================
  // Model Matcher Utility (Shared by all services)
  // ============================================
  const ModelMatcher = {
    /**
     * Normalize a model name for matching.
     * Handles URL encoding, version separators, and whitespace.
     */
    normalizeModelName(name) {
      if (!name) return '';
      return name
        .toLowerCase()
        .replace(/%3a/gi, ':')
        // Normalize versions: 4-5 -> 4.5, 3_5 -> 3.5 (only between single digits)
        .replace(/(^|[^0-9])(\d)[-_](\d)(?![0-9])/g, '$1$2.$3')
        .replace(/\s+/g, '-')
        .trim();
    },

    /**
     * Check if a character position represents a version number continuation.
     * This prevents gpt-4 from matching gpt-4.5
     */
    _isVersionContinuation(str, pos, key) {
      const charAfter = str[pos];
      const charAfterPlus1 = str[pos + 1];
      return (charAfter === '.' || charAfter === '-') &&
        charAfterPlus1 >= '0' && charAfterPlus1 <= '9' &&
        key[key.length - 1] >= '0' && key[key.length - 1] <= '9';
    },

    /**
     * Strip common suffixes like -preview, -beta, -latest
     */
    _stripSuffixes(normalized) {
      return normalized
        .replace(/[.-](preview|beta|latest|v\d+)(\b|$)/gi, '')
        .replace(/[.-]\d{8}(\b|$)/g, '');
    },

    /**
     * Strip date patterns like -20250929
     */
    _stripDates(normalized) {
      return normalized
        .replace(/[.-]20\d{6}(?=[.-]|$)/g, '')
        .replace(/--+/g, '-')
        .replace(/[.-]$/, '')
        .trim();
    },

    /**
     * Strip thinking variants like (thinking-minimal), -thinking-32k
     */
    _stripThinking(normalized) {
      return normalized
        .replace(/\(thinking[^)]*\)/g, '')
        .replace(/[.-]thinking(-[a-z0-9]+)*$/i, '')
        .replace(/[.-]thinking$/i, '')
        .replace(/--+/g, '-')
        .replace(/[.-]$/, '')
        .trim();
    },

    /**
     * Core matching logic: find best match in a map using prefix/suffix matching.
     * @param {Map} map - The map to search in
     * @param {string} searchTerm - The normalized search term
     * @param {boolean} checkOperators - Whether to check operator-based matching (for Helicone)
     * @returns {any} The matched entry or null
     */
    _findMatchInMap(map, searchTerm, checkOperators = false) {
      // 1. Exact match
      if (map.has(searchTerm)) {
        return map.get(searchTerm);
      }

      // 2. Operator-based matching (Helicone data only)
      if (checkOperators) {
        let operatorMatch = null;
        let operatorMatchLength = 0;
        for (const [key, entry] of map) {
          if (entry.operator === 'includes' && searchTerm.includes(key)) {
            if (key.length > operatorMatchLength) {
              operatorMatch = entry;
              operatorMatchLength = key.length;
            }
          }
          if (entry.operator === 'startsWith' && searchTerm.startsWith(key)) {
            if (key.length > operatorMatchLength) {
              operatorMatch = entry;
              operatorMatchLength = key.length;
            }
          }
        }
        if (operatorMatch) return operatorMatch;
      }

      // 3. Prefix matching - search term starts with key
      let bestMatch = null;
      let bestMatchLength = 0;

      for (const [key, entry] of map) {
        if (searchTerm.startsWith(key)) {
          const charAfterKey = searchTerm[key.length];
          if (charAfterKey === undefined ||
            ((charAfterKey === '-' || charAfterKey === '.' || charAfterKey === '/' || charAfterKey === ':') &&
              !this._isVersionContinuation(searchTerm, key.length, key))) {
            if (key.length > bestMatchLength) {
              bestMatch = entry;
              bestMatchLength = key.length;
            }
          }
        }
      }

      if (bestMatch) return bestMatch;

      // 4. Suffix matching - key starts with search term
      let shortestMatch = null;
      let shortestMatchLength = Infinity;

      for (const [key, entry] of map) {
        if (key.startsWith(searchTerm)) {
          const charAfterNormalized = key[searchTerm.length];
          if (charAfterNormalized === '-' || charAfterNormalized === '.' || charAfterNormalized === '/' || charAfterNormalized === ':') {
            if (key.length < shortestMatchLength) {
              shortestMatch = entry;
              shortestMatchLength = key.length;
            }
          }
        }
      }

      return shortestMatch;
    },

    /**
     * Find the best match for a model name in a map.
     * Tries multiple normalization strategies in order.
     * @param {Map} map - The map to search in
     * @param {string} modelName - The original model name
     * @param {Object} options - Options: { checkOperators: boolean }
     * @returns {any} The matched entry or null
     */
    findMatch(map, modelName, options = {}) {
      const checkOperators = options.checkOperators || false;
      const normalized = this.normalizeModelName(modelName);

      // 1. Direct match with normalized name
      let result = this._findMatchInMap(map, normalized, checkOperators);
      if (result) return result;

      // 2. Try without common suffixes
      const withoutSuffix = this._stripSuffixes(normalized);
      if (withoutSuffix !== normalized) {
        result = this._findMatchInMap(map, withoutSuffix, checkOperators);
        if (result) return result;
      }

      // 3. Try without date patterns
      const withoutDates = this._stripDates(normalized);
      if (withoutDates !== normalized && withoutDates.length > 0) {
        result = this._findMatchInMap(map, withoutDates, checkOperators);
        if (result) return result;
      }

      // 4. Try without thinking variants
      const withoutThinking = this._stripThinking(normalized);
      if (withoutThinking !== normalized && withoutThinking.length > 0) {
        result = this._findMatchInMap(map, withoutThinking, checkOperators);
        if (result) return result;
      }

      // 5. Try stripping BOTH dates AND thinking
      const withoutDatesAndThinking = this._stripThinking(withoutDates);
      if (withoutDatesAndThinking !== normalized &&
        withoutDatesAndThinking !== withoutDates &&
        withoutDatesAndThinking !== withoutThinking &&
        withoutDatesAndThinking.length > 0) {
        result = this._findMatchInMap(map, withoutDatesAndThinking, checkOperators);
        if (result) return result;
      }

      return null;
    }
  };

  // ============================================
  // Context Service (Always from OpenRouter)
  // ============================================
  class ContextService {
    constructor() {
      this.contextMap = new Map();
      this.isLoading = false;
    }

    async initialize() {
      this.isLoading = true;

      await this._fetchContextData();
      this.isLoading = false;
    }

    async _fetchContextData() {
      try {
        const response = await fetch(CONFIG.PROVIDERS.openrouter.url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        this._buildContextMap(data);

      } catch (error) {
        console.error('[LMArena Plus] Failed to fetch context data from OpenRouter:', error);
      }
    }

    _buildContextMap(data) {
      const models = data.data || [];

      for (const model of models) {
        if (!model.id) continue;

        const key = ModelMatcher.normalizeModelName(model.id);
        const hasExplicitModalities = !!(model.architecture?.input_modalities || model.architecture?.output_modalities);
        const contextData = {
          context_length: model.context_length || null,
          input_modalities: model.architecture?.input_modalities || ['text'],
          output_modalities: model.architecture?.output_modalities || ['text'],
          hasExplicitModalities: hasExplicitModalities,
          sourceModelName: model.id
        };

        if (!this.contextMap.has(key)) {
          this.contextMap.set(key, contextData);
        }

        const shortKey = key.split('/').pop();
        if (shortKey && shortKey !== key && !this.contextMap.has(shortKey)) {
          this.contextMap.set(shortKey, contextData);
        }
      }
    }

    getContext(modelName) {
      return ModelMatcher.findMatch(this.contextMap, modelName);
    }
  }

  // ============================================
  // Pricing Service (No Caching - Always Fresh)
  // ============================================
  class PricingService {
    constructor() {
      this.pricingMap = new Map();
      this.currentProvider = null;
      this.isLoading = false;
    }

    async initialize(provider) {
      this.currentProvider = provider;
      this.isLoading = true;


      await this._fetchPricing(provider);
      this.isLoading = false;
    }

    async switchProvider(provider) {

      this.pricingMap.clear();
      this.currentProvider = provider;
      await this.initialize(provider);
    }

    async _fetchPricing(provider) {
      const config = CONFIG.PROVIDERS[provider];
      if (!config) return;

      try {
        const response = await fetch(config.url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        this._buildPricingMap(data, provider);

      } catch (error) {
        console.error(`[LMArena Plus] Failed to fetch pricing from ${provider}:`, error);
      }
    }

    _buildPricingMap(data, provider) {
      this.pricingMap.clear();

      switch (provider) {
        case 'helicone':
          this._buildHeliconeMap(data);
          break;
        case 'litellm':
          this._buildLiteLLMMap(data);
          break;
        case 'openrouter':
          this._buildOpenRouterMap(data);
          break;
      }


    }

    _buildHeliconeMap(data) {
      const entries = data.data || data;
      if (!Array.isArray(entries)) return;

      for (const entry of entries) {
        const key = ModelMatcher.normalizeModelName(entry.model);
        const pricing = {
          input_cost_per_1m: entry.input_cost_per_1m || 0,
          output_cost_per_1m: entry.output_cost_per_1m || 0,
          operator: entry.operator || 'equals',
          sourceModelName: entry.model
        };

        if (!this.pricingMap.has(key)) {
          this.pricingMap.set(key, pricing);
        }

        const shortKey = key.split('/').pop();
        if (shortKey && shortKey !== key && !this.pricingMap.has(shortKey)) {
          this.pricingMap.set(shortKey, pricing);
        }
      }
    }

    _buildLiteLLMMap(data) {
      for (const [modelName, modelData] of Object.entries(data)) {
        if (modelName === 'sample_spec') continue;
        if (!modelData.input_cost_per_token && !modelData.output_cost_per_token) continue;

        const key = ModelMatcher.normalizeModelName(modelName);
        const pricing = {
          input_cost_per_1m: (modelData.input_cost_per_token || 0) * 1000000,
          output_cost_per_1m: (modelData.output_cost_per_token || 0) * 1000000,
          operator: 'equals',
          sourceModelName: modelName,
          context_length: modelData.max_input_tokens || modelData.max_tokens || null
        };

        if (!this.pricingMap.has(key)) {
          this.pricingMap.set(key, pricing);
        }

        const shortKey = key.split('/').pop();
        if (shortKey && shortKey !== key && !this.pricingMap.has(shortKey)) {
          this.pricingMap.set(shortKey, pricing);
        }
      }
    }

    _buildOpenRouterMap(data) {
      const models = data.data || [];

      for (const model of models) {
        if (!model.id || !model.pricing) continue;

        const key = ModelMatcher.normalizeModelName(model.id);
        const promptPrice = parseFloat(model.pricing.prompt) || 0;
        const completionPrice = parseFloat(model.pricing.completion) || 0;

        const pricing = {
          input_cost_per_1m: promptPrice * 1000000,
          output_cost_per_1m: completionPrice * 1000000,
          operator: 'equals',
          sourceModelName: model.id,
          context_length: model.context_length || null
        };

        if (!this.pricingMap.has(key)) {
          this.pricingMap.set(key, pricing);
        }

        const shortKey = key.split('/').pop();
        if (shortKey && shortKey !== key && !this.pricingMap.has(shortKey)) {
          this.pricingMap.set(shortKey, pricing);
        }
      }
    }

    getPricing(modelName) {
      // Use checkOperators for Helicone's includes/startsWith matching
      return ModelMatcher.findMatch(this.pricingMap, modelName, { checkOperators: true });
    }
  }

  // ============================================
  // Tooltip Manager
  // ============================================
  class TooltipManager {
    constructor() {
      this.tooltip = null;
      this.showTimeout = null;
      this.hideTimeout = null;
      this.currentElement = null;
      this._createTooltip();
    }

    _createTooltip() {
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'lmarena-price-tooltip';
      document.body.appendChild(this.tooltip);
    }

    show(element, pricing) {
      // Cancel any pending hide
      clearTimeout(this.hideTimeout);

      // If showing for a different element, show immediately
      const isNewElement = this.currentElement !== element;
      if (isNewElement) {
        clearTimeout(this.showTimeout);
      }

      this.currentElement = element;

      const showDelay = isNewElement ? CONFIG.TOOLTIP_SHOW_DELAY : 0;

      this.showTimeout = setTimeout(() => {
        const inputCost = convertCostToUnit(pricing.input_cost_per_1m || 0, currentTokenUnit);
        const outputCost = convertCostToUnit(pricing.output_cost_per_1m || 0, currentTokenUnit);
        const unitLabel = getTokenUnitLabel(currentTokenUnit);
        const providerName = CONFIG.PROVIDERS[currentProvider]?.name || 'Unknown';

        const sourceModelName = pricing.sourceModelName || 'Unknown model';

        this.tooltip.innerHTML = `
          <div class="lmarena-price-tooltip__total">
            ${sourceModelName}
          </div>
          <div class="lmarena-price-tooltip__breakdown">
            <div class="lmarena-price-tooltip__row">
              <span class="lmarena-price-tooltip__label">Input tokens:</span>
              <span class="lmarena-price-tooltip__value">$${formatCost(inputCost)}</span>
            </div>
            <div class="lmarena-price-tooltip__row">
              <span class="lmarena-price-tooltip__label">Output tokens:</span>
              <span class="lmarena-price-tooltip__value">$${formatCost(outputCost)}</span>
            </div>
          </div>
          <div class="lmarena-price-tooltip__source">Source: ${providerName}</div>
        `;

        // Make visible first so we can measure properly
        this.tooltip.classList.add('lmarena-price-tooltip--visible');

        // Position after content is set and visible
        requestAnimationFrame(() => {
          this._positionTooltip(element);
        });
      }, showDelay);
    }

    hide() {
      clearTimeout(this.showTimeout);

      this.hideTimeout = setTimeout(() => {
        this.tooltip.classList.remove('lmarena-price-tooltip--visible');
        this.currentElement = null;
      }, CONFIG.TOOLTIP_HIDE_DELAY);
    }

    showModalities(element, modData) {
      // Cancel any pending hide
      clearTimeout(this.hideTimeout);

      // If showing for a different element, show immediately
      const isNewElement = this.currentElement !== element;
      if (isNewElement) {
        clearTimeout(this.showTimeout);
      }

      this.currentElement = element;

      const showDelay = isNewElement ? CONFIG.TOOLTIP_SHOW_DELAY : 0;

      this.showTimeout = setTimeout(() => {
        const inputMods = modData.input_modalities || ['text'];
        const outputMods = modData.output_modalities || ['text'];

        const formatModality = (key) => {
          const names = { text: 'Text', image: 'Image', audio: 'Audio', video: 'Video', file: 'File' };
          return names[key] || key;
        };

        const formatRow = (mods) => {
          const supported = mods.map(key => formatModality(key));
          return supported.length > 0 ? supported.join(', ') : 'None';
        };

        this.tooltip.innerHTML = `
          <div class="lmarena-price-tooltip__total">
            Modalities
          </div>
          <div class="lmarena-price-tooltip__explanation">
            Shows which data types this model can process and generate
          </div>
          <div class="lmarena-price-tooltip__breakdown">
            <div class="lmarena-price-tooltip__row">
              <span class="lmarena-price-tooltip__label">Input:</span>
              <span class="lmarena-price-tooltip__value">${formatRow(inputMods)}</span>
            </div>
            <div class="lmarena-price-tooltip__row">
              <span class="lmarena-price-tooltip__label">Output:</span>
              <span class="lmarena-price-tooltip__value">${formatRow(outputMods)}</span>
            </div>
          </div>
          <div class="lmarena-price-tooltip__source">Source: OpenRouter</div>
        `;

        // Make visible first so we can measure properly
        this.tooltip.classList.add('lmarena-price-tooltip--visible');

        // Position after content is set and visible
        requestAnimationFrame(() => {
          this._positionTooltip(element);
        });
      }, showDelay);
    }

    _positionTooltip(element) {
      if (!element || !element.isConnected) return;

      const rect = element.getBoundingClientRect();
      const tooltipRect = this.tooltip.getBoundingClientRect();

      let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      // Position above the element by default
      let top = rect.top - tooltipRect.height - 8;

      const padding = 10;
      if (left < padding) left = padding;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }

      // Fallback to below if not enough space above
      if (top < padding) {
        top = rect.bottom + 8;
      }

      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
    }

    showHeaderInfo(element, columnType) {
      // Cancel any pending hide
      clearTimeout(this.hideTimeout);

      const isNewElement = this.currentElement !== element;
      if (isNewElement) {
        clearTimeout(this.showTimeout);
      }

      this.currentElement = element;

      const showDelay = isNewElement ? CONFIG.TOOLTIP_SHOW_DELAY : 0;

      this.showTimeout = setTimeout(() => {
        const info = COLUMN_TOOLTIPS[columnType];
        if (!info) return;

        this.tooltip.innerHTML = `
          <div class="lmarena-price-tooltip__total">
            ${info.title}
          </div>
          <div class="lmarena-price-tooltip__explanation">
            ${info.description}
          </div>
          <div class="lmarena-price-tooltip__source">Click to sort (where available)</div>
        `;

        this.tooltip.classList.add('lmarena-price-tooltip--visible');

        requestAnimationFrame(() => {
          this._positionTooltip(element);
        });
      }, showDelay);
    }
  }

  // ============================================
  // Sort Manager
  // ============================================
  const SORT_ICONS = {
    default: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lmarena-sort-icon"><path d="m21 16-4 4-4-4"></path><path d="M17 20V4"></path><path d="m3 8 4-4 4 4"></path><path d="M7 4v16"></path></svg>`,
    asc: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lmarena-sort-icon lmarena-sort-icon--active"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>`,
    desc: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lmarena-sort-icon lmarena-sort-icon--active"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg>`
  };

  class SortManager {
    constructor() {
      this.currentColumn = null; // 'pricing', 'bfb', 'ctx', 'mod', or null
      this.currentDirection = null; // 'asc', 'desc', or null
      this.headerButtons = new Map(); // columnType -> button element
      this._setupNativeSortListener();
    }

    _setupNativeSortListener() {
      // Listen for clicks on native headers to clear our sort
      document.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const th = button.closest('th');
        if (!th) return;

        // Check if this is a native header (not our injected ones)
        if (th.classList.contains('lmarena-price-header') ||
          th.classList.contains('lmarena-bfb-header') ||
          th.classList.contains('lmarena-ctx-header') ||
          th.classList.contains('lmarena-mod-header')) {
          return;
        }

        // A native header was clicked, clear our sort state
        this.clearSort();
      }, true);
    }

    registerHeader(columnType, button) {
      const oldButton = this.headerButtons.get(columnType);

      // If new button is different from old, reset sort state for this column
      if (oldButton && oldButton !== button) {
        // Clear sort state when buttons change (table was replaced)
        if (this.currentColumn === columnType) {
          this.currentColumn = null;
          this.currentDirection = null;
        }
      }

      this.headerButtons.set(columnType, button);
      this._updateButtonIcon(button, 'default');
    }

    toggleSort(columnType) {
      let newDirection;

      if (this.currentColumn === columnType) {
        // Cycle: asc -> desc -> null
        if (this.currentDirection === 'asc') {
          newDirection = 'desc';
        } else if (this.currentDirection === 'desc') {
          newDirection = null;
        } else {
          newDirection = 'asc';
        }
      } else {
        // New column, start with ascending
        newDirection = 'asc';
      }

      // Reset all buttons to default
      for (const [type, btn] of this.headerButtons) {
        this._updateButtonIcon(btn, 'default');
      }

      if (newDirection) {
        this.currentColumn = columnType;
        this.currentDirection = newDirection;
        const button = this.headerButtons.get(columnType);
        if (button) {
          this._updateButtonIcon(button, newDirection);
        }
        this._sortTable(columnType, newDirection);
      } else {
        this.currentColumn = null;
        this.currentDirection = null;
        this._restoreOriginalOrder();
      }
    }

    clearSort() {
      if (this.currentColumn) {
        this.currentColumn = null;
        this.currentDirection = null;
        for (const [type, btn] of this.headerButtons) {
          // Only update buttons that are still connected to DOM
          if (btn && btn.isConnected) {
            this._updateButtonIcon(btn, 'default');
          }
        }
        // Don't restore order - native sort will handle it
      }
    }

    // Reset all state (call when table content is fully replaced)
    reset() {
      this.currentColumn = null;
      this.currentDirection = null;
      this.headerButtons.clear();
    }

    _updateButtonIcon(button, state) {
      // Check if button is still in DOM
      if (!button || !button.isConnected) return;

      const iconContainer = button.querySelector('.lmarena-sort-icon-container');
      if (iconContainer) {
        iconContainer.innerHTML = SORT_ICONS[state] || SORT_ICONS.default;
      }
    }

    _sortTable(columnType, direction) {
      const tables = document.querySelectorAll('table');


      tables.forEach((table, tableIdx) => {
        const tbody = table.querySelector('tbody');
        if (!tbody) {

          return;
        }

        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (rows.length === 0) {

          return;
        }

        // Store original order if not already stored
        rows.forEach((row, idx) => {
          if (row._lmarenaOriginalIndex === undefined) {
            row._lmarenaOriginalIndex = idx;
          }
        });

        // Get the sort value property name based on column type
        const valueKey = this._getValueKey(columnType);

        // Debug: check how many rows have values
        const rowsWithValues = rows.filter(r => r[valueKey] != null).length;


        // Debug: log first few row values
        rows.slice(0, 5).forEach((row, idx) => {

        });

        // Sort rows
        rows.sort((a, b) => {
          const aVal = a[valueKey];
          const bVal = b[valueKey];

          // Handle null/undefined - push to end
          if (aVal == null && bVal == null) return 0;
          if (aVal == null) return 1;
          if (bVal == null) return -1;

          const diff = aVal - bVal;
          return direction === 'asc' ? diff : -diff;
        });

        // Re-append rows in sorted order
        rows.forEach(row => tbody.appendChild(row));

      });
    }

    _restoreOriginalOrder() {
      const tables = document.querySelectorAll('table');

      tables.forEach(table => {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (rows.length === 0) return;

        // Sort by original index
        rows.sort((a, b) => {
          const aIdx = a._lmarenaOriginalIndex ?? 0;
          const bIdx = b._lmarenaOriginalIndex ?? 0;
          return aIdx - bIdx;
        });

        // Re-append rows in original order
        rows.forEach(row => tbody.appendChild(row));
      });
    }

    _getValueKey(columnType) {
      switch (columnType) {
        case 'pricing': return '_lmarenaPlusPricing';
        case 'bfb': return '_lmarenaPlusBfb';
        case 'ctx': return '_lmarenaPlusCtx';
        case 'mod': return '_lmarenaPlusMod';
        default: return '_lmarenaPlusPricing';
      }
    }
  }

  // ============================================
  // Column Injector
  // ============================================
  class ColumnInjector {
    constructor(pricingService, contextService, tooltipManager, loadingManager, sortManager) {
      this.pricingService = pricingService;
      this.contextService = contextService;
      this.tooltipManager = tooltipManager;
      this.loadingManager = loadingManager;
      this.sortManager = sortManager;
      this.processedTables = new WeakSet();
      this.injectedCells = [];
      this.injectedBfbCells = [];
      this.injectedContextWindowCells = [];
      this.injectedModalitiesCells = [];
    }

    injectIntoTable(table, showLoading = false) {
      const headerRow = this._findHeaderRow(table);
      if (!headerRow) return 0;

      const modelColumnIndex = this._findModelColumnIndex(headerRow);
      if (modelColumnIndex === -1) return 0;

      const arenaScoreColumnIndex = this._findArenaScoreColumnIndex(headerRow);

      // Check if our headers are actually present in the header row
      // LMArena may keep the table element but replace header content, so check DOM directly
      const hasOurHeaders = headerRow.querySelector('.lmarena-price-header');

      if (!hasOurHeaders) {
        // Mark table if not already marked
        if (!table.hasAttribute(CONFIG.COLUMN_MARKER)) {
          table.setAttribute(CONFIG.COLUMN_MARKER, 'true');
          this.processedTables.add(table);
        }
        // Always inject headers if they don't exist in DOM
        this._injectHeader(headerRow, showLoading);
        this._injectBfbHeader(headerRow, showLoading);
        this._injectContextWindowHeader(headerRow, showLoading);
        this._injectModalitiesHeader(headerRow, showLoading);

        // Copy sticky/background styles from native headers so ours scroll correctly
        this._matchNativeHeaderStyles(headerRow);
      }

      return this._processUnprocessedRows(table, modelColumnIndex, arenaScoreColumnIndex, showLoading);
    }

    // Copy computed position, z-index, and background from a native <th> to our injected headers
    _matchNativeHeaderStyles(headerRow) {
      const nativeTh = Array.from(headerRow.querySelectorAll('th')).find(
        th => !th.hasAttribute(CONFIG.COLUMN_MARKER) &&
          !th.classList.contains('lmarena-price-header') &&
          !th.classList.contains('lmarena-bfb-header') &&
          !th.classList.contains('lmarena-ctx-header') &&
          !th.classList.contains('lmarena-mod-header')
      );
      if (!nativeTh) return;

      const computed = window.getComputedStyle(nativeTh);
      const props = ['position', 'top', 'zIndex', 'backgroundColor', 'boxShadow'];

      const injectedHeaders = headerRow.querySelectorAll(
        '.lmarena-price-header, .lmarena-bfb-header, .lmarena-ctx-header, .lmarena-mod-header'
      );
      injectedHeaders.forEach(th => {
        for (const prop of props) {
          th.style[prop] = computed[prop];
        }
      });
    }


    _processUnprocessedRows(table, modelColumnIndex, arenaScoreColumnIndex, showLoading) {
      const rows = table.querySelectorAll('tbody tr, tr');
      let newRowCount = 0;

      rows.forEach(row => {
        if (row.querySelector('th')) return;
        if (row.hasAttribute(CONFIG.ROW_MARKER)) return;

        newRowCount++;
        row.setAttribute(CONFIG.ROW_MARKER, 'true');
        this._injectCell(row, modelColumnIndex, showLoading);
        this._injectBfbCell(row, modelColumnIndex, arenaScoreColumnIndex, showLoading);
        this._injectContextWindowCell(row, modelColumnIndex, showLoading);
        this._injectModalitiesCell(row, modelColumnIndex, showLoading);
      });

      return newRowCount;
    }

    updatePricingHeader() {
      if (this.pricingHeaderButton && this.pricingHeaderButton.isConnected) {
        const unitLabel = getTokenUnitLabel(currentTokenUnit);
        // Preserve the current sort icon state
        const iconContainer = this.pricingHeaderButton.querySelector('.lmarena-sort-icon-container');
        const currentIcon = iconContainer ? iconContainer.innerHTML : SORT_ICONS.default;
        this.pricingHeaderButton.innerHTML = `Pricing per ${unitLabel} <span class="lmarena-sort-icon-container">${currentIcon}</span>`;
      }
    }

    updateAllCells() {
      for (const cellData of this.injectedCells) {
        const { cell, modelName } = cellData;

        if (!cell.isConnected) continue;

        cell.classList.remove('lmarena-price-cell--loading');
        this._updateCellContent(cell, modelName);
      }

      // Update Elo per Dollar cells
      for (const cellData of this.injectedBfbCells) {
        const { cell, modelName, arenaScore, rank } = cellData;

        if (!cell.isConnected) continue;

        cell.classList.remove('lmarena-bfb-cell--loading');
        this._updateBfbCellContent(cell, modelName, arenaScore, rank);
      }

      // Add medal emojis to top 3 BfB cells per table
      this._addBfbMedals();

      // Update Context Window cells
      for (const cellData of this.injectedContextWindowCells) {
        const { cell, modelName } = cellData;

        if (!cell.isConnected) continue;

        cell.classList.remove('lmarena-ctx-cell--loading');
        this._updateContextWindowCellContent(cell, modelName);
      }

      // Update Modalities cells
      for (const cellData of this.injectedModalitiesCells) {
        const { cell, modelName } = cellData;

        if (!cell.isConnected) continue;

        cell.classList.remove('lmarena-mod-cell--loading');
        this._updateModalitiesCellContent(cell, modelName);
      }
    }

    _addBfbMedals() {
      const MEDALS = ['🥇', '🥈', '🥉'];
      const MEDAL_REGEX = /^[🥇🥈🥉]\s*/;

      // Group BfB cells by their parent table
      const tableGroups = new Map();

      for (const cellData of this.injectedBfbCells) {
        const { cell } = cellData;
        if (!cell.isConnected) continue;

        const table = cell.closest('table');
        if (!table) continue;

        const row = cell.closest('tr');
        const bfbValue = row?._lmarenaPlusBfb;

        // Strip any existing medal from this cell first
        const valueSpan = cell.querySelector('.lmarena-bfb-value');
        if (valueSpan) {
          valueSpan.innerHTML = valueSpan.innerHTML.replace(MEDAL_REGEX, '');
        }

        // Only consider cells with valid BfB values
        if (bfbValue !== null && bfbValue !== undefined && !isNaN(bfbValue)) {
          if (!tableGroups.has(table)) {
            tableGroups.set(table, []);
          }
          tableGroups.set(table, [...tableGroups.get(table), { cell, value: bfbValue }]);
        }
      }

      // For each table, find top 3 and add medals
      for (const [table, cells] of tableGroups) {
        // Sort by BfB value descending
        cells.sort((a, b) => b.value - a.value);

        // Add medals to top 3
        for (let i = 0; i < Math.min(3, cells.length); i++) {
          const { cell } = cells[i];
          const valueSpan = cell.querySelector('.lmarena-bfb-value');
          if (valueSpan) {
            // Prepend medal emoji
            valueSpan.innerHTML = `${MEDALS[i]} ${valueSpan.innerHTML}`;
          }
        }
      }
    }

    setAllCellsLoading() {
      const cells = this.injectedCells.filter(c => c.cell.isConnected).map(c => c.cell);
      const bfbCells = this.injectedBfbCells.filter(c => c.cell.isConnected).map(c => c.cell);
      const ctxCells = this.injectedContextWindowCells.filter(c => c.cell.isConnected).map(c => c.cell);
      const modCells = this.injectedModalitiesCells.filter(c => c.cell.isConnected).map(c => c.cell);
      this.loadingManager.setLoading(cells, true, 'price');
      this.loadingManager.setLoading(bfbCells, true, 'bfb');
      this.loadingManager.setLoading(ctxCells, true, 'ctx');
      this.loadingManager.setLoading(modCells, true, 'mod');
    }

    clearAllInjections() {
      document.querySelectorAll(`[${CONFIG.COLUMN_MARKER}]`).forEach(el => {
        el.removeAttribute(CONFIG.COLUMN_MARKER);
      });
      document.querySelectorAll(`[${CONFIG.ROW_MARKER}]`).forEach(el => {
        el.removeAttribute(CONFIG.ROW_MARKER);
      });
      document.querySelectorAll('.lmarena-price-header, .lmarena-price-cell, .lmarena-bfb-header, .lmarena-bfb-cell, .lmarena-ctx-header, .lmarena-ctx-cell, .lmarena-mod-header, .lmarena-mod-cell').forEach(el => {
        el.remove();
      });
      this.injectedCells = [];
      this.injectedBfbCells = [];
      this.injectedContextWindowCells = [];
      this.injectedModalitiesCells = [];
      this.processedTables = new WeakSet();
    }

    _findHeaderRow(table) {
      const thead = table.querySelector('thead tr');
      if (thead) return thead;

      const firstRow = table.querySelector('tr');
      if (firstRow && firstRow.querySelector('th')) return firstRow;

      return null;
    }

    _findModelColumnIndex(headerRow) {
      const cells = headerRow.querySelectorAll('th, td');

      for (let i = 0; i < cells.length; i++) {
        const text = cells[i].textContent.toLowerCase().trim();
        if (text === 'model' || text === 'model name' || text.includes('model')) {
          return i;
        }
      }

      return cells.length > 0 ? 0 : -1;
    }

    _findArenaScoreColumnIndex(headerRow) {
      const cells = headerRow.querySelectorAll('th, td');

      for (let i = 0; i < cells.length; i++) {
        const text = cells[i].textContent.toLowerCase().trim();
        // Look for Arena Score, Elo, or Score columns
        if (text === 'arena score' || text === 'elo' || text === 'score' ||
          text.includes('arena') || text.includes('elo')) {
          return i;
        }
      }

      return -1;
    }

    _injectHeader(headerRow, showLoading) {
      if (headerRow.querySelector('.lmarena-price-header')) return;

      const th = document.createElement('th');
      th.className = 'lmarena-price-header';

      // Create sortable button with dynamic label
      const button = document.createElement('button');
      button.className = 'lmarena-sort-button';
      const unitLabel = getTokenUnitLabel(currentTokenUnit);
      button.innerHTML = `Pricing per ${unitLabel} <span class="lmarena-sort-icon-container">${SORT_ICONS.default}</span>`;
      button.addEventListener('click', () => this.sortManager.toggleSort('pricing'));

      // Store reference to the button for dynamic updates
      this.pricingHeaderButton = button;

      // Add tooltip hover
      th.addEventListener('mouseenter', () => this.tooltipManager.showHeaderInfo(th, 'pricing'));
      th.addEventListener('mouseleave', () => this.tooltipManager.hide());

      th.appendChild(button);
      th.setAttribute(CONFIG.COLUMN_MARKER, 'true');
      headerRow.appendChild(th);

      // Register with sort manager
      this.sortManager.registerHeader('pricing', button);
    }

    _injectBfbHeader(headerRow, showLoading) {
      if (headerRow.querySelector('.lmarena-bfb-header')) return;

      const th = document.createElement('th');
      th.className = 'lmarena-bfb-header';

      // Create sortable button
      const button = document.createElement('button');
      button.className = 'lmarena-sort-button';
      button.innerHTML = `Bang for Buck <span class="lmarena-sort-icon-container">${SORT_ICONS.default}</span>`;
      button.addEventListener('click', () => this.sortManager.toggleSort('bfb'));

      // Add tooltip hover
      th.addEventListener('mouseenter', () => this.tooltipManager.showHeaderInfo(th, 'bfb'));
      th.addEventListener('mouseleave', () => this.tooltipManager.hide());

      th.appendChild(button);
      th.setAttribute(CONFIG.COLUMN_MARKER, 'true');
      headerRow.appendChild(th);

      // Register with sort manager
      this.sortManager.registerHeader('bfb', button);
    }

    _injectCell(row, modelColumnIndex, showLoading) {
      if (row.querySelector('.lmarena-price-cell')) return;

      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      const modelCell = cells[modelColumnIndex] || cells[0];
      const modelName = this._extractModelName(modelCell);

      const td = document.createElement('td');
      td.className = 'lmarena-price-cell';
      td.setAttribute(CONFIG.COLUMN_MARKER, 'true');

      this.injectedCells.push({ cell: td, modelName });

      // IMPORTANT: Append to row BEFORE updating content, so cell.closest('tr') works
      row.appendChild(td);

      if (showLoading) {
        td.textContent = 'Loading';
        td.classList.add('lmarena-price-cell--loading');
      } else {
        this._updateCellContent(td, modelName);
      }
    }

    _injectBfbCell(row, modelColumnIndex, arenaScoreColumnIndex, showLoading) {
      if (row.querySelector('.lmarena-bfb-cell')) return;

      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      const modelCell = cells[modelColumnIndex] || cells[0];
      const modelName = this._extractModelName(modelCell);

      // Extract Arena Score from the table
      let arenaScore = null;
      if (arenaScoreColumnIndex !== -1 && cells[arenaScoreColumnIndex]) {
        const scoreText = cells[arenaScoreColumnIndex].textContent.trim();
        // parseFloat naturally stops at the first non-numeric char,
        // so "1289 ±9" correctly parses as 1289
        arenaScore = parseFloat(scoreText);
      }

      // Extract rank from first column (usually index 0)
      let rank = 1;
      if (cells[0]) {
        const rankText = cells[0].textContent.trim();
        const parsedRank = parseInt(rankText.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsedRank) && parsedRank > 0) {
          rank = parsedRank;
        }
      }

      const td = document.createElement('td');
      td.className = 'lmarena-bfb-cell';
      td.setAttribute(CONFIG.COLUMN_MARKER, 'true');

      this.injectedBfbCells.push({ cell: td, modelName, arenaScore, rank });

      // IMPORTANT: Append to row BEFORE updating content, so cell.closest('tr') works
      row.appendChild(td);

      if (showLoading) {
        td.textContent = 'Loading';
        td.classList.add('lmarena-bfb-cell--loading');
      } else {
        this._updateBfbCellContent(td, modelName, arenaScore, rank);
      }
    }

    _injectContextWindowHeader(headerRow, showLoading) {
      if (headerRow.querySelector('.lmarena-ctx-header')) return;

      const th = document.createElement('th');
      th.className = 'lmarena-ctx-header';

      // Create sortable button
      const button = document.createElement('button');
      button.className = 'lmarena-sort-button';
      button.innerHTML = `Context Size <span class="lmarena-sort-icon-container">${SORT_ICONS.default}</span>`;
      button.addEventListener('click', () => this.sortManager.toggleSort('ctx'));

      // Add tooltip hover
      th.addEventListener('mouseenter', () => this.tooltipManager.showHeaderInfo(th, 'ctx'));
      th.addEventListener('mouseleave', () => this.tooltipManager.hide());

      th.appendChild(button);
      th.setAttribute(CONFIG.COLUMN_MARKER, 'true');
      headerRow.appendChild(th);

      // Register with sort manager
      this.sortManager.registerHeader('ctx', button);
    }

    _injectContextWindowCell(row, modelColumnIndex, showLoading) {
      if (row.querySelector('.lmarena-ctx-cell')) return;

      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      const modelCell = cells[modelColumnIndex] || cells[0];
      const modelName = this._extractModelName(modelCell);

      const td = document.createElement('td');
      td.className = 'lmarena-ctx-cell';
      td.setAttribute(CONFIG.COLUMN_MARKER, 'true');

      this.injectedContextWindowCells.push({ cell: td, modelName });

      // IMPORTANT: Append to row BEFORE updating content, so cell.closest('tr') works
      row.appendChild(td);

      if (showLoading) {
        td.textContent = 'Loading';
        td.classList.add('lmarena-ctx-cell--loading');
      } else {
        this._updateContextWindowCellContent(td, modelName);
      }
    }

    _updateContextWindowCellContent(cell, modelName) {
      // Context window always uses OpenRouter data via contextService
      const contextData = this.contextService.getContext(modelName);
      const row = cell.closest('tr');

      if (contextData && contextData.context_length) {
        const formatted = this._formatContextWindow(contextData.context_length);
        cell.innerHTML = `<span class="lmarena-ctx-value">${formatted}</span>`;
        cell.classList.remove('lmarena-ctx-cell--na');
        // Store sortable value on row
        if (row) row._lmarenaPlusCtx = contextData.context_length;
      } else {
        cell.textContent = 'N/A';
        cell.classList.add('lmarena-ctx-cell--na');
        if (row) row._lmarenaPlusCtx = null;
      }
    }

    _formatContextWindow(tokens) {
      if (!tokens || tokens <= 0) return 'N/A';
      if (tokens >= 1000000) {
        const value = parseFloat((tokens / 1000000).toFixed(1));
        return `${value}M`;
      } else if (tokens >= 1000) {
        const value = parseFloat((tokens / 1000).toFixed(1));
        return `${value}K`;
      }
      return tokens.toString();
    }

    _injectModalitiesHeader(headerRow, showLoading) {
      if (headerRow.querySelector('.lmarena-mod-header')) return;

      const th = document.createElement('th');
      th.className = 'lmarena-mod-header';

      // Modalities is not sortable (no numeric value), just show header text
      th.textContent = 'Modalities';

      // Add tooltip hover
      th.addEventListener('mouseenter', () => this.tooltipManager.showHeaderInfo(th, 'mod'));
      th.addEventListener('mouseleave', () => this.tooltipManager.hide());

      th.setAttribute(CONFIG.COLUMN_MARKER, 'true');
      headerRow.appendChild(th);
    }

    _injectModalitiesCell(row, modelColumnIndex, showLoading) {
      if (row.querySelector('.lmarena-mod-cell')) return;

      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      const modelCell = cells[modelColumnIndex] || cells[0];
      const modelName = this._extractModelName(modelCell);

      const td = document.createElement('td');
      td.className = 'lmarena-mod-cell';
      td.setAttribute(CONFIG.COLUMN_MARKER, 'true');

      this.injectedModalitiesCells.push({ cell: td, modelName });

      // IMPORTANT: Append to row BEFORE updating content, so cell.closest('tr') works
      row.appendChild(td);

      if (showLoading) {
        td.textContent = 'Loading';
        td.classList.add('lmarena-mod-cell--loading');
      } else {
        this._updateModalitiesCellContent(td, modelName);
      }
    }


    _updateModalitiesCellContent(cell, modelName) {
      // Modalities always uses OpenRouter data via contextService
      const contextData = this.contextService.getContext(modelName);

      // Clear any existing event listeners
      cell.onmouseenter = null;
      cell.onmouseleave = null;

      if (contextData && contextData.hasExplicitModalities) {
        const inputMods = contextData.input_modalities || ['text'];
        const outputMods = contextData.output_modalities || ['text'];
        cell.innerHTML = this._renderModalitiesIcons(inputMods, outputMods);
        cell.classList.remove('lmarena-mod-cell--na');

        // Store modality data for tooltip
        cell._modalityData = {
          input_modalities: inputMods,
          output_modalities: outputMods,
          sourceModelName: contextData.sourceModelName
        };

        cell.onmouseenter = (e) => {
          const modData = e.currentTarget._modalityData;
          if (modData) {
            this.tooltipManager.showModalities(e.currentTarget, modData);
          }
        };
        cell.onmouseleave = () => {
          this.tooltipManager.hide();
        };
      } else {
        cell.textContent = 'N/A';
        cell.classList.add('lmarena-mod-cell--na');
        cell._modalityData = null;
      }
    }

    _renderModalitiesIcons(inputMods, outputMods) {
      const modalities = [
        { key: 'text', svg: 'text.svg', label: 'Text' },
        { key: 'image', svg: 'image.svg', label: 'Image' },
        { key: 'audio', svg: 'audio.svg', label: 'Audio' },
        { key: 'video', svg: 'video.svg', label: 'Video' }
      ];

      let html = '<div class="lmarena-mod-container">';

      // Input row
      html += '<div class="lmarena-mod-row" title="Input modalities">';
      for (const mod of modalities) {
        const hasInput = inputMods.includes(mod.key);
        const iconUrl = chrome.runtime.getURL(`icons/${mod.svg}`);
        html += `<img src="${iconUrl}" class="lmarena-mod-icon ${hasInput ? 'lmarena-mod-enabled' : 'lmarena-mod-disabled'}" alt="${mod.label} input" title="${mod.label} input: ${hasInput ? 'Yes' : 'No'}">`;
      }
      html += '</div>';

      // Output row
      html += '<div class="lmarena-mod-row" title="Output modalities">';
      for (const mod of modalities) {
        const hasOutput = outputMods.includes(mod.key);
        const iconUrl = chrome.runtime.getURL(`icons/${mod.svg}`);
        html += `<img src="${iconUrl}" class="lmarena-mod-icon ${hasOutput ? 'lmarena-mod-enabled' : 'lmarena-mod-disabled'}" alt="${mod.label} output" title="${mod.label} output: ${hasOutput ? 'Yes' : 'No'}">`;
      }
      html += '</div>';

      html += '</div>';
      return html;
    }

    _updateCellContent(cell, modelName) {
      const pricing = this.pricingService.getPricing(modelName);
      const unitLabel = getTokenUnitLabel(currentTokenUnit);
      const row = cell.closest('tr');

      // Clear any existing event listeners by cloning (cleanest way)
      cell.onmouseenter = null;
      cell.onmouseleave = null;

      if (pricing) {
        const inputCost = convertCostToUnit(pricing.input_cost_per_1m || 0, currentTokenUnit);
        const outputCost = convertCostToUnit(pricing.output_cost_per_1m || 0, currentTokenUnit);
        const totalCost = inputCost + outputCost;

        // Store sortable value on row (use raw per-1M cost for consistent sorting)
        const rawTotal = (pricing.input_cost_per_1m || 0) + (pricing.output_cost_per_1m || 0);
        if (row) row._lmarenaPlusPricing = rawTotal;

        cell.innerHTML = `
          <div class="lmarena-price-total">$${formatCost(totalCost)}</div>
          <div class="lmarena-price-breakdown">$${formatCost(inputCost)} / $${formatCost(outputCost)}</div>
        `;
        cell.classList.remove('lmarena-price-cell--na');

        // Store pricing reference on the element for reliable access
        cell._pricingData = pricing;

        cell.onmouseenter = (e) => {
          const pricingData = e.currentTarget._pricingData;
          if (pricingData) {
            this.tooltipManager.show(e.currentTarget, pricingData);
          }
        };
        cell.onmouseleave = () => {
          this.tooltipManager.hide();
        };
      } else {
        cell.textContent = 'N/A';
        cell.classList.add('lmarena-price-cell--na');
        cell._pricingData = null;
        if (row) row._lmarenaPlusPricing = null;
      }
    }

    _updateBfbCellContent(cell, modelName, arenaScore, rank = 1) {
      const pricing = this.pricingService.getPricing(modelName);
      const row = cell.closest('tr');

      if (pricing && arenaScore && arenaScore > 1000) {
        const inputCost = pricing.input_cost_per_1m || 0;
        const outputCost = pricing.output_cost_per_1m || 0;
        const valueScore = calculateBangForBuck(arenaScore, inputCost, outputCost, rank);

        if (valueScore !== null) {
          // Format: show score as integer for cleaner display
          const formattedValue = Math.round(valueScore);
          cell.innerHTML = `<span class="lmarena-bfb-value">${formattedValue}</span>`;
          cell.classList.remove('lmarena-bfb-cell--na');
          // Store sortable value on row
          if (row) row._lmarenaPlusBfb = valueScore;
        } else {
          cell.textContent = 'N/A';
          cell.classList.add('lmarena-bfb-cell--na');
          if (row) row._lmarenaPlusBfb = null;
        }

        // Store data for tooltip
        cell._bfbData = { arenaScore, pricing, valueScore, rank };
      } else if (!arenaScore || arenaScore <= 1000) {
        cell.textContent = '—';
        cell.classList.add('lmarena-bfb-cell--na');
        cell._bfbData = null;
        if (row) row._lmarenaPlusBfb = null;
      } else {
        cell.textContent = 'N/A';
        cell.classList.add('lmarena-bfb-cell--na');
        cell._bfbData = null;
        if (row) row._lmarenaPlusBfb = null;
      }
    }

    _extractModelName(cell) {
      const link = cell.querySelector('a');
      if (link) return link.textContent.trim();

      const span = cell.querySelector('span');
      if (span) return span.textContent.trim();

      return cell.textContent.trim();
    }
  }

  // ============================================
  // Table Observer
  // ============================================
  class TableObserver {
    constructor(columnInjector) {
      this.columnInjector = columnInjector;
      this.observer = null;
      this._debounceTimer = null;
    }

    start() {
      this._processAllTables();

      this.observer = new MutationObserver((mutations) => {
        let shouldProcess = false;

        for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'TR' || node.tagName === 'TABLE' ||
                  node.tagName === 'TBODY' || node.querySelector?.('tr')) {
                  shouldProcess = true;
                  break;
                }
              }
            }
          }

          if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (target.tagName === 'TR' || target.tagName === 'TABLE' ||
              target.tagName === 'TBODY') {
              shouldProcess = true;
            }
          }

          if (shouldProcess) break;
        }

        if (shouldProcess) {
          clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => {
            this._processAllTables();
          }, 50);
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
    }

    _processAllTables(showLoading = false) {
      const tables = document.querySelectorAll('table');
      let totalNewRows = 0;

      tables.forEach(table => {
        if (this._isLeaderboardTable(table)) {
          totalNewRows += this.columnInjector.injectIntoTable(table, showLoading);
        }
      });

      // Apply column visibility to new rows
      // Only add medals if new rows were actually processed (not just sorting)
      if (!showLoading) {
        applyColumnVisibility();
        if (totalNewRows > 0) {
          this.columnInjector._addBfbMedals();
        }
      }
    }

    reprocessAll(showLoading = false) {
      this._processAllTables(showLoading);
    }

    _isLeaderboardTable(table) {
      const headers = table.querySelectorAll('th');
      for (const header of headers) {
        const text = header.textContent.toLowerCase();
        if (text.includes('model') || text.includes('rank') || text.includes('elo') || text.includes('score')) {
          return true;
        }
      }

      const rows = table.querySelectorAll('tbody tr, tr');
      return rows.length >= 3;
    }
  }

  // ============================================
  // Main Initialization
  // ============================================
  let pricingService, contextService, tooltipManager, loadingManager, sortManager, columnInjector, tableObserver, notificationManager;

  async function init() {


    await loadPreferences();

    pricingService = new PricingService();
    contextService = new ContextService();
    tooltipManager = new TooltipManager();
    loadingManager = new LoadingManager();
    sortManager = new SortManager();
    columnInjector = new ColumnInjector(pricingService, contextService, tooltipManager, loadingManager, sortManager);
    tableObserver = new TableObserver(columnInjector);

    // Show loading state immediately
    tableObserver.reprocessAll(true);

    // Fetch pricing and context data in parallel
    // Context always from OpenRouter, pricing from selected provider
    await Promise.all([
      pricingService.initialize(currentProvider),
      contextService.initialize()
    ]);


    // Update cells with actual data
    columnInjector.updateAllCells();

    // Apply column visibility preferences
    applyColumnVisibility();

    // Start observing for new tables and rows
    tableObserver.start();

    // Initialize notification manager
    notificationManager = new NotificationManager();
    console.log('[LMArena Plus] NotificationManager created, enabled:', battleNotificationEnabled);
    if (battleNotificationEnabled) {
      notificationManager.start();
      console.log('[LMArena Plus] NotificationManager started');
    }


    // Listen for preference changes from popup
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      if (message.type === 'TOKEN_UNIT_CHANGED') {
        currentTokenUnit = message.value;
        columnInjector.updatePricingHeader();
        columnInjector.updateAllCells();

      } else if (message.type === 'PROVIDER_CHANGED') {
        currentProvider = message.value;


        columnInjector.setAllCellsLoading();
        await pricingService.switchProvider(currentProvider);
        columnInjector.updateAllCells();
        applyColumnVisibility();


      } else if (message.type === 'COLUMN_VISIBILITY_CHANGED') {
        currentColumnVisibility = message.value;
        applyColumnVisibility();

      } else if (message.type === 'BATTLE_NOTIFICATION_CHANGED') {
        battleNotificationEnabled = message.value;
        if (notificationManager) {
          notificationManager.setEnabled(battleNotificationEnabled);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
