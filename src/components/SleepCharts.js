/**
 * SleepCharts.js
 * High-performance, rich clinical visualizations for EinsDream:
 * - Circular Dials / Ring Gauges (Duration, Deep Sleep %, Irregularity, Efficiency, Acoustic Peace)
 * - Multi-dimensional Rest Balance Chart (6+ dimensions) — FIXED for React Native
 * - Layered Hypnogram Stages (Awake, REM, Light, Deep) — FIXED bar rendering
 * - Actigraphy Nocturnal Activity Waveform — FIXED heights
 * - Cardiovascular HR & HRV Recovery Graph — FIXED curve rendering
 * - Star Rating Display (1-5 stars)
 *
 * iOS & Android compatible — no percentage-string widths on flex children.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// ─── 1. Circular Progress Dial (Sleep as Android Style) ─────────────────────────
export function CircularDial({
    value = '0:00',
    subValue = '+0:00',
    subPositive = true,
    label = 'Duración',
    percentage = 80,
    color = '#10b981',
    size = 96,
    icon = '⏱️'
}) {
    const pct = Math.max(0, Math.min(100, percentage));
    const strokeW = 5;
    const inner = size - strokeW * 2;

    return (
        <View style={[styles.dialContainer, { width: size, height: size + 34 }]}>
            {/* Outer track ring */}
            <View
                style={[
                    styles.dialTrack,
                    { width: size, height: size, borderRadius: size / 2, borderWidth: strokeW, borderColor: 'rgba(255,255,255,0.10)' }
                ]}
            >
                {/* Progress arc overlay */}
                <View
                    style={[
                        styles.dialArc,
                        {
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            borderWidth: strokeW,
                            borderTopColor: pct > 0 ? color : 'transparent',
                            borderRightColor: pct > 25 ? color : 'transparent',
                            borderBottomColor: pct > 50 ? color : 'transparent',
                            borderLeftColor: pct > 75 ? color : 'transparent',
                        }
                    ]}
                />
                {/* Inner content */}
                <View style={[styles.dialInner, { width: inner, height: inner, borderRadius: inner / 2 }]}>
                    <Text style={styles.dialIcon}>{icon}</Text>
                    <Text style={[styles.dialValue, { color: '#ffffff' }]}>{value}</Text>
                    {subValue ? (
                        <Text style={[styles.dialSubValue, { color: subPositive ? '#34d399' : '#f87171' }]}>
                            {subValue}
                        </Text>
                    ) : null}
                </View>
            </View>
            <Text style={styles.dialLabel} numberOfLines={2}>{label}</Text>
        </View>
    );
}

// ─── 2. Estrellas de Calificación (1 a 5 Estrellas) ───────────────────────────
export function StarRating({ rating = 4, maxStars = 5, size = 20 }) {
    const stars = [];
    for (let i = 1; i <= maxStars; i++) {
        const isFilled = i <= rating;
        stars.push(
            <Text key={i} style={{ fontSize: size, color: isFilled ? '#fbbf24' : '#334155', marginHorizontal: 2 }}>
                {isFilled ? '★' : '☆'}
            </Text>
        );
    }
    return <View style={styles.starRow}>{stars}</View>;
}

// ─── 3. Multi-Dimension Rest Balance — FIXED for React Native ─────────────────
// RN does NOT support percentage widths on flex children in dynamic-width containers.
// We use a two-View approach: fill + empty both use flex values.
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(v || 0))); }

