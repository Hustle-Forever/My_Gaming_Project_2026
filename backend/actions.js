// actions.js - THE WHITELIST. Single source of truth for every action this
// system can ever perform. All actions are in-game roleplay events only.
// The Claude tool schema, the validation gate, and the Arabic reply templates
// are all derived from this file - nothing else defines actions anywhere.

const ALLOWED_VEHICLE_MODELS = ['police', 'adder', 'sultan', 'ambulance', 'taxi', 'bmx', 'blista', 'faggio'];
const WEATHER_TYPES = ['clear', 'rain', 'thunder', 'fog', 'snow'];

const VEHICLE_AR = {
  police: 'سيارة شرطة',
  adder: 'سيارة أدر الرياضية',
  sultan: 'سيارة سلطان',
  ambulance: 'سيارة إسعاف',
  taxi: 'تاكسي',
  bmx: 'دراجة هوائية',
  blista: 'سيارة بليستا',
  faggio: 'سكوتر فاجيو',
};

const WEATHER_AR = {
  clear: 'صحو',
  rain: 'ممطر',
  thunder: 'عاصف مع رعد',
  fog: 'ضبابي',
  snow: 'مثلج',
};

function requireInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${name} must be an integer`);
  }
  return n;
}

const ACTIONS = {
  spawn_vehicle: {
    description:
      'Spawn a vehicle near the player and seat them in it. Use when the player asks for a car, vehicle, bike or scooter. ' +
      'Allowed models: police (police cruiser), adder (supercar), sultan (sports sedan), ambulance, taxi, bmx (bicycle), blista (compact car), faggio (scooter).',
    params: {
      model: { type: 'string', enum: ALLOWED_VEHICLE_MODELS, description: 'Vehicle model to spawn' },
    },
    required: ['model'],
    validate(params) {
      const model = String(params.model || '').toLowerCase().trim();
      if (!ALLOWED_VEHICLE_MODELS.includes(model)) {
        throw new Error(`model must be one of: ${ALLOWED_VEHICLE_MODELS.join(', ')}`);
      }
      return { model };
    },
  },

  set_weather: {
    description: 'Change the in-game weather for everyone on the server.',
    params: {
      type: { type: 'string', enum: WEATHER_TYPES, description: 'Weather type' },
    },
    required: ['type'],
    validate(params) {
      const type = String(params.type || '').toLowerCase().trim();
      if (!WEATHER_TYPES.includes(type)) {
        throw new Error(`type must be one of: ${WEATHER_TYPES.join(', ')}`);
      }
      return { type };
    },
  },

  set_time: {
    description: 'Set the in-game clock to a specific hour (24h format).',
    params: {
      hour: { type: 'integer', minimum: 0, maximum: 23, description: 'Hour of day, 0-23' },
    },
    required: ['hour'],
    validate(params) {
      const hour = requireInt(params.hour, 'hour');
      if (hour < 0 || hour > 23) throw new Error('hour must be between 0 and 23');
      return { hour };
    },
  },

  heal_player: {
    description: "Fully restore the player's health and armor.",
    params: {},
    required: [],
    validate() {
      return {};
    },
  },

  spawn_npc: {
    description: 'Spawn 1-5 friendly/neutral pedestrian NPCs near the player (e.g. for a mission scene).',
    params: {
      count: { type: 'integer', minimum: 1, maximum: 5, description: 'How many NPCs (1-5). Default 1.' },
    },
    required: [],
    validate(params) {
      let count = params.count === undefined || params.count === null ? 1 : requireInt(params.count, 'count');
      count = Math.min(5, Math.max(1, count));
      return { count };
    },
  },

  repair_vehicle: {
    description: 'Fully repair the vehicle the player is currently sitting in.',
    params: {},
    required: [],
    validate() {
      return {};
    },
  },
};

// Names + descriptions + param schemas for building the Claude tool schema.
// Filtered by the tenant's allowed-actions list (the per-tenant seam).
function listForClaude(allowedActions) {
  const names = Object.keys(ACTIONS).filter(
    (name) => !allowedActions || allowedActions.includes(name)
  );
  return names.map((name) => ({
    name,
    description: ACTIONS[name].description,
    params: ACTIONS[name].params,
    required: ACTIONS[name].required,
  }));
}

// The single validation gate. Every action - from Claude, from the stub, from
// anywhere - passes through here before it may be queued. Throws on anything
// that is not a clean, whitelisted, tenant-allowed action.
function validateAction(name, params, allowedActions) {
  if (name === 'none') return { action: 'none', params: {} };
  const def = ACTIONS[name];
  if (!def) throw new Error(`unknown action: ${name}`);
  if (allowedActions && !allowedActions.includes(name)) {
    throw new Error(`action not allowed for this tenant: ${name}`);
  }
  return { action: name, params: def.validate(params || {}) };
}

// English labels for vehicles/weather, mirroring the Arabic maps above.
const VEHICLE_EN = {
  police: 'police car', adder: 'Adder supercar', sultan: 'Sultan', ambulance: 'ambulance',
  taxi: 'taxi', bmx: 'BMX bike', blista: 'Blista', faggio: 'Faggio scooter',
};
const WEATHER_EN = {
  clear: 'clear', rain: 'rainy', thunder: 'stormy with thunder', fog: 'foggy', snow: 'snowy',
};

// Friendly confirmation for the app, from a template map (no extra AI call).
// `lang` follows the language the operator actually wrote in ('ar' | 'en'),
// NOT any UI toggle — see api/command.js. Defaults to Arabic for callers that
// don't pass one (the standalone demo backend).
function friendlyMessage(action, params = {}, lang = 'ar') {
  if (lang === 'en') {
    switch (action) {
      case 'spawn_vehicle':
        return `Done — a ${VEHICLE_EN[params.model] || params.model} is on the way.`;
      case 'set_weather':
        return `Done — the weather is now ${WEATHER_EN[params.type] || params.type}.`;
      case 'set_time':
        return `Done — the clock is set to ${String(params.hour).padStart(2, '0')}:00.`;
      case 'heal_player':
        return 'Done — your health and armor are fully restored.';
      case 'spawn_npc':
        return params.count === 1 ? 'Done — one person is heading your way.' : `Done — ${params.count} people are heading your way.`;
      case 'repair_vehicle':
        return 'Done — your vehicle is fully repaired.';
      default:
        return "I didn't catch that.";
    }
  }
  switch (action) {
    case 'spawn_vehicle':
      return `تم — ${VEHICLE_AR[params.model] || params.model} في الطريق`;
    case 'set_weather':
      return `تم — الطقس صار ${WEATHER_AR[params.type] || params.type}`;
    case 'set_time':
      return `تم — الساعة صارت ${params.hour}:00`;
    case 'heal_player':
      return 'تم — رجعت لك صحتك ودرعك كاملين';
    case 'spawn_npc':
      return params.count === 1 ? 'تم — شخص واحد في الطريق إليك' : `تم — ${params.count} أشخاص في الطريق إليك`;
    case 'repair_vehicle':
      return 'تم — سيارتك تصلحت بالكامل';
    default:
      return 'لم أفهم الطلب';
  }
}

module.exports = {
  ACTIONS,
  ALLOWED_VEHICLE_MODELS,
  WEATHER_TYPES,
  listForClaude,
  validateAction,
  friendlyMessage,
};
