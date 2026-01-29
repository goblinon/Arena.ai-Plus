/*
 * LMArena Plus - Adds pricing and other useful data to LMArena's leaderboard tables.
 * Copyright (C) 2025 LMArena Plus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * Shared tooltip data for column headers.
 * Used by both content.js (leaderboard) and popup.js (column picker).
 */
const COLUMN_TOOLTIPS = {
    pricing: {
        title: 'Pricing',
        description: 'Cost per token to use this model. Shows combined input + output cost, with breakdown on hover.'
    },
    'bang-for-buck': {
        title: 'Bang for Buck',
        description: 'Measures how much intelligence you get for your money. Balances Arena Score against price, with a bonus for top-ranked models. Higher values = better value.'
    },
    'context-window': {
        title: 'Context Size',
        description: 'Maximum tokens the model can process. Larger context = longer conversations or documents.'
    },
    modalities: {
        title: 'Modalities',
        description: 'Data types the model can handle. Top row: inputs. Bottom row: outputs.'
    },
    notification: {
        title: 'Generation Complete Alerts',
        description: 'Get browser notifications when models finish generating.<br>Allow notifications on arena.ai when prompted!'
    }
};

// Aliases for internal keys used in content.js
COLUMN_TOOLTIPS.bfb = COLUMN_TOOLTIPS['bang-for-buck'];
COLUMN_TOOLTIPS.ctx = COLUMN_TOOLTIPS['context-window'];
COLUMN_TOOLTIPS.mod = COLUMN_TOOLTIPS.modalities;

// Battle notification settings
const BATTLE_NOTIFICATION_KEY = 'lmarena-battle-notification';
