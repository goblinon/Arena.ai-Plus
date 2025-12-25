/**
 * LMArena Plus - Content Script
 * Injects pricing information from multiple providers into LMArena leaderboard tables
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
    DEFAULT_TOKEN_UNIT: 1000000,
    DEFAULT_PROVIDER: 'openrouter',
    DEFAULT_COLUMN_VISIBILITY: {
      'rank': true,
      'model': true,
      'arena-score': true,
      '95-ci': true,
      'votes': true,
      'organization': true,
      'license': true,
      'pricing': true,
      'elo-per-dollar': true
    }
  };

  // Global settings
  let currentTokenUnit = CONFIG.DEFAULT_TOKEN_UNIT;
  let currentProvider = CONFIG.DEFAULT_PROVIDER;
  let currentColumnVisibility = { ...CONFIG.DEFAULT_COLUMN_VISIBILITY };

  // ============================================
  // Token Unit Helpers
  // ============================================
  function getTokenUnitLabel(unit) {
    switch (unit) {
      case 1000000: return '1M';
      case 100000: return '100K';
      case 1000: return '1K';
      default: return '1M';
    }
  }

  function convertCostToUnit(costPer1M, targetUnit) {
    return costPer1M * (targetUnit / 1000000);
  }

  // ============================================
  // Elo per Dollar Helpers (Logarithmic Formula)
  // ============================================
  const ELO_BASELINE = 1350;

  /**
   * Calculate Value Score using logarithmic price compression
   * Formula: (Elo - baseline) / log(1 + Price)
   * 
   * This formula compresses the "price penalty" - for a business, the difference
   * between $5 and $30 is not "6x the pain", it's just a higher tier of operating cost.
   * 
   * The log(1 + Price) ensures we never divide by zero for free models.
   * 
   * @param {number} arenaScore - The model's Arena Score (Elo)
   * @param {number} inputCostPer1M - Input cost per 1M tokens
   * @param {number} outputCostPer1M - Output cost per 1M tokens
   * @returns {number|null} - Value score or null if not calculable
   */
  function calculateEloPerDollar(arenaScore, inputCostPer1M, outputCostPer1M) {
    if (!arenaScore || arenaScore <= ELO_BASELINE) return null; // Need Elo > baseline for positive score
    const blendedPrice = (inputCostPer1M + outputCostPer1M) / 2;
    // Formula: (Elo - baseline) / log(1 + Price)
    const score = (arenaScore - ELO_BASELINE) / Math.log(1 + blendedPrice);
    return score;
  }

  /**
   * Get gem rating (1-5 gems) based on Value Score
   * Thresholds calibrated for the logarithmic formula output range
   * @param {number} valueScore - The calculated value score
   * @returns {string} - Gem emoji string (1-5 gems)
   */
  function getGemRating(valueScore) {
    if (valueScore === null) return '';

    // Thresholds calibrated for logarithmic formula
    // Example: Flash ($3.50) ≈ 270, Opus ($30.00) ≈ 150
    // Higher score = better value
    if (valueScore >= 250) return '💎💎💎💎💎'; // Exceptional value (5 gems)
    if (valueScore >= 180) return '💎💎💎💎';   // Great value (4 gems)
    if (valueScore >= 120) return '💎💎💎';     // Good value (3 gems)
    if (valueScore >= 80) return '💎💎';        // Fair value (2 gems)
    if (valueScore >= 40) return '💎';          // Low value (1 gem)
    return '';                                  // Poor value (no gems)
  }

  async function loadPreferences() {
    try {
      const result = await chrome.storage.sync.get([CONFIG.TOKEN_UNIT_KEY, CONFIG.PROVIDER_KEY, CONFIG.COLUMN_VISIBILITY_KEY]);
      currentTokenUnit = result[CONFIG.TOKEN_UNIT_KEY] || CONFIG.DEFAULT_TOKEN_UNIT;
      currentProvider = result[CONFIG.PROVIDER_KEY] || CONFIG.DEFAULT_PROVIDER;
      currentColumnVisibility = result[CONFIG.COLUMN_VISIBILITY_KEY] || { ...CONFIG.DEFAULT_COLUMN_VISIBILITY };
    } catch (error) {
      console.warn('[LMArena Plus] Failed to load preferences:', error);
      currentTokenUnit = CONFIG.DEFAULT_TOKEN_UNIT;
      currentProvider = CONFIG.DEFAULT_PROVIDER;
      currentColumnVisibility = { ...CONFIG.DEFAULT_COLUMN_VISIBILITY };
    }
  }

  // ============================================
  // Column Visibility Helpers
  // ============================================
  const COLUMN_NAME_TO_INDEX = {
    'rank': 0,
    'model': 1,
    'arena-score': 2,
    '95-ci': 3,
    'votes': 4,
    'organization': 5,
    'license': 6
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
        // Skip LMArena Plus injected headers
        if (header.classList.contains('lmarena-price-header') ||
          header.classList.contains('lmarena-elopd-header')) {
          return;
        }
        const text = header.textContent.toLowerCase().trim();
        if (text.includes('rank') || text === '#') indexMap['rank'] = idx;
        else if (text.includes('model')) indexMap['model'] = idx;
        else if (text.includes('arena score') || text === 'score') indexMap['arena-score'] = idx;
        else if (text.includes('ci') || text.includes('confidence')) indexMap['95-ci'] = idx;
        else if (text.includes('vote')) indexMap['votes'] = idx;
        else if (text.includes('organization') || text.includes('org')) indexMap['organization'] = idx;
        else if (text.includes('license')) indexMap['license'] = idx;
      });

      // Apply visibility to all rows
      const allRows = table.querySelectorAll('tr');
      allRows.forEach(row => {
        const cells = row.querySelectorAll('th, td');

        // Regular columns
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
    const elopdHeaders = document.querySelectorAll('.lmarena-elopd-header');
    const elopdCells = document.querySelectorAll('.lmarena-elopd-cell');

    const pricingVisible = currentColumnVisibility['pricing'];
    const elopdVisible = currentColumnVisibility['elo-per-dollar'];

    pricingHeaders.forEach(el => el.style.display = pricingVisible ? '' : 'none');
    pricingCells.forEach(el => el.style.display = pricingVisible ? '' : 'none');
    elopdHeaders.forEach(el => el.style.display = elopdVisible ? '' : 'none');
    elopdCells.forEach(el => el.style.display = elopdVisible ? '' : 'none');

    console.log('[LMArena Plus] Column visibility updated');
  }

  // ============================================
  // Loading State Manager
  // ============================================
  class LoadingManager {
    setLoading(cells, loading) {
      cells.forEach(cell => {
        if (loading) {
          cell.textContent = 'Loading';
          cell.classList.add('lmarena-price-cell--loading');
          cell.classList.remove('lmarena-price-cell--na');
        } else {
          cell.classList.remove('lmarena-price-cell--loading');
        }
      });
    }

    setHeaderLoading(loading) {
      const headers = document.querySelectorAll('.lmarena-price-header');
      headers.forEach(header => {
        if (loading) {
          header.classList.add('lmarena-price-header--loading');
        } else {
          header.classList.remove('lmarena-price-header--loading');
        }
      });
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

      console.log(`[LMArena Plus] Fetching data from ${provider}...`);
      await this._fetchPricing(provider);
      this.isLoading = false;
    }

    async switchProvider(provider) {
      console.log(`[LMArena Plus] Switching to provider: ${provider}`);
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
        console.log(`[LMArena Plus] Loaded ${this.pricingMap.size} models from ${provider}`);
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

      console.log(`[LMArena Plus] Built pricing map with ${this.pricingMap.size} entries`);
    }

    _buildHeliconeMap(data) {
      const entries = data.data || data;
      if (!Array.isArray(entries)) return;

      for (const entry of entries) {
        const key = this._normalizeModelName(entry.model);
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

        const key = this._normalizeModelName(modelName);
        const pricing = {
          input_cost_per_1m: (modelData.input_cost_per_token || 0) * 1000000,
          output_cost_per_1m: (modelData.output_cost_per_token || 0) * 1000000,
          operator: 'equals',
          sourceModelName: modelName
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

        const key = this._normalizeModelName(model.id);
        const promptPrice = parseFloat(model.pricing.prompt) || 0;
        const completionPrice = parseFloat(model.pricing.completion) || 0;

        const pricing = {
          input_cost_per_1m: promptPrice * 1000000,
          output_cost_per_1m: completionPrice * 1000000,
          operator: 'equals',
          sourceModelName: model.id
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

    _normalizeModelName(name) {
      if (!name) return '';
      return name
        .toLowerCase()
        .replace(/%3a/gi, ':')
        // Normalize versions: 4-5 -> 4.5, 3_5 -> 3.5 (only between single digits)
        .replace(/(^|[^0-9])(\d)[-_](\d)(?![0-9])/g, '$1$2.$3')
        .replace(/\s+/g, '-')
        .trim();
    }

    getPricing(modelName) {
      const normalized = this._normalizeModelName(modelName);

      // 1. Exact match
      if (this.pricingMap.has(normalized)) {
        return this.pricingMap.get(normalized);
      }

      // 2. Try without common suffixes (search term may have -preview, -beta, etc.)
      //    Handles both - and . separators for metadata
      const withoutSuffix = normalized
        .replace(/[.-](preview|beta|latest|v\d+)(\b|$)/gi, '')
        .replace(/[.-]\d{8}(\b|$)/g, '');

      if (withoutSuffix !== normalized && this.pricingMap.has(withoutSuffix)) {
        return this.pricingMap.get(withoutSuffix);
      }

      // 3. Try without date patterns (YYYYMMDD like 20250929)
      //    Dates can appear anywhere in the name, e.g., claude-sonnet-4-5-20250929-thinking-32k
      const withoutDates = normalized
        .replace(/[.-]20\d{6}(?=[.-]|$)/g, '')  // Remove -20250929 or .20250929
        .replace(/--+/g, '-')  // Clean up double dashes
        .replace(/[.-]$/, '')  // Remove trailing dash or dot
        .trim();

      if (withoutDates !== normalized && withoutDates.length > 0) {
        if (this.pricingMap.has(withoutDates)) {
          return this.pricingMap.get(withoutDates);
        }
        // Try further matching on the date-stripped version
        const dateStrippedMatch = this._findMatch(withoutDates);
        if (dateStrippedMatch) {
          return dateStrippedMatch;
        }
      }

      // 4. Try without "thinking" variants
      //    Handles: -thinking, -thinking-32k, (thinking-minimal), .thinking-high, etc.
      const withoutThinking = normalized
        .replace(/\(thinking[^)]*\)/g, '')  // Remove (thinking...) parenthetical
        .replace(/[.-]thinking(-[a-z0-9]+)*$/i, '')  // Remove -thinking and any suffixes like -32k, -high
        .replace(/[.-]thinking$/i, '')  // Simple .thinking suffix
        .replace(/--+/g, '-')  // Clean up double dashes
        .replace(/[.-]$/, '')  // Remove trailing dash or dot
        .trim();

      if (withoutThinking !== normalized && withoutThinking.length > 0) {
        // First check exact match without thinking
        if (this.pricingMap.has(withoutThinking)) {
          return this.pricingMap.get(withoutThinking);
        }
        // Recursively try matching the non-thinking version
        const baseMatch = this._findMatch(withoutThinking);
        if (baseMatch) {
          return baseMatch;
        }
      }

      // 5. Try stripping BOTH dates AND thinking (for models like claude-sonnet-4-5-20250929-thinking-32k)
      const withoutDatesAndThinking = withoutDates
        .replace(/\(thinking[^)]*\)/g, '')
        .replace(/[.-]thinking(-[a-z0-9]+)*$/i, '')
        .replace(/[.-]thinking$/i, '')
        .replace(/--+/g, '-')
        .replace(/[.-]$/, '')
        .trim();

      if (withoutDatesAndThinking !== normalized && withoutDatesAndThinking !== withoutDates &&
        withoutDatesAndThinking !== withoutThinking && withoutDatesAndThinking.length > 0) {
        if (this.pricingMap.has(withoutDatesAndThinking)) {
          return this.pricingMap.get(withoutDatesAndThinking);
        }
        const combinedMatch = this._findMatch(withoutDatesAndThinking);
        if (combinedMatch) {
          return combinedMatch;
        }
      }

      // 4. Check for operator-based matching (from Helicone data)
      //    IMPORTANT: Prefer LONGER/more specific keys when multiple match
      let operatorMatch = null;
      let operatorMatchLength = 0;

      for (const [key, entry] of this.pricingMap) {
        if (entry.operator === 'includes' && normalized.includes(key)) {
          if (key.length > operatorMatchLength) {
            operatorMatch = entry;
            operatorMatchLength = key.length;
          }
        }
        if (entry.operator === 'startsWith' && normalized.startsWith(key)) {
          if (key.length > operatorMatchLength) {
            operatorMatch = entry;
            operatorMatchLength = key.length;
          }
        }
      }

      if (operatorMatch) {
        return operatorMatch;
      }

      // 5. Search term starts with key (source is the base, we have a more specific version)
      //    Example: "gemini-3-pro-20240101" matches source "gemini-3-pro"
      let bestMatch = null;
      let bestMatchLength = 0;

      for (const [key, entry] of this.pricingMap) {
        if (normalized.startsWith(key)) {
          const charAfterKey = normalized[key.length];
          const charAfterKeyPlus1 = normalized[key.length + 1];
          // Check for valid separator, but NOT if it's a version number continuation
          // e.g., "grok-4" should NOT match "grok-4.1" because ".1" is a version extension
          const isVersionContinuation = (charAfterKey === '.' || charAfterKey === '-') &&
            charAfterKeyPlus1 >= '0' && charAfterKeyPlus1 <= '9' &&
            key[key.length - 1] >= '0' && key[key.length - 1] <= '9';
          if (charAfterKey === undefined ||
            ((charAfterKey === '-' || charAfterKey === '.' || charAfterKey === '/' || charAfterKey === ':') && !isVersionContinuation)) {
            if (key.length > bestMatchLength) {
              bestMatch = entry;
              bestMatchLength = key.length;
            }
          }
        }
      }

      if (bestMatch) {
        return bestMatch;
      }

      // 6. Key starts with search term (source has more specificity like -preview suffix)
      //    Example: "gemini-3-pro" matches source "gemini-3-pro-preview"
      //    IMPORTANT: Prefer SHORTEST matching key to avoid "gemini-3-pro" matching "gemini-3-pro-image-preview"
      let shortestMatch = null;
      let shortestMatchLength = Infinity;

      for (const [key, entry] of this.pricingMap) {
        if (key.startsWith(normalized)) {
          const charAfterNormalized = key[normalized.length];
          // Valid match if key continues with a separator
          if (charAfterNormalized === '-' || charAfterNormalized === '.' || charAfterNormalized === '/' || charAfterNormalized === ':') {
            if (key.length < shortestMatchLength) {
              shortestMatch = entry;
              shortestMatchLength = key.length;
            }
          }
        }
      }

      if (shortestMatch) {
        return shortestMatch;
      }

      return null;
    }

    // Helper method for matching without recursion issues
    _findMatch(normalized) {
      // Check exact match
      if (this.pricingMap.has(normalized)) {
        return this.pricingMap.get(normalized);
      }

      // Check operator-based matching - prefer longer keys
      let operatorMatch = null;
      let operatorMatchLength = 0;
      for (const [key, entry] of this.pricingMap) {
        if (entry.operator === 'includes' && normalized.includes(key)) {
          if (key.length > operatorMatchLength) {
            operatorMatch = entry;
            operatorMatchLength = key.length;
          }
        }
        if (entry.operator === 'startsWith' && normalized.startsWith(key)) {
          if (key.length > operatorMatchLength) {
            operatorMatch = entry;
            operatorMatchLength = key.length;
          }
        }
      }
      if (operatorMatch) return operatorMatch;

      // Check if normalized starts with any key
      let bestMatch = null;
      let bestMatchLength = 0;
      for (const [key, entry] of this.pricingMap) {
        if (normalized.startsWith(key)) {
          const charAfterKey = normalized[key.length];
          const charAfterKeyPlus1 = normalized[key.length + 1];
          // Check for valid separator, but NOT if it's a version number continuation
          const isVersionContinuation = (charAfterKey === '.' || charAfterKey === '-') &&
            charAfterKeyPlus1 >= '0' && charAfterKeyPlus1 <= '9' &&
            key[key.length - 1] >= '0' && key[key.length - 1] <= '9';
          if (charAfterKey === undefined ||
            ((charAfterKey === '-' || charAfterKey === '.' || charAfterKey === '/' || charAfterKey === ':') && !isVersionContinuation)) {
            if (key.length > bestMatchLength) {
              bestMatch = entry;
              bestMatchLength = key.length;
            }
          }
        }
      }
      if (bestMatch) return bestMatch;

      // Check if any key starts with normalized
      let shortestMatch = null;
      let shortestMatchLength = Infinity;
      for (const [key, entry] of this.pricingMap) {
        if (key.startsWith(normalized)) {
          const charAfterNormalized = key[normalized.length];
          if (charAfterNormalized === '-' || charAfterNormalized === '.' || charAfterNormalized === '/' || charAfterNormalized === ':') {
            if (key.length < shortestMatchLength) {
              shortestMatch = entry;
              shortestMatchLength = key.length;
            }
          }
        }
      }

      return shortestMatch;
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
              <span class="lmarena-price-tooltip__value">$${this._formatCost(inputCost)}</span>
            </div>
            <div class="lmarena-price-tooltip__row">
              <span class="lmarena-price-tooltip__label">Output tokens:</span>
              <span class="lmarena-price-tooltip__value">$${this._formatCost(outputCost)}</span>
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

    _positionTooltip(element) {
      if (!element || !element.isConnected) return;

      const rect = element.getBoundingClientRect();
      const tooltipRect = this.tooltip.getBoundingClientRect();

      let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      let top = rect.bottom + 8;

      const padding = 10;
      if (left < padding) left = padding;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }

      if (top + tooltipRect.height > window.innerHeight - padding) {
        top = rect.top - tooltipRect.height - 8;
      }

      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
    }

    _formatCost(cost) {
      return cost.toFixed(2);
    }
  }

  // ============================================
  // Column Injector
  // ============================================
  class ColumnInjector {
    constructor(pricingService, tooltipManager, loadingManager) {
      this.pricingService = pricingService;
      this.tooltipManager = tooltipManager;
      this.loadingManager = loadingManager;
      this.processedTables = new WeakSet();
      this.injectedCells = [];
      this.injectedEloPerDollarCells = [];
    }

    injectIntoTable(table, showLoading = false) {
      const headerRow = this._findHeaderRow(table);
      if (!headerRow) return;

      const modelColumnIndex = this._findModelColumnIndex(headerRow);
      if (modelColumnIndex === -1) return;

      const arenaScoreColumnIndex = this._findArenaScoreColumnIndex(headerRow);

      if (!table.hasAttribute(CONFIG.COLUMN_MARKER)) {
        table.setAttribute(CONFIG.COLUMN_MARKER, 'true');
        this.processedTables.add(table);
        this._injectHeader(headerRow, showLoading);
        this._injectEloPerDollarHeader(headerRow, showLoading);
      }

      this._processUnprocessedRows(table, modelColumnIndex, arenaScoreColumnIndex, showLoading);
    }

    _processUnprocessedRows(table, modelColumnIndex, arenaScoreColumnIndex, showLoading) {
      const rows = table.querySelectorAll('tbody tr, tr');

      rows.forEach(row => {
        if (row.querySelector('th')) return;
        if (row.hasAttribute(CONFIG.ROW_MARKER)) return;

        row.setAttribute(CONFIG.ROW_MARKER, 'true');
        this._injectCell(row, modelColumnIndex, showLoading);
        this._injectEloPerDollarCell(row, modelColumnIndex, arenaScoreColumnIndex, showLoading);
      });
    }

    updateAllCells() {
      for (const cellData of this.injectedCells) {
        const { cell, modelName } = cellData;

        if (!cell.isConnected) continue;

        cell.classList.remove('lmarena-price-cell--loading');
        this._updateCellContent(cell, modelName);
      }

      // Update Elo per Dollar cells
      for (const cellData of this.injectedEloPerDollarCells) {
        const { cell, modelName, arenaScore } = cellData;

        if (!cell.isConnected) continue;

        cell.classList.remove('lmarena-elopd-cell--loading');
        this._updateEloPerDollarCellContent(cell, modelName, arenaScore);
      }

      this.loadingManager.setHeaderLoading(false);
    }

    setAllCellsLoading() {
      const cells = this.injectedCells.filter(c => c.cell.isConnected).map(c => c.cell);
      const elopdCells = this.injectedEloPerDollarCells.filter(c => c.cell.isConnected).map(c => c.cell);
      this.loadingManager.setLoading(cells, true);
      this.loadingManager.setLoading(elopdCells, true);
      this.loadingManager.setHeaderLoading(true);
    }

    clearAllInjections() {
      document.querySelectorAll(`[${CONFIG.COLUMN_MARKER}]`).forEach(el => {
        el.removeAttribute(CONFIG.COLUMN_MARKER);
      });
      document.querySelectorAll(`[${CONFIG.ROW_MARKER}]`).forEach(el => {
        el.removeAttribute(CONFIG.ROW_MARKER);
      });
      document.querySelectorAll('.lmarena-price-header, .lmarena-price-cell, .lmarena-elopd-header, .lmarena-elopd-cell').forEach(el => {
        el.remove();
      });
      this.injectedCells = [];
      this.injectedEloPerDollarCells = [];
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
      if (showLoading) th.classList.add('lmarena-price-header--loading');

      // Add icon and text
      const iconUrl = chrome.runtime.getURL('icons/icon16.png');
      th.innerHTML = `Pricing <img src="${iconUrl}" class="lmarena-price-header__icon" alt="LMArena Plus">`;

      th.setAttribute(CONFIG.COLUMN_MARKER, 'true');
      headerRow.appendChild(th);
    }

    _injectEloPerDollarHeader(headerRow, showLoading) {
      if (headerRow.querySelector('.lmarena-elopd-header')) return;

      const th = document.createElement('th');
      th.className = 'lmarena-elopd-header';
      if (showLoading) th.classList.add('lmarena-elopd-header--loading');

      // Add icon and text with gem emoji
      const iconUrl = chrome.runtime.getURL('icons/icon16.png');
      th.innerHTML = `Elo/$ <img src="${iconUrl}" class="lmarena-price-header__icon" alt="LMArena Plus">`;

      th.setAttribute(CONFIG.COLUMN_MARKER, 'true');
      headerRow.appendChild(th);
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

      if (showLoading) {
        td.textContent = 'Loading';
        td.classList.add('lmarena-price-cell--loading');
      } else {
        this._updateCellContent(td, modelName);
      }

      row.appendChild(td);
    }

    _injectEloPerDollarCell(row, modelColumnIndex, arenaScoreColumnIndex, showLoading) {
      if (row.querySelector('.lmarena-elopd-cell')) return;

      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      const modelCell = cells[modelColumnIndex] || cells[0];
      const modelName = this._extractModelName(modelCell);

      // Extract Arena Score from the table
      let arenaScore = null;
      if (arenaScoreColumnIndex !== -1 && cells[arenaScoreColumnIndex]) {
        const scoreText = cells[arenaScoreColumnIndex].textContent.trim();
        arenaScore = parseFloat(scoreText.replace(/[^0-9.-]/g, ''));
      }

      const td = document.createElement('td');
      td.className = 'lmarena-elopd-cell';
      td.setAttribute(CONFIG.COLUMN_MARKER, 'true');

      this.injectedEloPerDollarCells.push({ cell: td, modelName, arenaScore });

      if (showLoading) {
        td.textContent = 'Loading';
        td.classList.add('lmarena-elopd-cell--loading');
      } else {
        this._updateEloPerDollarCellContent(td, modelName, arenaScore);
      }

      row.appendChild(td);
    }

    _updateCellContent(cell, modelName) {
      const pricing = this.pricingService.getPricing(modelName);
      const unitLabel = getTokenUnitLabel(currentTokenUnit);

      // Clear any existing event listeners by cloning (cleanest way)
      cell.onmouseenter = null;
      cell.onmouseleave = null;

      if (pricing) {
        const inputCost = convertCostToUnit(pricing.input_cost_per_1m || 0, currentTokenUnit);
        const outputCost = convertCostToUnit(pricing.output_cost_per_1m || 0, currentTokenUnit);
        const totalCost = inputCost + outputCost;
        cell.textContent = `$${this._formatCost(totalCost)} / ${unitLabel}`;
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
      }
    }

    _updateEloPerDollarCellContent(cell, modelName, arenaScore) {
      const pricing = this.pricingService.getPricing(modelName);

      if (pricing && arenaScore && arenaScore > 1000) {
        const inputCost = pricing.input_cost_per_1m || 0;
        const outputCost = pricing.output_cost_per_1m || 0;
        const valueScore = calculateEloPerDollar(arenaScore, inputCost, outputCost);
        const gemRating = getGemRating(valueScore);

        if (valueScore !== null) {
          // Format: show score with 1 decimal for cleaner display
          const formattedValue = valueScore.toFixed(1);
          cell.innerHTML = `<span class="lmarena-elopd-value">${formattedValue}</span>`;
          cell.classList.remove('lmarena-elopd-cell--na');
        } else {
          cell.textContent = 'N/A';
          cell.classList.add('lmarena-elopd-cell--na');
        }

        // Store data for tooltip
        cell._eloPerDollarData = { arenaScore, pricing, valueScore };
      } else if (!arenaScore || arenaScore <= 1000) {
        cell.textContent = '—';
        cell.classList.add('lmarena-elopd-cell--na');
        cell._eloPerDollarData = null;
      } else {
        cell.textContent = 'N/A';
        cell.classList.add('lmarena-elopd-cell--na');
        cell._eloPerDollarData = null;
      }
    }

    _extractModelName(cell) {
      const link = cell.querySelector('a');
      if (link) return link.textContent.trim();

      const span = cell.querySelector('span');
      if (span) return span.textContent.trim();

      return cell.textContent.trim();
    }

    _formatCost(cost) {
      return cost.toFixed(2);
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
      tables.forEach(table => {
        if (this._isLeaderboardTable(table)) {
          this.columnInjector.injectIntoTable(table, showLoading);
        }
      });
      // Apply column visibility to new rows
      if (!showLoading) {
        applyColumnVisibility();
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
  let pricingService, tooltipManager, loadingManager, columnInjector, tableObserver;

  async function init() {
    console.log('[LMArena Plus] Initializing...');

    await loadPreferences();

    pricingService = new PricingService();
    tooltipManager = new TooltipManager();
    loadingManager = new LoadingManager();
    columnInjector = new ColumnInjector(pricingService, tooltipManager, loadingManager);
    tableObserver = new TableObserver(columnInjector);

    // Show loading state immediately
    tableObserver.reprocessAll(true);

    // Fetch pricing data (always fresh)
    await pricingService.initialize(currentProvider);
    console.log(`[LMArena Plus] Data loaded from ${currentProvider}`);

    // Update cells with actual data
    columnInjector.updateAllCells();

    // Apply column visibility preferences
    applyColumnVisibility();

    // Start observing for new tables and rows
    tableObserver.start();
    console.log('[LMArena Plus] Ready');

    // Listen for preference changes from popup
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      if (message.type === 'TOKEN_UNIT_CHANGED') {
        currentTokenUnit = message.value;
        columnInjector.updateAllCells();
        console.log('[LMArena Plus] Token unit updated to:', currentTokenUnit);
      } else if (message.type === 'PROVIDER_CHANGED') {
        currentProvider = message.value;
        console.log('[LMArena Plus] Switching provider to:', currentProvider);

        columnInjector.setAllCellsLoading();
        await pricingService.switchProvider(currentProvider);
        columnInjector.updateAllCells();
        applyColumnVisibility();

        console.log('[LMArena Plus] Provider switched successfully');
      } else if (message.type === 'COLUMN_VISIBILITY_CHANGED') {
        currentColumnVisibility = message.value;
        applyColumnVisibility();
        console.log('[LMArena Plus] Column visibility updated:', currentColumnVisibility);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
