// Structural faults from buildResourceGraph: double-nested folders, dirs with
// no manifest, and ghost resources (ensured in cfg but absent on disk).
module.exports = {
  id: 'structure',
  title: { en: 'Structure faults', ar: 'أخطاء بنيوية' },
  severity: 'medium',
  run(model) {
    const out = [];

    for (const n of model.structure.nested) {
      out.push({
        checkId: 'nested-folder',
        severity: 'high',
        title: { en: `${n.name} is double-nested`, ar: `${n.name} مجلد متداخل مرتين` },
        why: {
          en: `The manifest is at ${n.path}/fxmanifest.lua — one folder too deep. FiveM won't find the resource, so it never starts.`,
          ar: `الـmanifest في ${n.path}/fxmanifest.lua — أعمق بمجلد. لن يجده FiveM ولن يبدأ المورد.`,
        },
        fix: {
          en: `Move the inner ${n.name} folder's contents up one level so fxmanifest.lua sits directly in ${n.expected}/.`,
          ar: `انقل محتويات مجلد ${n.name} الداخلي مستوى واحدًا للأعلى حتى يكون fxmanifest.lua مباشرة داخل ${n.expected}/.`,
        },
        evidence: [{ resource: n.name, file: `${n.path}/fxmanifest.lua`, detail: 'manifest one level too deep' }],
      });
    }

    for (const dir of model.structure.missingManifest) {
      out.push({
        checkId: 'missing-manifest',
        severity: 'medium',
        title: { en: `${dir} has no manifest`, ar: `${dir} بلا manifest` },
        why: {
          en: `${dir} contains files but no fxmanifest.lua, so FiveM ignores it entirely. Either it's incomplete or it's dead files.`,
          ar: `${dir} يحتوي ملفات لكن بلا fxmanifest.lua، لذا يتجاهله FiveM تمامًا. إما ناقص أو ملفات ميتة.`,
        },
        fix: {
          en: `Add a valid fxmanifest.lua if this should be a resource, or delete the folder if it's junk.`,
          ar: `أضِف fxmanifest.lua صحيحًا إن كان يُفترض أن يكون موردًا، أو احذف المجلد إن كان زائدًا.`,
        },
        evidence: [{ file: dir, detail: 'no fxmanifest.lua / __resource.lua' }],
      });
    }

    for (const g of model.ghosts) {
      out.push({
        checkId: 'ghost-resource',
        severity: 'high',
        title: { en: `${g.name} is ensured but missing`, ar: `${g.name} مُشغَّل لكنه مفقود` },
        why: {
          en: `server.cfg has "ensure ${g.name}" but that resource isn't on disk. FiveM logs an error on every boot and the feature simply doesn't exist.`,
          ar: `يوجد "ensure ${g.name}" في server.cfg لكن المورد غير موجود على القرص. يسجّل FiveM خطأً عند كل إقلاع والميزة غير موجودة أصلًا.`,
        },
        fix: {
          en: `Install ${g.name}, or remove its ensure line from ${g.file}.`,
          ar: `ثبّت ${g.name}، أو احذف سطر ensure من ${g.file}.`,
        },
        evidence: [{ resource: g.name, file: g.file, detail: 'ensured in cfg, not on disk' }],
      });
    }

    // malformed manifests
    for (const res of Object.values(model.resources)) {
      if (res.manifest && res.manifest.malformed) {
        out.push({
          checkId: 'malformed-manifest',
          severity: 'medium',
          title: { en: `${res.name} manifest looks malformed`, ar: `manifest الخاص بـ${res.name} يبدو تالفًا` },
          why: { en: `${res.name}'s fxmanifest.lua is missing the expected directives — it may not load correctly.`, ar: `fxmanifest.lua لـ${res.name} يفتقد التوجيهات المتوقعة — قد لا يُحمّل بشكل صحيح.` },
          fix: { en: `Compare it against a working fxmanifest.lua and add the missing fx_version/game lines.`, ar: `قارنه بـfxmanifest.lua سليم وأضِف أسطر fx_version/game الناقصة.` },
          evidence: [{ resource: res.name, file: res.manifestPath, detail: 'no recognizable manifest directives' }],
        });
      }
    }

    return out;
  },
};
