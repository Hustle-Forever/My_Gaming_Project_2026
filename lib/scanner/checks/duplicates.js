// Two or more STARTED resources filling the same role - the classic cause of
// "my inventory randomly breaks". Roles are matched by known resource names.
const ROLES = {
  inventory: ['ox_inventory', 'qb-inventory', 'qs-inventory', 'ps-inventory', 'esx_inventoryhud', 'codem-inventory', 'core_inventory', 'tgiann-inventory'],
  target: ['qb-target', 'ox_target', 'bt-target'],
  spawn: ['spawnmanager', 'qb-spawn', 'esx_spawnmanager'],
  anticheat: ['FiveGuard', 'wardenac', 'fivem-anticheat', 'anticheat'],
  hud: ['qb-hud', 'ox_hud', 'esx_status'],
};
const AR = { inventory: 'أنظمة حقيبة', target: 'أنظمة استهداف', spawn: 'مدراء ظهور', anticheat: 'أنظمة حماية', hud: 'واجهات HUD' };

module.exports = {
  id: 'duplicate-inventory',
  title: { en: 'Duplicate systems', ar: 'أنظمة مكررة' },
  severity: 'high',
  run(model) {
    const out = [];
    for (const [role, names] of Object.entries(ROLES)) {
      const active = names.filter((n) => model.resources[n] && model.resources[n].started);
      if (active.length >= 2) {
        out.push({
          checkId: role === 'inventory' ? 'duplicate-inventory' : `duplicate-${role}`,
          severity: 'high',
          title: {
            en: `Two ${role} systems running`,
            ar: `${AR[role] || role} تعمل في آن واحد`,
          },
          why: {
            en: `${active.join(' and ')} are both started. Two ${role} systems fight over the same events and cause items/data to vanish or duplicate.`,
            ar: `${active.join(' و ')} كلاهما مُشغَّل. تشغيل نظامين لنفس الوظيفة يسبب تعارضًا وفقدان أو تكرار البيانات.`,
          },
          fix: {
            en: `Keep one ${role} and remove the others from server.cfg (comment out the ensure line). Migrate data first if needed.`,
            ar: `أبقِ نظامًا واحدًا واحذف البقية من server.cfg (علّق سطر ensure). انقل البيانات أولًا إذا لزم.`,
          },
          evidence: active.map((n) => ({ resource: n, file: model.resources[n].manifestPath, detail: `${n} started` })),
        });
      }
    }
    return out;
  },
};
