/**
 * ADD-ON to OuraPuller.gs — paste this block in alongside your existing
 * functions (don't replace the file, just add this at the end).
 *
 * Purpose: fixes stale backfill rows (days pulled from the original Oura
 * export zip, before Oura finished syncing that day's activity/steps —
 * e.g. Jul 19-21 showing undercounted steps) and doubles as a permanent
 * catch-up tool if the daily trigger ever misses a day.
 *
 * These call the SAME fetch/write logic as pullOuraDaily — nothing new
 * to trust, just re-run for a specific day instead of only "yesterday."
 */

// Re-pulls ONE specific day (format: 'YYYY-MM-DD') and overwrites that
// row in the Oura tab with fresh data from Oura's live API.
function refreshOuraDay(dateStr) {
  const service = getOuraService_();
  if (!service.hasAccess()) {
    Logger.log('Not authorized — run showOuraAuthUrl first.');
    return;
  }
  pullOuraForDay_(service, dateStr);
  Logger.log('Refreshed %s', dateStr);
}

// Re-pulls the last N days (including today, excluding future), useful
// as a one-time fix for the stale backfill boundary, or a safety net if
// the daily trigger ever misses a run. Call with e.g. refreshRecentOuraDays(5).
function refreshRecentOuraDays(n) {
  const service = getOuraService_();
  if (!service.hasAccess()) {
    Logger.log('Not authorized — run showOuraAuthUrl first.');
    return;
  }
  for (let i = 1; i <= n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = Utilities.formatDate(d, OURA_TIMEZONE, 'yyyy-MM-dd');
    pullOuraForDay_(service, dateStr);
    Utilities.sleep(300); // small pause between calls, polite to the API
  }
  Logger.log('Refreshed last %s day(s).', n);
}

// Shared logic extracted from pullOuraDaily so both the daily trigger and
// the manual refresh functions above use the exact same fetch/write path.
function pullOuraForDay_(service, day) {
  const row = { day: day, pulled_at: new Date().toISOString() };

  const sleepDocs = fetchDayFiltered_(service, 'daily_sleep', day);
  if (sleepDocs[0]) {
    const s = sleepDocs[0];
    row.sleep_score = pick_(s, 'score');
    const c = s.contributors || {};
    row.sc_deep_sleep = pick_(c, 'deep_sleep');
    row.sc_rem_sleep = pick_(c, 'rem_sleep');
    row.sc_latency = pick_(c, 'latency');
    row.sc_restfulness = pick_(c, 'restfulness');
    row.sc_timing = pick_(c, 'timing');
    row.sc_efficiency = pick_(c, 'efficiency');
    row.sc_total_sleep = pick_(c, 'total_sleep');
  }

  const readinessDocs = fetchDayFiltered_(service, 'daily_readiness', day);
  if (readinessDocs[0]) {
    const r = readinessDocs[0];
    row.readiness_score = pick_(r, 'score');
    row.temp_dev = round1_(pick_(r, 'temperature_deviation'));
    row.temp_trend = round1_(pick_(r, 'temperature_trend_deviation'));
    const rc = r.contributors || {};
    row.rc_hrv_balance = pick_(rc, 'hrv_balance');
    row.rc_resting_heart_rate = pick_(rc, 'resting_heart_rate');
    row.rc_recovery_index = pick_(rc, 'recovery_index');
    row.rc_body_temperature = pick_(rc, 'body_temperature');
    row.rc_activity_balance = pick_(rc, 'activity_balance');
    row.rc_sleep_balance = pick_(rc, 'sleep_balance');
  }

  const activityDocs = fetchDayFiltered_(service, 'daily_activity', day);
  if (activityDocs[0]) {
    const a = activityDocs[0];
    row.activity_score = pick_(a, 'score');
    row.steps = pick_(a, 'steps');
    row.active_cal = pick_(a, 'active_calories');
    row.total_cal = pick_(a, 'total_calories');
    row.walk_m = pick_(a, 'equivalent_walking_distance');
    row.high_min = minutesFromSeconds_(pick_(a, 'high_activity_time'));
    row.med_min = minutesFromSeconds_(pick_(a, 'medium_activity_time'));
    row.low_min = minutesFromSeconds_(pick_(a, 'low_activity_time'));
    row.sed_min = minutesFromSeconds_(pick_(a, 'sedentary_time'));
    row.rest_min = minutesFromSeconds_(pick_(a, 'resting_time'));
    row.met_min = round1_(pick_(a, 'average_met_minutes'));
    row.nonwear_min = minutesFromSeconds_(pick_(a, 'non_wear_time'));
  }

  const stressDocs = fetchDayFiltered_(service, 'daily_stress', day);
  if (stressDocs[0]) {
    const st = stressDocs[0];
    row.stress_high = minutesFromSeconds_(pick_(st, 'stress_high'));
    row.recov_high = minutesFromSeconds_(pick_(st, 'recovery_high'));
    row.stress_sum = pick_(st, 'day_summary');
  }

  const vo2Docs = fetchDayFiltered_(service, 'vO2_max', day);
  if (vo2Docs[0]) row.vo2 = round1_(pick_(vo2Docs[0], 'vo2_max'));

  const cvaDocs = fetchDayFiltered_(service, 'daily_cardiovascular_age', day);
  if (cvaDocs[0]) {
    row.vage = pick_(cvaDocs[0], 'vascular_age');
    row.pwv = round1_(pick_(cvaDocs[0], 'pulse_wave_velocity'));
  }

  const resDocs = fetchDayFiltered_(service, 'daily_resilience', day);
  if (resDocs[0]) row.res = pick_(resDocs[0], 'level');

  const spo2Docs = fetchDayFiltered_(service, 'daily_spo2', day);
  if (spo2Docs[0]) {
    const sp = spo2Docs[0];
    row.spo2 = round1_(pick_(sp.spo2_percentage || {}, 'average'));
    row.bdi = pick_(sp, 'breathing_disturbance_index');
  }

  const periods = fetchDayFiltered_(service, 'sleep', day);
  const longSleeps = periods.filter(p => p.type === 'long_sleep');
  const pool = longSleeps.length ? longSleeps : periods.filter(p => p.type === 'sleep');
  if (pool.length) {
    const b = pool.reduce((best, p) =>
      (p.total_sleep_duration || 0) > (best.total_sleep_duration || 0) ? p : best
    );
    row.hrv = pick_(b, 'average_hrv');
    row.lowest_hr = pick_(b, 'lowest_heart_rate');
    row.avg_hr = round1_(pick_(b, 'average_heart_rate'));
    row.breath = round1_(pick_(b, 'average_breath'));
    row.tst = minutesFromSeconds_(pick_(b, 'total_sleep_duration'));
    row.tib = minutesFromSeconds_(pick_(b, 'time_in_bed'));
    row.deep = minutesFromSeconds_(pick_(b, 'deep_sleep_duration'));
    row.rem = minutesFromSeconds_(pick_(b, 'rem_sleep_duration'));
    row.light = minutesFromSeconds_(pick_(b, 'light_sleep_duration'));
    row.eff = pick_(b, 'efficiency');
    row.restless = pick_(b, 'restless_periods');
    row.bstart = b.bedtime_start ? b.bedtime_start.substr(11, 5) : '';
    row.bend = b.bedtime_end ? b.bedtime_end.substr(11, 5) : '';
  }

  writeOuraRow_(row);
}
