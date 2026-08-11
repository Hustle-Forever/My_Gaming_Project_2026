// A manifest declares a dependency that is not present, or present but never
// started. The resource will error on boot or silently misbehave.
module.exports = {
  id: 'missing-dependency',
  title: { en: 'Missing dependency', ar: 'اعتمادية ناقصة' },
  severity: 'high',
  run(model) {
    const out = [];
    for (const res of Object.values(model.resources)) {
      if (!res.started) continue; // only started resources actually load
      for (const dep of res.dependencies) {
        const target = model.resources[dep];
        if (!target) {
          out.push(finding(res, dep, 'absent'));
        } else if (!target.started) {
          out.push(finding(res, dep, 'not-started'));
        }
      }
    }
    return out;
  },
};

function finding(res, dep, kind) {
  const absent = kind === 'absent';
  return {
    checkId: 'missing-dependency',
    severity: absent ? 'high' : 'medium',
    title: {
      en: `${res.name} needs ${dep}`,
      ar: `${res.name} يحتاج ${dep}`,
    },
    why: {
      en: absent
        ? `${res.name} declares a dependency on ${dep}, but ${dep} is not installed. ${res.name} will fail to start or throw errors.`
        : `${res.name} depends on ${dep}, which is installed but not started in server.cfg.`,
      ar: absent
        ? `${res.name} يعتمد على ${dep} لكنه غير مثبَّت. سيفشل ${res.name} في التشغيل أو يُصدر أخطاء.`
        : `${res.name} يعتمد على ${dep} وهو مثبَّت لكنه غير مُشغَّل في server.cfg.`,
    },
    fix: {
      en: absent
        ? `Install ${dep} and ensure it in server.cfg before ${res.name}.`
        : `Add "ensure ${dep}" to server.cfg before ${res.name}.`,
      ar: absent
        ? `ثبّت ${dep} وأضِف "ensure ${dep}" قبل ${res.name}.`
        : `أضِف "ensure ${dep}" في server.cfg قبل ${res.name}.`,
    },
    evidence: [{ resource: res.name, file: res.manifestPath, detail: `dependency '${dep}' ${kind}` }],
  };
}