export function DimensionsBalanceChart({ dimensions = {} }) {
    const dims = [
        { key: 'duration',       label: 'Duración',       icon: '⏱️', val: clamp(dimensions.duration       ?? 85), color: '#38bdf8' },
        { key: 'deepSleep',      label: 'Sueño Profundo', icon: '🌙', val: clamp(dimensions.deepSleep      ?? 78), color: '#818cf8' },
        { key: 'regularity',     label: 'Regularidad',    icon: '🔄', val: clamp(dimensions.regularity     ?? 92), color: '#34d399' },
        { key: 'efficiency',     label: 'Eficiencia',     icon: '🎯', val: clamp(dimensions.efficiency     ?? 90), color: '#a78bfa' },
        { key: 'cardioRecovery', label: 'Recuperación',   icon: '🫀', val: clamp(dimensions.cardioRecovery ?? 84), color: '#f43f5e' },
        { key: 'acousticPeace', label: 'Paz Acústica',   icon: '😴', val: clamp(dimensions.acousticPeace  ?? 88), color: '#fbbf24' },
        { key: 'remSleep',       label: 'Fase REM',       icon: '🧠', val: clamp(dimensions.remSleep       ?? 82), color: '#2dd4bf' },
    ];

    return (
        <View style={styles.dimCard}>
            <View style={styles.dimHeader}>
                <Text style={styles.dimTitle}>⚖️ Balance de las 7 Dimensiones del Descanso</Text>
                <Text style={styles.dimSubtitle}>Evaluación unificada del equilibrio corporal y circadiano</Text>
            </View>

            <View style={styles.dimList}>
                {dims.map((d) => (
                    <View key={d.key} style={styles.dimItem}>
                        <View style={styles.dimLabelRow}>
                            <Text style={styles.dimItemLabel}>{d.icon} {d.label}</Text>
                            <Text style={[styles.dimItemVal, { color: d.color }]}>{d.val}%</Text>
                        </View>
                        {/* flex-row track: fill + empty = 100 */}
                        <View style={styles.dimBarBg}>
                            <View style={{ flex: d.val, backgroundColor: d.color, height: '100%', borderRadius: 3 }} />
                            <View style={{ flex: 100 - d.val }} />
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

// ─── 4. Hypnogram Multi-fase — FIXED ─────────────────────────────────────────
// Percentage-string heights don't work on RN flex children. We compute pixel heights.
export function HypnogramChart({ sleepSummary = {}, sleepBreakdown = {} }) {
    const actual = sleepBreakdown.actualSleepMinutes || sleepSummary.durationMinutes || 460;
    const awake  = sleepBreakdown.awakeMinutes       || sleepSummary.awakeMinutes    || 35;
    const deep   = sleepBreakdown.deepSleepMinutes   || sleepSummary.deepSleepMinutes || 105;
    const rem    = sleepBreakdown.remSleepMinutes    || sleepSummary.remSleepMinutes  || 92;
    const light  = Math.max(0, actual - deep - rem);

    const total    = actual + awake || 1;
    const awakePct = Math.round((awake  / total) * 100);
    const remPct   = Math.round((rem    / total) * 100);
    const lightPct = Math.round((light  / total) * 100);
    const deepPct  = Math.round((deep   / total) * 100);

    const fmtMin = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

    // Fixed-height timeline: 52px total, bars bottom-aligned
    const CHART_H = 52;
    // Each segment [color, widthFlex, heightFrac]
    const segs = [
        { color: '#fb923c', flex: 1.5, hFrac: 0.28 },
        { color: '#10b981', flex: 2.5, hFrac: 1.00 },
        { color: '#c084fc', flex: 2.0, hFrac: 0.68 },
        { color: '#38bdf8', flex: 2.5, hFrac: 0.55 },
        { color: '#10b981', flex: 1.5, hFrac: 1.00 },
        { color: '#c084fc', flex: 2.0, hFrac: 0.68 },
        { color: '#fb923c', flex: 1.0, hFrac: 0.28 },
    ];

    const stageRows = [
        { label: 'Despierto', color: '#fb923c', pct: awakePct, mins: awake  },
        { label: 'REM',       color: '#c084fc', pct: remPct,   mins: rem    },
        { label: 'Ligero',    color: '#38bdf8', pct: lightPct, mins: light  },
        { label: 'Profundo',  color: '#10b981', pct: deepPct,  mins: deep   },
    ];

    return (
        <View style={styles.hypnoCard}>
            <View style={styles.hypnoHeader}>
                <Text style={styles.hypnoTitle}>🌊 Fases del Sueño (Hypnogram)</Text>
                <Text style={styles.hypnoSub}>Desglose de ciclos ultradianos</Text>
            </View>

            {/* Visual Bar Timeline — bottom-aligned with fixed pixel heights */}
            <View style={{ height: CHART_H + 8, backgroundColor: '#0f172a', borderRadius: 10, paddingHorizontal: 6, paddingBottom: 4, marginBottom: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
                {segs.map((seg, i) => (
                    <View
                        key={i}
                        style={{
                            flex: seg.flex,
                            height: Math.max(4, Math.round(CHART_H * seg.hFrac)),
                            backgroundColor: seg.color,
                            borderRadius: 3,
                            opacity: 0.85,
                        }}
                    />
                ))}
            </View>

            {/* Stage rows — flex-based bars */}
            <View style={styles.stagesList}>
                {stageRows.map((st) => (
                    <View key={st.label} style={styles.stageRow}>
                        <View style={styles.stageBadgeCol}>
                            <View style={[styles.stageDot, { backgroundColor: st.color }]} />
                            <Text style={styles.stageName}>{st.label}</Text>
                        </View>
                        <View style={styles.stageBarWrap}>
                            <View style={{ flex: Math.max(1, st.pct), backgroundColor: st.color, height: '100%', borderRadius: 3 }} />
                            <View style={{ flex: Math.max(1, 100 - st.pct) }} />
                        </View>
                        <Text style={styles.stageMetric}>{st.pct}% ({fmtMin(st.mins)})</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

// ─── 5. Actigrafía y Traza Acústica — FIXED heights ──────────────────────────
export function ActigraphyChart({ snoreCount = 0, coughCount = 0 }) {
    const CHART_H = 60;
    const peaks   = [8, 14, 25, 42, 18, 12, 55, 68, 32, 19, 10, 14, 62, 85, 45, 20, 15, 30, 48, 22, 12];
    const maxPeak = Math.max(...peaks);

    return (
        <View style={styles.actCard}>
            <View style={styles.actHeader}>
                <Text style={styles.actTitle}>📈 Actigrafía y Registro Acústico</Text>
                <Text style={styles.actSubtitle}>
                    {snoreCount} ronquidos · {coughCount} tos/sonidos
                </Text>
            </View>

            <View style={[styles.waveContainer, { height: CHART_H }]}>
                {peaks.map((h, i) => {
                    const barH = Math.max(2, Math.round((h / maxPeak) * (CHART_H - 8)));
                    return (
                        <View
                            key={i}
                            style={{
                                flex: 1,
                                height: barH,
                                backgroundColor: h > 60 ? '#f43f5e' : (h > 35 ? '#eab308' : '#10b981'),
                                borderRadius: 3,
                                opacity: 0.85,
                            }}
                        />
                    );
                })}
            </View>
            <View style={styles.waveFooter}>
                <Text style={styles.waveTime}>0:00</Text>
                <Text style={styles.waveTime}>2:00</Text>
                <Text style={styles.waveTime}>4:00</Text>
                <Text style={styles.waveTime}>6:00</Text>
                <Text style={styles.waveTime}>Despertar</Text>
            </View>
        </View>
    );
}

// ─── 6. Monitoreo Cardiovascular — FIXED HR curve ────────────────────────────
// Replaced broken absolute-position dots with proportional bottom-aligned bars.
export function CardioChart({ cardiovascular = {} }) {
    const avg      = cardiovascular.avgHeartRate  || 60;
    const min      = cardiovascular.minHeartRate  || 51;
    const max      = cardiovascular.maxHeartRate  || 76;
    const hrv      = cardiovascular.hrvSdann      || 68;
    const gain     = cardiovascular.hrvGain !== undefined ? cardiovascular.hrvGain : 22;
    const recovery = cardiovascular.recoveryLevel || 'Excelente';

    const CHART_H = 60;
    const points  = [64, 61, 58, 54, 52, 51, 53, 56, 54, 52, 55, 59, 63];
    const minP    = Math.min(...points);
    const maxP    = Math.max(...points);
    const range   = (maxP - minP) || 1;

    return (
        <View style={styles.cardioCard}>
            <View style={styles.cardioHeader}>
                <View>
                    <Text style={styles.cardioTitle}>🫀 Monitoreo Cardiovascular & HRV</Text>
                    <Text style={styles.cardioSubtitle}>Recuperación parasimpática y autónoma</Text>
                </View>
                <View style={[styles.recBadge, { backgroundColor: gain >= 15 ? '#064e3b' : '#78350f' }]}>
                    <Text style={[styles.recBadgeText, { color: gain >= 15 ? '#34d399' : '#fbbf24' }]}>
                        {recovery}
                    </Text>
                </View>
            </View>

            {/* Metrics Row */}
            <View style={styles.cardioMetricsRow}>
                <View style={styles.cardioMetricBox}>
                    <Text style={styles.cMetricVal}>{avg} <Text style={styles.cMetricUnit}>bpm</Text></Text>
                    <Text style={styles.cMetricLabel}>FC Media</Text>
                </View>
                <View style={styles.cardioMetricBox}>
                    <Text style={styles.cMetricVal}>{min} – {max} <Text style={styles.cMetricUnit}>bpm</Text></Text>
                    <Text style={styles.cMetricLabel}>Mín – Máx</Text>
                </View>
                <View style={styles.cardioMetricBox}>
                    <Text style={styles.cMetricVal}>{hrv} <Text style={styles.cMetricUnit}>ms</Text></Text>
                    <Text style={styles.cMetricLabel}>HRV (SDANN)</Text>
                </View>
                <View style={styles.cardioMetricBox}>
                    <Text style={[styles.cMetricVal, { color: gain >= 0 ? '#34d399' : '#f87171' }]}>
                        {gain >= 0 ? `+${gain}%` : `${gain}%`}
                    </Text>
                    <Text style={styles.cMetricLabel}>HRV Gain</Text>
                </View>
            </View>

            {/* HR Curve — proportional bottom-aligned bars */}
            <View style={[styles.hrCurveContainer, { height: CHART_H }]}>
                {points.map((p, idx) => {
                    const barH = Math.max(4, Math.round(((p - minP) / range) * (CHART_H - 10)) + 5);
                    return (
                        <View key={idx} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: CHART_H }}>
                            <View style={{ width: 6, height: barH, backgroundColor: '#f43f5e', borderRadius: 3, opacity: 0.85 }} />
                            {idx % 4 === 0 && (
                                <Text style={styles.hrBarLabel}>{p}</Text>
                            )}
                        </View>
                    );
                })}
            </View>
            <Text style={styles.cardioFootnote}>
                Ganancia de HRV al despertar (+{gain}%): indica transición autonómica favorable y recuperación física del sistema nervioso.
            </Text>
        </View>
    );
}

// ─── 7. Tarjeta Resumen de los 3 Pilares de Salud ─────────────────────────────
export function ThreePillarsCard({ scoreData = {} }) {
    const total      = scoreData.totalScore      || 85;
    const regularity = scoreData.regularityScore || 90;
    const duration   = scoreData.durationScore   || 82;
    const quality    = scoreData.qualityScore    || 84;
    const stars      = scoreData.ratingStars     || 4;

    const scoreColor = total >= 85 ? '#34d399' : total >= 70 ? '#fbbf24' : '#f87171';

    return (
        <View style={styles.pillarsCard}>
            <View style={styles.scoreRow}>
                <View style={[styles.scoreBadge, { borderColor: scoreColor, borderWidth: 2 }]}>
                    <Text style={[styles.scoreBig, { color: scoreColor }]}>{total}</Text>
                    <Text style={[styles.scoreScale, { color: scoreColor + 'cc' }]}>/100</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.scoreTitle}>Einsdream Score</Text>
                    <Text style={styles.scoreSubtitle}>
                        {total >= 85 ? 'Óptima recuperación biológica' : total >= 70 ? 'Recuperación moderada' : 'Descanso deficiente'}
                    </Text>
                    <StarRating rating={stars} size={18} />
                </View>
            </View>

            {/* 3 Pillars Breakdown */}
            <View style={styles.pillarsContainer}>
                {[{ label: 'Regularidad', icon: '🔄', val: regularity, color: '#34d399', weight: '40% (Prioridad)' },
                  { label: 'Duración',   icon: '⏱️', val: duration,   color: '#38bdf8', weight: '30%' },
                  { label: 'Calidad',    icon: '⭐', val: quality,    color: '#fbbf24', weight: '30%' },
                ].map((p) => (
                    <View key={p.label} style={styles.pillarBox}>
                        <View style={styles.pillarHead}>
                            <Text style={styles.pillarIcon}>{p.icon}</Text>
                            <Text style={styles.pillarName}>{p.label}</Text>
                        </View>
                        <Text style={[styles.pillarScore, { color: p.color }]}>{p.val}%</Text>
                        <Text style={styles.pillarWeight}>Ponderación {p.weight}</Text>
                        {/* flex-based mini progress bar */}
                        <View style={styles.pillarBarBg}>
                            <View style={{ flex: p.val, backgroundColor: p.color, height: '100%', borderRadius: 2 }} />
                            <View style={{ flex: 100 - p.val }} />
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

// ─── Estilos de los Componentes ───────────────────────────────────────────────
const styles = StyleSheet.create({
    dialContainer: {
        alignItems: 'center',
        marginHorizontal: 5,
    },
    dialTrack: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0f172a',
        position: 'relative',
    },
    dialArc: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    dialInner: {
        backgroundColor: '#0f172a',
        alignItems: 'center',
        justifyContent: 'center',
    },
    dialIcon: {
        fontSize: 11,
        marginBottom: 1,
    },
    dialValue: {
        fontSize: 14,
        fontWeight: '900',
        letterSpacing: 0.2,
    },
    dialSubValue: {
        fontSize: 9,
        fontWeight: '700',
        marginTop: 1,
    },
    dialLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#94a3b8',
        marginTop: 5,
        textAlign: 'center',
        maxWidth: 84,
    },

    starRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },

    dimCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    dimHeader: {
        marginBottom: 12,
    },
    dimTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#f8fafc',
    },
    dimSubtitle: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    dimList: {
        marginTop: 4,
    },
    dimItem: {
        marginBottom: 10,
    },
    dimLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    dimItemLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#cbd5e1',
    },
    dimItemVal: {
        fontSize: 12,
        fontWeight: '800',
    },
    dimBarBg: {
        height: 7,
        backgroundColor: '#334155',
        borderRadius: 4,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    dimBarFill: {
        height: '100%',
        borderRadius: 3,
    },

    hypnoCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    hypnoHeader: {
        marginBottom: 14,
    },
    hypnoTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#f8fafc',
    },
    hypnoSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    timelineContainer: {
        height: 75,
        backgroundColor: '#0f172a',
        borderRadius: 10,
        padding: 6,
        position: 'relative',
        marginBottom: 14,
        justifyContent: 'flex-end',
    },
    timelineBarStack: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        height: '100%',
        width: '100%',
        gap: 3,
    },
    timelineSlice: {
        borderRadius: 3,
    },
    timelineStageLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    stageAxisText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#64748b',
    },
    stagesList: {
        marginTop: 6,
    },
    stageRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    stageBadgeCol: {
        flexDirection: 'row',
        alignItems: 'center',
        width: 80,
    },
    stageDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    stageName: {
        fontSize: 11,
        color: '#cbd5e1',
        fontWeight: '700',
    },
    stageBarWrap: {
        flex: 1,
        height: 7,
        backgroundColor: '#334155',
        borderRadius: 4,
        marginHorizontal: 10,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    stageBar: {
        height: '100%',
        borderRadius: 3,
    },
    stageMetric: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94a3b8',
        width: 100,
        textAlign: 'right',
    },

    actCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    actHeader: {
        marginBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    actTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#f8fafc',
    },
    actSubtitle: {
        fontSize: 11,
        color: '#34d399',
        fontWeight: '700',
    },
    waveContainer: {
        backgroundColor: '#0f172a',
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: 6,
        paddingBottom: 4,
        gap: 2,
    },
    waveBar: {
        width: 6,
        borderRadius: 3,
    },
    waveFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingHorizontal: 4,
    },
    waveTime: {
        fontSize: 9,
        color: '#64748b',
    },

    cardioCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    cardioHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    cardioTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#f8fafc',
    },
    cardioSubtitle: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    recBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    recBadgeText: {
        fontSize: 11,
        fontWeight: '800',
    },
    cardioMetricsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#0f172a',
        borderRadius: 12,
        padding: 10,
        marginBottom: 12,
    },
    cardioMetricBox: {
        alignItems: 'center',
    },
    cMetricVal: {
        fontSize: 14,
        fontWeight: '900',
        color: '#ffffff',
    },
    cMetricUnit: {
        fontSize: 10,
        color: '#94a3b8',
        fontWeight: '500',
    },
    cMetricLabel: {
        fontSize: 10,
        color: '#64748b',
        marginTop: 2,
    },
    hrCurveContainer: {
        backgroundColor: '#0f172a',
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: 4,
        paddingBottom: 4,
        marginBottom: 8,
        gap: 2,
    },
    hrBarLabel: {
        fontSize: 8,
        color: '#f87171',
        fontWeight: '700',
        marginTop: 2,
        textAlign: 'center',
    },
    cardioFootnote: {
        fontSize: 10,
        color: '#94a3b8',
        lineHeight: 14,
        fontStyle: 'italic',
    },

    pillarsCard: {
        backgroundColor: '#0f172a',
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1.5,
        borderColor: '#38bdf8',
    },
    scoreRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    scoreBadge: {
        width: 72,
        height: 72,
        borderRadius: 20,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    scoreBig: {
        fontSize: 28,
        fontWeight: '900',
        lineHeight: 32,
    },
    scoreScale: {
        fontSize: 10,
        fontWeight: '700',
    },
    scoreTitle: {
        fontSize: 17,
        fontWeight: '900',
        color: '#ffffff',
    },
    scoreSubtitle: {
        fontSize: 12,
        color: '#94a3b8',
        marginTop: 1,
    },
    pillarsContainer: {
        flexDirection: 'row',
        gap: 8,
    },
    pillarBox: {
        flex: 1,
        backgroundColor: '#1e293b',
        borderRadius: 12,
        padding: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155',
    },
    pillarHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 4,
    },
    pillarIcon: {
        fontSize: 12,
    },
    pillarName: {
        fontSize: 11,
        fontWeight: '700',
        color: '#cbd5e1',
    },
    pillarScore: {
        fontSize: 18,
        fontWeight: '900',
        marginVertical: 2,
    },
    pillarWeight: {
        fontSize: 8,
        color: '#64748b',
        textAlign: 'center',
        marginBottom: 4,
    },
    pillarBarBg: {
        height: 4,
        backgroundColor: '#334155',
        borderRadius: 2,
        overflow: 'hidden',
        flexDirection: 'row',
        width: '100%',
        marginTop: 2,
    },
});
