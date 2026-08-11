// Security risk signals in resource source. Read-only pattern matching; each
// hit carries the file + line so an owner can verify. These are SIGNALS, not
// verdicts - flagged for human review, worded carefully.
const PATTERNS = [
  {
    checkId: 'risk-shell', severity: 'critical',
    re: /\bos\.execute\s*\(|\bio\.popen\s*\(/,
    title: { en: 'Runs shell commands', ar: 'ينفّذ أوامر نظام' },
    why: { en: 'This resource executes operating-system shell commands. On a game server that is almost never legitimate and can fully compromise the host.', ar: 'هذا المورد ينفّذ أوامر نظام التشغيل. في سيرفر ألعاب هذا غير مشروع غالبًا ويمكن أن يخترق الاستضافة بالكامل.' },
    fix: { en: 'Open the flagged file and confirm why it shells out. If you did not add it deliberately, remove the resource.', ar: 'افتح الملف المُشار إليه وتأكد من سبب تنفيذه لأوامر النظام. إن لم تُضِفه عمدًا، احذف المورد.' },
  },
  {
    checkId: 'risk-http', severity: 'high',
    re: /PerformHttpRequest\s*\(\s*['"]https?:\/\/(?!discord\.com\/api\/webhooks)/i,
    title: { en: 'Sends data to an outside server', ar: 'يرسل بيانات لخادم خارجي' },
    why: { en: 'This resource makes outbound HTTP requests to a non-Discord URL. It could be exfiltrating player data or phoning home to a leak panel.', ar: 'هذا المورد يرسل طلبات HTTP لعنوان خارجي (غير Discord). قد يسرّب بيانات اللاعبين أو يتصل بلوحة تسريب.' },
    fix: { en: 'Check the destination URL in the flagged file. Unknown endpoints on a paid/leaked resource are a red flag — remove it.', ar: 'تحقق من عنوان الوجهة في الملف. النقاط المجهولة في مورد مدفوع/مسرَّب علامة خطر — احذفه.' },
  },
  {
    checkId: 'risk-credentials', severity: 'high',
    re: /(password|passwd|api[_-]?key|secret|token)\s*[=:]\s*['"][^'"]{6,}['"]|discord\.com\/api\/webhooks\/\d+\/[\w-]{20,}/i,
    title: { en: 'Hardcoded secret in config', ar: 'سر مكتوب داخل الإعداد' },
    why: { en: 'A password, API key, or webhook token is written directly into a file. Anyone with the files (or a leak) gets it.', ar: 'كلمة مرور أو مفتاح API أو رمز webhook مكتوب مباشرة في ملف. أي شخص لديه الملفات (أو تسريب) يحصل عليه.' },
    fix: { en: 'Move secrets into server.cfg convars (GetConvar) or environment variables, then rotate the exposed secret.', ar: 'انقل الأسرار إلى convars في server.cfg (GetConvar) أو متغيرات البيئة، ثم غيّر السر المكشوف.' },
  },
  {
    checkId: 'risk-obfuscation', severity: 'medium',
    re: /load(?:string)?\s*\(\s*[^)]*\\x[0-9a-f]{2}|\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){20,}/i,
    title: { en: 'Obfuscated code', ar: 'شيفرة مُبهَّمة' },
    why: { en: 'This file contains long hex-escaped blobs passed to load(). Obfuscation hides what the code actually does — a common backdoor technique.', ar: 'يحتوي هذا الملف على كتل hex طويلة تُمرَّر إلى load(). الإبهام يخفي ما تفعله الشيفرة فعلًا — أسلوب باب خلفي شائع.' },
    fix: { en: 'Do not trust obfuscated server code. Replace it with a legitimate copy of the resource, or remove it.', ar: 'لا تثق بشيفرة سيرفر مُبهَّمة. استبدلها بنسخة شرعية من المورد، أو احذفها.' },
  },
];

module.exports = {
  id: 'risk-signals',
  title: { en: 'Security risk signals', ar: 'إشارات خطر أمني' },
  severity: 'high',
  run(model, ctx) {
    const out = [];
    if (!ctx || !ctx.adapter) return out;

    // escrow marker is structural (from the model), not source-scanned
    for (const res of Object.values(model.resources)) {
      if (res.escrow) {
        out.push({
          checkId: 'risk-escrow', severity: 'info',
          title: { en: `${res.name} is escrow-protected`, ar: `${res.name} محمي بنظام Escrow` },
          why: { en: `${res.name} ships as FiveM escrow (encrypted) code. That's normal for paid resources, but its internals can't be audited — trust the seller.`, ar: `${res.name} يأتي كشيفرة escrow مشفّرة من FiveM. هذا طبيعي للموارد المدفوعة لكن لا يمكن تدقيق داخله — ثِق بالبائع فقط.` },
          fix: { en: `No action needed if you bought it from a trusted seller.`, ar: `لا حاجة لإجراء إن اشتريته من بائع موثوق.` },
          evidence: [{ resource: res.name, file: `${res.relPath}/.fxap`, detail: 'FiveM escrow marker present' }],
        });
      }
    }

    for (const res of Object.values(model.resources)) {
      for (const file of ctx.adapter.listFiles(res.relPath)) {
        if (!/\.(lua|cfg|json)$/.test(file.path)) continue;
        let src;
        try { src = ctx.adapter.readFile(file.path); } catch (_) { continue; }
        const lines = src.split(/\r?\n/);
        for (const pat of PATTERNS) {
          for (let i = 0; i < lines.length; i++) {
            if (pat.re.test(lines[i])) {
              out.push({
                checkId: pat.checkId, severity: pat.severity,
                title: { en: `${res.name}: ${pat.title.en.toLowerCase()}`, ar: `${res.name}: ${pat.title.ar}` },
                why: pat.why, fix: pat.fix,
                evidence: [{ resource: res.name, file: file.path, line: i + 1, detail: lines[i].trim().slice(0, 120) }],
              });
              break; // one hit per pattern per file is enough
            }
          }
        }
      }
    }
    return out;
  },
};
