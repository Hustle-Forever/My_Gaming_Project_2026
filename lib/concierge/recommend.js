// lib/concierge/recommend.js - what the Concierge points a new player at.
// Reads the tenant's latest scan `report.identity.jobs` so it only ever
// recommends jobs that ACTUALLY exist on that server. No scan → the owner's
// configured defaults. It never invents a job the server lacks.

// Bilingual labels + a starting location + one-liner for the jobs we know.
// Unknown jobs still get recommended (from the scan) with a generic label.
const KNOWN = {
  police: { label: { en: 'Law enforcement', ar: 'شرطة' }, loc: { en: 'Mission Row Police Department', ar: 'قسم شرطة ميشن رو' },
    line: { en: 'Head to the police station to sign on and get your first patrol.', ar: 'توجّه لقسم الشرطة للتسجيل وبدء أول دورية.' } },
  ambulance: { label: { en: 'Paramedic / EMS', ar: 'إسعاف' }, loc: { en: 'Pillbox Hill Medical Center', ar: 'مركز بيلبوكس هيل الطبي' },
    line: { en: 'Go to the hospital to start as a paramedic and answer your first call.', ar: 'اذهب للمستشفى لتبدأ كمسعف وتردّ على أول بلاغ.' } },
  ems: { label: { en: 'Paramedic / EMS', ar: 'إسعاف' }, loc: { en: 'Pillbox Hill Medical Center', ar: 'مركز بيلبوكس هيل الطبي' },
    line: { en: 'Go to the hospital to start as a paramedic.', ar: 'اذهب للمستشفى لتبدأ كمسعف.' } },
  mechanic: { label: { en: 'Mechanic', ar: 'ميكانيكي' }, loc: { en: 'the LS Customs garage', ar: 'كراج LS Customs' },
    line: { en: 'Visit the mechanic garage — repairs are steady, reliable money.', ar: 'زُر كراج الميكانيكي — الإصلاحات دخل ثابت ومضمون.' } },
  taxi: { label: { en: 'Taxi driver', ar: 'سائق أجرة' }, loc: { en: 'the Downtown Cab depot', ar: 'مرآب سيارات الأجرة' },
    line: { en: 'Grab a cab downtown and start picking up fares.', ar: 'خذ سيارة أجرة وابدأ بنقل الركاب.' } },
  civilian: { label: { en: 'Civilian / freelance', ar: 'مدني / حر' }, loc: { en: 'the city center', ar: 'وسط المدينة' },
    line: { en: 'Explore the city center — try fishing, deliveries, or just meet people.', ar: 'استكشف وسط المدينة — جرّب الصيد أو التوصيل أو تعرّف على الناس.' } },
};

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// jobs from the scan (report.identity.jobs.jobs = [{name, grades}])
function scannedJobIds(report) {
  const jobs = report && report.identity && report.identity.jobs && report.identity.jobs.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => String(j.name || '').toLowerCase()).filter(Boolean);
}

function labelFor(id) {
  return (KNOWN[id] && KNOWN[id].label) || { en: cap(id), ar: cap(id) };
}

// The recommendable jobs for this tenant: scanned jobs if we have them,
// else the configured defaults. Deduped, capped, always bilingual.
function recommendJobs(config, report, max = 4) {
  const scanned = scannedJobIds(report);
  let list;
  if (scanned.length) {
    list = scanned.map((id) => ({ id, label: labelFor(id) }));
  } else {
    list = (config && config.recommendJobs) || [];
  }
  const seen = new Set();
  return list.filter((j) => j && j.id && !seen.has(j.id) && seen.add(j.id)).slice(0, max)
    .map((j) => ({ id: j.id, label: j.label && j.label.en ? j.label : labelFor(j.id) }));
}

// Destination + one-liner for a chosen job, in the player's language.
function recommendForChoice(config, report, jobId, language = 'en') {
  const id = String(jobId || '').toLowerCase();
  // prefer an owner-configured location if present
  const cfgLoc = (config && config.recommendLocations || []).find((l) => l.id === id || (l.jobId === id));
  const known = KNOWN[id] || KNOWN.civilian;
  const location = cfgLoc ? (cfgLoc.label[language] || cfgLoc.label.en) : (known.loc[language] || known.loc.en);
  const line = known.line[language] || known.line.en;
  return { jobId: id, location, line };
}

// Introduce a real player: prefer someone doing the same/related job, else
// anyone online, else null (never fabricate a person).
function pickNearbyPlayer(players, jobId) {
  const list = Array.isArray(players) ? players.filter((p) => p && p.name) : [];
  if (!list.length) return null;
  const id = String(jobId || '').toLowerCase();
  const related = list.find((p) => String(p.job || '').toLowerCase() === id);
  return related || list[0];
}

module.exports = { recommendJobs, recommendForChoice, pickNearbyPlayer, labelFor };
