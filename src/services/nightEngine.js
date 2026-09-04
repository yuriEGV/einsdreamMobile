/**
 * nightEngine.js
 * The core correlation engine for EinsDream.
 * Correlates nocturnal acoustic events with Google Health Connect physiological data
 * (Heart Rate, Respiratory Rate, Oxygen Saturation, and Sleep Stages).
 * Adheres strictly to non-diagnostic, descriptive clinical classifications.
 */

/**
 * Correlates a list of audio events with continuous health metric series.
 * @param {Object} params
 * @param {Array} params.audioEvents - [{ timestamp, duration, eventType, intensityDb, audioUrl, id }]
 * @param {Object} params.healthData - { heartRateSeries, respiratoryRateSeries, oxygenSaturationSeries, sleepSummary }
 * @param {Object} params.sessionWindow - { startTime, endTime, sessionDate }
 * @returns {Object} Full correlated Night Session payload for MongoDB sync
 */
export function processNightEngineCorrelation({ audioEvents = [], healthData = {}, sessionWindow = {} }) {
    const { startTime, endTime, sessionDate } = sessionWindow;
    const {
        heartRateSeries = [],
        respiratoryRateSeries = [],
        oxygenSaturationSeries = [],
        sleepSummary = {}
    } = healthData;

    const correlatedEvents = [];

    for (const audioEvent of audioEvents) {
        const eventTime = new Date(audioEvent.timestamp || audioEvent.detectedAt || Date.now()).getTime();
        const windowMs = 60 * 1000; // 60 seconds correlation window

        // 1. Correlate Heart Rate samples within [T - 60s, T + 60s]
        const nearbyHr = heartRateSeries.filter(h => {
            const t = new Date(h.timestamp).getTime();
            return Math.abs(t - eventTime) <= windowMs;
        });

        let hrBaseline = null;
        let hrPeak = null;
        let hrDelta = 0;

        if (nearbyHr.length > 0) {
            const hrBefore = nearbyHr.filter(h => new Date(h.timestamp).getTime() <= eventTime);
            const hrAfter = nearbyHr.filter(h => new Date(h.timestamp).getTime() >= eventTime);

            hrBaseline = hrBefore.length > 0
                ? Math.round(hrBefore.reduce((acc, h) => acc + h.bpm, 0) / hrBefore.length)
                : nearbyHr[0].bpm;

            hrPeak = hrAfter.length > 0
                ? Math.max(...hrAfter.map(h => h.bpm))
                : nearbyHr[nearbyHr.length - 1].bpm;

            hrDelta = hrPeak - hrBaseline;
        }

        // 2. Correlate Respiratory Rate
        const nearbyResp = respiratoryRateSeries.filter(r => {
            const t = new Date(r.timestamp).getTime();
            return Math.abs(t - eventTime) <= windowMs;
        });

        let respBaseline = null;
        let respPeak = null;
        if (nearbyResp.length > 0) {
            respBaseline = nearbyResp[0].rpm;
            respPeak = Math.max(...nearbyResp.map(r => r.rpm));
        }

        // 3. Correlate SpO2
        const nearbySpO2 = oxygenSaturationSeries.find(s => {
            const t = new Date(s.timestamp).getTime();
            return Math.abs(t - eventTime) <= windowMs * 2;
        });
        const oxygenSaturation = nearbySpO2 ? nearbySpO2.percentage : null;

        // 4. Identify Sleep Stage at time T
        let sleepStage = 'unknown';
        if (sleepSummary.stages && sleepSummary.stages.length > 0) {
            const activeStage = sleepSummary.stages.find(s => {
                const sStart = new Date(s.startTime).getTime();
                const sEnd = new Date(s.endTime).getTime();
                return eventTime >= sStart && eventTime <= sEnd;
            });
            if (activeStage) {
                sleepStage = activeStage.stage;
            }
        }

        // 5. Generate descriptive, non-diagnostic clinical label
        let correlationLabel = 'Evento acústico nocturno';
        let notes = '';

        if (hrDelta >= 8 && audioEvent.eventType === 'snore') {
            correlationLabel = 'Aceleración cardíaca transitoria asociada a ronquido';
            notes = `Aumento de ${hrBaseline} a ${hrPeak} bpm (+${hrDelta} bpm) durante evento sonoro.`;
        } else if (hrDelta >= 10) {
            correlationLabel = 'Elevación de pulso coincidente con sonido nocturno';
            notes = `Frecuencia cardíaca subió a ${hrPeak} bpm coincidentemente con el audio.`;
        } else if (audioEvent.eventType === 'snore') {
            correlationLabel = 'Evento de ronquido con parámetros estables';
            notes = `Pulso estable (~${hrBaseline || 60} bpm) en fase de sueño ${sleepStage}.`;
        } else if (audioEvent.eventType === 'cough') {
            correlationLabel = 'Evento de tos nocturna';
            notes = `Tos registrada en fase ${sleepStage}. SpO2: ${oxygenSaturation ? oxygenSaturation + '%' : 'estable'}.`;
        } else {
            correlationLabel = 'Sonido ambiental nocturno en reposo';
            notes = `Duración ${audioEvent.duration || 5}s, intensidad ${audioEvent.intensityDb || 55} dB.`;
        }

        correlatedEvents.push({
            timestamp: new Date(eventTime),
            duration: audioEvent.duration || 5,
            audioUrl: audioEvent.audioUrl || null,
            audioSessionId: audioEvent.id || null,
            eventType: audioEvent.eventType || 'unknown',
            intensityDb: audioEvent.intensityDb || 55,
            hrBaseline,
            hrPeak,
            hrDelta,
            respBaseline,
            respPeak,
            oxygenSaturation,
            sleepStage,
            correlationLabel,
            notes
        });
    }

    // 6. Summary metrics
    const hrValues = heartRateSeries.map(h => h.bpm).filter(Boolean);
    const avgHr = hrValues.length > 0 ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null;
    const minHr = hrValues.length > 0 ? Math.min(...hrValues) : null;
    const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null;

    const respValues = respiratoryRateSeries.map(r => r.rpm).filter(Boolean);
    const avgResp = respValues.length > 0 ? Number((respValues.reduce((a, b) => a + b, 0) / respValues.length).toFixed(1)) : null;

    const spo2Values = oxygenSaturationSeries.map(s => s.percentage).filter(Boolean);
    const avgSpO2 = spo2Values.length > 0 ? Number((spo2Values.reduce((a, b) => a + b, 0) / spo2Values.length).toFixed(1)) : null;

    return {
        sessionDate: sessionDate || new Date().toISOString().slice(0, 10),
        startTime: new Date(startTime || Date.now() - 8 * 3600 * 1000),
        endTime: new Date(endTime || Date.now()),
        healthSource: heartRateSeries.length > 0 ? 'health_connect' : 'standalone_acoustic',
        sleepSummary,
        heartRateSeries,
        respiratoryRateSeries,
        oxygenSaturationSeries,
        correlatedEvents,
        nightSummary: {
            avgHeartRate: avgHr,
            minHeartRate: minHr,
            maxHeartRate: maxHr,
            avgRespiratoryRate: avgResp,
            avgOxygenSaturation: avgSpO2,
            totalAudioEvents: correlatedEvents.length,
            totalSnoreEvents: correlatedEvents.filter(e => e.eventType === 'snore').length,
            totalCoughEvents: correlatedEvents.filter(e => e.eventType === 'cough').length,
            evaluationNote: correlatedEvents.length === 0
                ? 'Noche tranquila sin perturbaciones acústicas relevantes detectadas.'
                : (heartRateSeries.length > 0
                    ? `Se registraron ${correlatedEvents.length} eventos acústicos nocturnos correlacionados con Health Connect.`
                    : `Modo Autónomo Acústico: Se registraron ${correlatedEvents.length} eventos de audio nocturnos por micrófono.`)
        }
    };
}
