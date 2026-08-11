// Performance suspects: threads that spin with no yield, or Wait(0) in a
// long-running loop doing per-frame work, plus oversized asset streams.
// Line-accurate so an owner can jump straight to the hot loop.
module.exports = {
  id: 'performance',
  title: { en: 'Performance suspects', ar: 'مواضع بطء محتملة' },
  severity: 'medium',
  run(model, ctx) {
    const out = [];
    if (!ctx || !ctx.adapter) return out;

    for (const res of Object.values(model.resources)) {
      for (const file of ctx.adapter.listFiles(res.relPath)) {
        if (!file.path.endsWith('.lua')) continue;
        let src;
        try { src = ctx.adapter.readFile(file.path); } catch (_) { continue; }
        scanThreads(src).forEach((hit) => {
          out.push({
            checkId: 'busy-loop',
            severity: hit.noWait ? 'high' : 'medium',
            title: {
              en: hit.noWait ? `${res.name}: loop with no Wait` : `${res.name}: Wait(0) hot loop`,
              ar: hit.noWait ? `${res.name}: حلقة بلا Wait` : `${res.name}: حلقة Wait(0) مكثّفة`,
            },
            why: {
              en: hit.noWait
                ? `A while-true loop in ${file.path} never calls Wait(), so it runs thousands of times per second and will freeze the server thread.`
                : `A while-true loop in ${file.path} uses Wait(0) (every frame). Doing real work every frame is the #1 cause of client FPS drops.`,
              ar: hit.noWait
                ? `حلقة while-true في ${file.path} لا تستدعي Wait()، فتعمل آلاف المرات بالثانية وتُجمّد خيط السيرفر.`
                : `حلقة while-true في ${file.path} تستخدم Wait(0) (كل إطار). العمل الثقيل كل إطار هو السبب الأول لتدني الأداء.`,
            },
            fix: {
              en: hit.noWait
                ? `Add a Wait(ms) inside the loop — even Wait(0) yields the thread; use the largest interval the feature tolerates.`
                : `Raise the Wait value (e.g. Wait(500)) or gate the work behind a distance/state check so it isn't done every frame.`,
              ar: hit.noWait
                ? `أضِف Wait(ms) داخل الحلقة — حتى Wait(0) يُفسح الخيط؛ استخدم أكبر فاصل تتحمّله الميزة.`
                : `ارفع قيمة Wait (مثلًا Wait(500)) أو اربط العمل بشرط مسافة/حالة كي لا يُنفَّذ كل إطار.`,
            },
            evidence: [{ resource: res.name, file: file.path, line: hit.line, detail: hit.noWait ? 'while true with no Wait()' : 'Wait(0) in a persistent loop' }],
          });
        });
      }

      // oversized stream folder (bytes were measured without reading content)
      if (res.streamBytes > 200 * 1024 * 1024) {
        out.push({
          checkId: 'heavy-stream',
          severity: 'low',
          title: { en: `${res.name}: large stream assets`, ar: `${res.name}: ملفات stream ضخمة` },
          why: { en: `${res.name} streams ${(res.streamBytes / 1048576) | 0} MB of assets. Very large streams slow player joins and raise memory use.`, ar: `${res.name} يبث ${(res.streamBytes / 1048576) | 0} ميغابايت. الملفات الضخمة تبطئ دخول اللاعبين وترفع استهلاك الذاكرة.` },
          fix: { en: `Compress textures (YTD) and remove unused models, or split rarely-used assets into an on-demand resource.`, ar: `اضغط القوام (YTD) واحذف النماذج غير المستخدمة، أو افصل الملفات النادرة في مورد عند الطلب.` },
          evidence: [{ resource: res.name, detail: `${(res.streamBytes / 1048576) | 0} MB in stream/` }],
        });
      }
    }
    return out;
  },
};

// find CreateThread/while true blocks and whether they yield
function scanThreads(src) {
  const lines = src.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/while\s+true\s+do/.test(lines[i])) {
      // look ahead until the matching depth closes (approximate: next ~40 lines)
      let body = '';
      let line = i + 1;
      for (let j = i; j < Math.min(lines.length, i + 40); j++) {
        body += lines[j] + '\n';
        if (/\bend\b/.test(lines[j]) && j > i) break;
      }
      const hasWait = /\bWait\s*\(\s*(\d+)\s*\)/.exec(body);
      if (!hasWait) hits.push({ line, noWait: true });
      else if (Number(hasWait[1]) === 0) hits.push({ line, noWait: false });
    }
  }
  return hits;
}
