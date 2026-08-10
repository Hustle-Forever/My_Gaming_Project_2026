// lib/stub-interpret.js - deterministic Arabic/English keyword interpreter.
// The shared no-AI fallback: used by the platform when a tenant has no
// provider key (or the provider call fails), and by the standalone demo
// backend. Output always passes through actions.validateAction.
const actions = require('../backend/actions');

// Arabic-Indic (٠-٩) and Eastern Arabic (۰-۹) digits -> ASCII, so "الساعة ٥"
// works, and Arabic diacritics (tashkeel, e.g. the shadda in "صلّح") are
// stripped so vowelized spellings still match the plain keywords.
function normalizeDigits(text) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْٰ]/g, '');
}

const VEHICLE_KEYWORDS = {
  police: ['شرط', 'بوليس', 'police'],
  ambulance: ['اسعاف', 'إسعاف', 'ambulance'],
  taxi: ['تاكسي', 'تكسي', 'اجرة', 'أجرة', 'taxi'],
  adder: ['ادر', 'أدر', 'adder'],
  sultan: ['سلطان', 'sultan'],
  bmx: ['دراجة', 'دراجه', 'بسكليت', 'سيكل', 'bmx', 'bike', 'bicycle'],
  blista: ['بليستا', 'blista'],
  faggio: ['سكوتر', 'فاجيو', 'faggio', 'scooter'],
};

const WEATHER_KEYWORDS = {
  thunder: ['رعد', 'عاصفة', 'عاصفه', 'thunder', 'storm'],
  rain: ['مطر', 'ممطر', 'أمطار', 'امطار', 'rain'],
  fog: ['ضباب', 'fog'],
  snow: ['ثلج', 'snow'],
  clear: ['صحو', 'شمس', 'مشمس', 'صافي', 'clear', 'sunny'],
};

function stubInterpret(text) {
  const t = normalizeDigits(String(text || '')).toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));
  const finish = (name, params) => {
    try {
      const valid = actions.validateAction(name, params);
      return { action: valid.action, params: valid.params };
    } catch (_) {
      return { action: 'none', params: {} };
    }
  };

  // repair before spawn: "صلح سيارتي" mentions a car but wants a repair
  if (has('صلح', 'تصليح', 'اصلح', 'أصلح', 'repair') || (has('fix') && has('car', 'سيار', 'مركب'))) {
    return finish('repair_vehicle', {});
  }

  if (has('عالج', 'اشفني', 'إشفني', 'داوني', 'صحتي', 'انعش', 'أنعش', 'heal', 'health')) {
    return finish('heal_player', {});
  }

  for (const [type, words] of Object.entries(WEATHER_KEYWORDS)) {
    if (has(...words)) return finish('set_weather', { type });
  }

  // set_time needs an explicit clock word AND a digit, so questions like
  // "كم الساعة في طوكيو" (no digits) fall through to none.
  // Word-based times are also supported: "خلي الوقت ليل" / "set time to night".
  const digits = t.match(/\d{1,2}/);
  if (digits && has('الساعة', 'الساعه', 'الوقت', 'time', 'hour')) {
    return finish('set_time', { hour: parseInt(digits[0], 10) });
  }
  if (has('الوقت', 'time')) {
    if (has('ليل', 'night', 'منتصف الليل', 'midnight')) return finish('set_time', { hour: 23 });
    if (has('صباح', 'الصبح', 'morning')) return finish('set_time', { hour: 8 });
    if (has('ظهر', 'نهار', 'noon', 'day')) return finish('set_time', { hour: 12 });
    if (has('مغرب', 'غروب', 'sunset', 'evening')) return finish('set_time', { hour: 18 });
  }

  if (has('اشخاص', 'أشخاص', 'ناس', 'مواطن', 'npc', 'ped', 'شخصيات', 'people')) {
    const count = digits ? parseInt(digits[0], 10) : 1;
    return finish('spawn_npc', { count });
  }

  for (const [model, words] of Object.entries(VEHICLE_KEYWORDS)) {
    if (has(...words)) return finish('spawn_vehicle', { model });
  }

  return { action: 'none', params: {} };
}

module.exports = { stubInterpret, normalizeDigits };
