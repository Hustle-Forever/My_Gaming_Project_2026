// A resource is started BEFORE a dependency it declares. FiveM starts
// resources in cfg order; a dependency loaded later means broken exports.
module.exports = {
  id: 'load-order',
  title: { en: 'Load-order fault', ar: 'خطأ ترتيب التحميل' },
  severity: 'high',
  run(model) {
    const out = [];
    for (const res of Object.values(model.resources)) {
      if (!res.started || res.orderIndex === null) continue;
      for (const dep of res.dependencies) {
        const target = model.resources[dep];
        if (!target || !target.started || target.orderIndex === null) continue;
        if (target.orderIndex > res.orderIndex) {
          out.push({
            checkId: 'load-order',
            severity: 'high',
            title: {
              en: `${res.name} starts before ${dep}`,
              ar: `${res.name} يبدأ قبل ${dep}`,
            },
            why: {
              en: `${res.name} depends on ${dep} but is ensured first in server.cfg (position ${res.orderIndex + 1} vs ${target.orderIndex + 1}). Its exports won't exist yet.`,
              ar: `${res.name} يعتمد على ${dep} لكنه يُشغَّل أولًا في server.cfg (الموضع ${res.orderIndex + 1} مقابل ${target.orderIndex + 1}). لن تكون صادراته جاهزة.`,
            },
            fix: {
              en: `Move "ensure ${dep}" above "ensure ${res.name}" in server.cfg.`,
              ar: `انقل "ensure ${dep}" فوق "ensure ${res.name}" في server.cfg.`,
            },
            evidence: [
              { resource: res.name, detail: `ensured at position ${res.orderIndex + 1}` },
              { resource: dep, detail: `ensured at position ${target.orderIndex + 1}` },
            ],
          });
        }
      }
    }
    return out;
  },
};
