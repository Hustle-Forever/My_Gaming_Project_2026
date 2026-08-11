// Resources present on disk but never started in server.cfg. Not dangerous,
// but clutter that confuses future edits and can hide a mistaken de-ensure.
module.exports = {
  id: 'dead-weight',
  title: { en: 'Unused resources', ar: 'موارد غير مستخدمة' },
  severity: 'low',
  run(model) {
    if (!model.deadWeight.length) return [];
    return [{
      checkId: 'dead-weight',
      severity: 'low',
      title: {
        en: `${model.deadWeight.length} resource(s) on disk but never started`,
        ar: `${model.deadWeight.length} مورد على القرص لكنه غير مُشغَّل`,
      },
      why: {
        en: `These sit in resources/ but have no "ensure" line, so FiveM never loads them: ${model.deadWeight.join(', ')}. Usually leftovers — occasionally a feature you forgot to enable.`,
        ar: `هذه موجودة في resources/ لكن بلا "ensure"، فلا يحمّلها FiveM: ${model.deadWeight.join(', ')}. غالبًا بقايا — وأحيانًا ميزة نسيت تفعيلها.`,
      },
      fix: {
        en: `Add "ensure <name>" for any you actually want, and delete the rest to keep the server tidy.`,
        ar: `أضِف "ensure <name>" لما تريده فعلًا، واحذف الباقي لإبقاء السيرفر مرتبًا.`,
      },
      evidence: model.deadWeight.map((n) => ({ resource: n, detail: 'on disk, never ensured' })),
    }];
  },
};
