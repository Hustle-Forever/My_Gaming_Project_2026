// lib/scanner/report.js - turn raw findings into a ranked, plain-language,
// bilingual health report a non-technical owner understands.
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEV_WEIGHT = { critical: 30, high: 15, medium: 6, low: 2, info: 0 };

function buildReport({ identity, findings, model }) {
  const ranked = [...findings].sort((a, b) => {
    const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    return s !== 0 ? s : String(a.checkId).localeCompare(String(b.checkId));
  });

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let penalty = 0;
  for (const f of ranked) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    penalty += SEV_WEIGHT[f.severity] || 0;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    schemaVersion: 1,
    identity,
    health: { score, ...verdict(score, counts), counts },
    findings: ranked,
    model, // derived structure only — never raw source (asserted in tests)
  };
}

function verdict(score, counts) {
  let en, ar;
  if (counts.critical > 0) {
    en = `Critical problems found — parts of your server won't run until these are fixed.`;
    ar = `توجد مشاكل حرجة — أجزاء من سيرفرك لن تعمل حتى تُصلَح.`;
  } else if (score >= 90) {
    en = `Healthy. No blocking problems — just minor cleanup at most.`;
    ar = `سليم. لا مشاكل تعطيلية — تنظيف بسيط على الأكثر.`;
  } else if (score >= 70) {
    en = `Mostly healthy, with a few issues worth fixing.`;
    ar = `سليم غالبًا، مع بعض المشاكل التي يُستحسن إصلاحها.`;
  } else if (score >= 40) {
    en = `Needs attention — several issues are likely affecting stability.`;
    ar = `يحتاج انتباهًا — عدة مشاكل تؤثر على الاستقرار غالبًا.`;
  } else {
    en = `Poor health — multiple serious problems need fixing.`;
    ar = `حالة ضعيفة — عدة مشاكل خطيرة تحتاج إصلاحًا.`;
  }
  return { verdict: { en, ar } };
}

module.exports = { buildReport, SEV_ORDER };
