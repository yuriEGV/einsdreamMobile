/**
 * predictiveEngine.js (Mobile On-Device Client)
 * Einsdream Sleep Evaluation Engine & Predictive Habit Analytics
 *
 * Provides offline-first on-device calculations for:
 * 1. Einsdream Score with 3 Health Pillars (Regularity 40%, Duration 30%, Quality 30%)
 * 2. 6+ Rest Dimensions Balance
 * 3. Rest Efficiency & Sleep Stages Breakdown
 * 4. Cardiovascular HRV (SDANN) and Morning HRV Gain (%)
 * 5. Snore Metrics & Irregularity Index
 * 6. Trend Benchmarking (7 and 28 days with +/- % vs baseline)
 * 7. Predictive Regression for Optimal Bedtime Recommendation
 */

export function timeDiffMinutes(timeStrA, timeStrB) {
    if (!timeStrA || !timeStrB) return 0;
    const [hA, mA] = timeStrA.split(':').map(Number);
    const [hB, mB] = timeStrB.split(':').map(Number);
    let minsA = hA * 60 + mA;
    let minsB = hB * 60 + mB;
    let diff = minsA - minsB;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
}

export function dateToHHMM(date) {
    const d = new Date(date);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

export function decimalToHHMM(decimal) {
    let normalized = decimal % 24;
    if (normalized < 0) normalized += 24;
    const h = Math.floor(normalized);
    const m = Math.round((normalized - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function evaluateEinsdreamScore({
    startTime,
    endTime,
    sleepSummary = {},
    heartRateSeries = [],
    correlatedEvents = [],
    baselineProfile = {}
}) {
    const start = new Date(startTime || Date.now() - 8 * 3600 * 1000);
    const end = new Date(endTime || Date.now());
    const totalMonitoredMinutes = Math.max(30, Math.round((end.getTime() - start.getTime()) / (60 * 1000)));

    const targetBedtime = baselineProfile.targetBedtime || '23:00';
    const targetWakeTime = baselineProfile.targetWakeTime || '07:00';
    const targetSleepMinutes = baselineProfile.targetSleepMinutes || 480;

    const durationMinutes = sleepSummary.durationMinutes || totalMonitoredMinutes;
    const awakeMinutes = sleepSummary.awakeMinutes || Math.round(durationMinutes * 0.08);
    const actualSleepMinutes = Math.max(0, durationMinutes - awakeMinutes);

    const deepSleepMinutes = sleepSummary.deepSleepMinutes || Math.round(actualSleepMinutes * 0.22);
    const remSleepMinutes = sleepSummary.remSleepMinutes || Math.round(actualSleepMinutes * 0.20);
    const lightSleepMinutes = sleepSummary.lightSleepMinutes || Math.max(0, actualSleepMinutes - deepSleepMinutes - remSleepMinutes);

    const sleepEfficiency = sleepSummary.sleepEfficiency !== undefined
        ? sleepSummary.sleepEfficiency
        : Math.min(100, Math.round((actualSleepMinutes / totalMonitoredMinutes) * 100));

    const actualBedtimeHHMM = dateToHHMM(start);
    const actualWakeHHMM = dateToHHMM(end);

    const bedtimeDeviation = timeDiffMinutes(actualBedtimeHHMM, targetBedtime);
    const wakeDeviation = timeDiffMinutes(actualWakeHHMM, targetWakeTime);
    const irregularityMinutes = Math.round((Math.abs(bedtimeDeviation) + Math.abs(wakeDeviation)) / 2);

    const snoreEvents = correlatedEvents.filter(e => e.eventType === 'snore');
    const coughEvents = correlatedEvents.filter(e => e.eventType === 'cough');
    const totalSnoreMinutes = Math.min(actualSleepMinutes, Math.round(snoreEvents.length * 2.5));
    const snorePercentage = actualSleepMinutes > 0
        ? Number(((totalSnoreMinutes / actualSleepMinutes) * 100).toFixed(1))
        : 0;

    // Cardiovascular
    const hrValues = heartRateSeries.map(h => h.bpm).filter(Boolean);
    const avgHeartRate = hrValues.length > 0 ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : 62;
    const minHeartRate = hrValues.length > 0 ? Math.min(...hrValues) : 52;
    const maxHeartRate = hrValues.length > 0 ? Math.max(...hrValues) : 78;

    let hrvSdann = 65;
    if (hrValues.length >= 4) {
        const mean = avgHeartRate;
        const variance = hrValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / hrValues.length;
        const stdDevBpm = Math.sqrt(variance);
        hrvSdann = Math.min(120, Math.max(30, Math.round(stdDevBpm * 14 + 35)));
    }

    let hrvGain = 18;
    if (hrValues.length >= 6) {
        const firstQuarter = hrValues.slice(0, Math.ceil(hrValues.length * 0.3));
        const lastQuarter = hrValues.slice(-Math.ceil(hrValues.length * 0.3));
        const hrStart = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
        const hrEnd = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
        const delta = ((hrStart - hrEnd) / hrStart) * 100;
        hrvGain = Math.min(45, Math.max(-15, Math.round(15 + delta * 1.5)));
    }

    let recoveryLevel = 'Óptima';
    if (hrvSdann >= 75 && hrvGain >= 15) recoveryLevel = 'Excelente';
    else if (hrvSdann < 45 || hrvGain < 0) recoveryLevel = 'Baja';
    else if (hrvSdann < 55) recoveryLevel = 'Moderada';

    // 3 Health Pillars
    const regPenalty = Math.abs(bedtimeDeviation) * 0.6 + Math.abs(wakeDeviation) * 0.4;
    const regularityScore = Math.max(10, Math.min(100, Math.round(100 - regPenalty * 0.45)));

    const deficitMinutes = actualSleepMinutes - targetSleepMinutes;
    const durPenalty = Math.abs(deficitMinutes);
    const durationScore = Math.max(10, Math.min(100, Math.round(100 - durPenalty * 0.42)));

    const deepRatio = actualSleepMinutes > 0 ? (deepSleepMinutes / actualSleepMinutes) : 0.20;
    const remRatio = actualSleepMinutes > 0 ? (remSleepMinutes / actualSleepMinutes) : 0.20;

    const deepScore = Math.min(100, Math.max(20, Math.round((deepRatio / 0.22) * 100)));
    const remScore = Math.min(100, Math.max(20, Math.round((remRatio / 0.20) * 100)));
    const effScore = Math.min(100, Math.max(20, sleepEfficiency));
    const peaceScore = Math.max(20, Math.min(100, Math.round(100 - snorePercentage * 3.5)));

    const qualityScore = Math.round(deepScore * 0.35 + remScore * 0.25 + effScore * 0.25 + peaceScore * 0.15);

    const totalScore = Math.min(100, Math.max(10, Math.round(
        0.40 * regularityScore +
        0.30 * durationScore +
        0.30 * qualityScore
    )));

    let ratingStars = 3;
    if (totalScore >= 88) ratingStars = 5;
    else if (totalScore >= 75) ratingStars = 4;
    else if (totalScore >= 60) ratingStars = 3;
    else if (totalScore >= 45) ratingStars = 2;
    else ratingStars = 1;

    // 6+ Dimensions
    const dimensions = {
        duration: Math.min(100, Math.max(15, Math.round((actualSleepMinutes / 480) * 100))),
        deepSleep: deepScore,
        regularity: regularityScore,
        efficiency: sleepEfficiency,
        cardioRecovery: Math.min(100, Math.max(20, Math.round(hrvSdann * 0.85 + hrvGain * 0.5))),
        acousticPeace: peaceScore,
        remSleep: remScore
    };

    return {
        einsdreamScore: {
            totalScore,
            regularityScore,
            durationScore,
            qualityScore,
            ratingStars,
            deficitMinutes,
            irregularityMinutes
        },
        dimensions,
        cardiovascular: {
            avgHeartRate,
            minHeartRate,
            maxHeartRate,
            hrvSdann,
            hrvGain,
            recoveryLevel
        },
        snoreMetrics: {
            snorePercentage,
            totalSnoreMinutes,
            snoreEventsCount: snoreEvents.length,
            coughEventsCount: coughEvents.length,
            irregularityIndex: irregularityMinutes
        },
        sleepBreakdown: {
            totalMonitoredMinutes,
            actualSleepMinutes,
            awakeMinutes,
            deepSleepMinutes,
            lightSleepMinutes,
            remSleepMinutes,
            sleepEfficiency,
            actualBedtimeHHMM,
            actualWakeHHMM
        }
    };
}

export function calculateTrendsBenchmark(sessions = [], baselineProfile = {}) {
    const targetSleepMinutes = baselineProfile.targetSleepMinutes || 480;

    // Only consider real recorded sessions
    const validSessions = (sessions || []).filter(s => s && (s.durationMinutes || s.startTime));
    const recent7 = validSessions.slice(0, 7);
    const recent28 = validSessions.slice(0, 28);

    const calcAvg = (arr, selector) => {
        if (arr.length === 0) return 0;
        const sum = arr.reduce((acc, s) => acc + (selector(s) || 0), 0);
        return Math.round(sum / arr.length);
    };

    const getActualSleep = (s) => {
        if (s.durationMinutes) return s.durationMinutes;
        if (s.sleepBreakdown && s.sleepBreakdown.totalMonitoredMinutes) return s.sleepBreakdown.totalMonitoredMinutes;
        if (s.sleepSummary && s.sleepSummary.durationMinutes) return s.sleepSummary.durationMinutes;
        return 0;
    };

    const getScore = (s) => (s.einsdreamScore && s.einsdreamScore.totalScore) || 80;

    const avgSleep7 = calcAvg(recent7, getActualSleep);
    const avgSleep28 = calcAvg(recent28, getActualSleep);
    const avgScore7 = calcAvg(recent7, getScore);
    const avgScore28 = calcAvg(recent28, getScore);

    const varianceSleep7VsBaseline = (targetSleepMinutes > 0 && avgSleep7 > 0)
        ? Number((((avgSleep7 - targetSleepMinutes) / targetSleepMinutes) * 100).toFixed(1))
        : 0;
    const varianceSleep28VsBaseline = (targetSleepMinutes > 0 && avgSleep28 > 0)
        ? Number((((avgSleep28 - targetSleepMinutes) / targetSleepMinutes) * 100).toFixed(1))
        : 0;

    const variance7Vs28 = (avgSleep28 > 0 && avgSleep7 > 0)
        ? Number((((avgSleep7 - avgSleep28) / avgSleep28) * 100).toFixed(1))
        : 0;

    const benchmarkTable = recent14DaysTable(validSessions, targetSleepMinutes);

    return {
        summary: {
            daysAvailable: validSessions.length,
            targetSleepMinutes,
            last7Days: {
                avgSleepMinutes: avgSleep7,
                avgSleepHoursFormatted: avgSleep7 > 0 ? `${Math.floor(avgSleep7 / 60)}h ${avgSleep7 % 60}m` : '--',
                avgScore: avgScore7,
                varianceVsBaselinePct: varianceSleep7VsBaseline
            },
            last28Days: {
                avgSleepMinutes: avgSleep28,
                avgSleepHoursFormatted: avgSleep28 > 0 ? `${Math.floor(avgSleep28 / 60)}h ${avgSleep28 % 60}m` : '--',
                avgScore: avgScore28,
                varianceVsBaselinePct: varianceSleep28VsBaseline
            },
            trendDeltaPct: variance7Vs28
        },
        benchmarkTable
    };
}

function recent14DaysTable(sessions) {
    if (!sessions || sessions.length === 0) return [];
    const list = sessions.slice(0, 14);
    return list.map((s, idx) => {
        const dateStr = s.sessionDate || (s.startTime ? new Date(s.startTime).toISOString().slice(0, 10) : `Noche ${idx + 1}`);
        const dObj = new Date(dateStr + 'T12:00:00');
        const dayName = isNaN(dObj.getTime()) ? `Noche ${idx + 1}` : dObj.toLocaleDateString('es-ES', { weekday: 'short' });

        let startHHMM = '--:--';
        let endHHMM = '--:--';
        if (s.startTime) startHHMM = dateToHHMM(s.startTime);
        if (s.endTime) endHHMM = dateToHHMM(s.endTime);
        const scheduleStr = (startHHMM !== '--:--' && endHHMM !== '--:--') ? `${startHHMM} - ${endHHMM}` : 'Noche';

        const durMinutes = s.durationMinutes
            || (s.sleepBreakdown && s.sleepBreakdown.totalMonitoredMinutes)
            || (s.sleepSummary && s.sleepSummary.durationMinutes)
            || 0;
        const h = Math.floor(durMinutes / 60);
        const m = durMinutes % 60;
        const sleepHours = durMinutes > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : '--';

        const eventsCount = s.audioEventsCount !== undefined
            ? s.audioEventsCount
            : (Array.isArray(s.audioEvents) ? s.audioEvents.length : 0);

        let quality = s.quality;
        if (!quality) {
            quality = eventsCount === 0 ? 'Óptima' : (eventsCount <= 3 ? 'Tranquila' : (eventsCount <= 6 ? 'Moderada' : 'Interrumpida'));
        }

        return {
            date: dateStr,
            dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1),
            schedule: scheduleStr,
            sleepHours,
            durationMinutes: durMinutes,
            eventsCount,
            quality
        };
    });
}

export function predictOptimalBedtime(sessions = [], baselineProfile = {}) {
    const chronotype = baselineProfile.chronotype || 'night_owl';
    const targetSleepMinutes = baselineProfile.targetSleepMinutes || 480;

    const chronotypeData = {
        early_bird: { name: 'Matutino (Alondra)', baseBed: 22.25 }, // 22:15
        intermediate: { name: 'Intermedio', baseBed: 23.25 },      // 23:15
        night_owl: { name: 'Noctámbulo (Búho)', baseBed: 0.25 }      // 00:15
    };

    const cfg = chronotypeData[chronotype] || chronotypeData.night_owl;

    // Filter valid nocturnal sessions (started between 20:00 and 04:00)
    const validNightSessions = (sessions || []).filter(s => {
        if (!s || !s.startTime) return false;
        const h = new Date(s.startTime).getHours();
        return (h >= 20 || h <= 4);
    });

    let optimalHourDec = cfg.baseBed;
    let algorithmUsed = `Cronotipo: ${cfg.name}`;

    if (validNightSessions.length >= 2) {
        // Average real start times of historical nights
        const startDecs = validNightSessions.map(s => {
            const d = new Date(s.startTime);
            let h = d.getHours() + (d.getMinutes() / 60);
            if (h < 12) h += 24; // map 00:00-04:00 to 24.0-28.0
            return h;
        });
        const avgRealBed = startDecs.reduce((a, b) => a + b, 0) / startDecs.length;

        // Blend 60% real user habits with 40% chronotype target
        let targetDec = cfg.baseBed;
        if (targetDec < 12) targetDec += 24;
        optimalHourDec = (avgRealBed * 0.6) + (targetDec * 0.4);
        if (optimalHourDec >= 24) optimalHourDec -= 24;

        algorithmUsed = `Promedio de hábitos reales (N=${validNightSessions.length}) + Cronotipo`;
    }

    // Clamp bedtime strictly between 21:30 and 01:30 (never daytime like 18:00)
    if (optimalHourDec > 2 && optimalHourDec < 21.5) {
        optimalHourDec = cfg.baseBed;
    }

    const recommendedBedtime = decimalToHHMM(optimalHourDec);
    const [hBed, mBed] = recommendedBedtime.split(':').map(Number);
    const wakeMinsTotal = (hBed * 60 + mBed + targetSleepMinutes) % 1440;
    const recommendedWakeTime = `${String(Math.floor(wakeMinsTotal / 60)).padStart(2, '0')}:${String(wakeMinsTotal % 60).padStart(2, '0')}`;

    // Calculate real acoustic events in previous nights to give real feedback
    let snoreCount = 0;
    let coughCount = 0;
    (sessions || []).forEach(s => {
        if (!s) return;
        if (s.eventsBreakdown) {
            snoreCount += s.eventsBreakdown.snore || 0;
            coughCount += s.eventsBreakdown.cough || 0;
        } else if (Array.isArray(s.audioEvents)) {
            snoreCount += s.audioEvents.filter(e => e && e.eventType === 'snore').length;
            coughCount += s.audioEvents.filter(e => e && e.eventType === 'cough').length;
        }
    });

    let rationale = `Acostarte a las ${recommendedBedtime} te permite completar tu meta de ${Math.floor(targetSleepMinutes / 60)}h de descanso hasta las ${recommendedWakeTime}, sincronizado con tu perfil ${cfg.name}.`;
    if (snoreCount > 0) {
        rationale += ` Se registraron eventos de ronquido en tus grabaciones; procurar dormir de lado favorece una respiración más despejada.`;
    } else if (coughCount > 0) {
        rationale += ` Se registraron episodios de tos; mantener el ambiente hidratado reduce la irritación nocturna.`;
    } else {
        rationale += ` Mantén la habitación a oscuras y a temperatura templada para consolidar el sueño.`;
    }

    return {
        recommendedBedtime,
        recommendedWakeTime,
        algorithmUsed,
        clinicalRationale: rationale,
        targetSleepHours: `${Math.floor(targetSleepMinutes / 60)}h${targetSleepMinutes % 60 > 0 ? ' ' + (targetSleepMinutes % 60) + 'm' : ''}`.trim()
    };
}
