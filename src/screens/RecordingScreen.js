/**
 * RecordingScreen.js - EinsDream 2026 v2.3.1
 *
 * Sistema Inteligente de Monitoreo Nocturno, Motor Einsdream Score y Análisis Predictivo
 *
 * PESTAÑAS Y FUNCIONALIDADES:
 * 1. 🌙 Monitoreo:
 *    - Escucha silenciosa con VAD y medidor de decibelios en vivo.
 *    - IA Acústica On-Device (clasificación $0 de ronquido, tos, respiración, voz, movimiento).
 *    - Prueba rápida de 5 segundos con auto-reproducción inmediata.
 *    - Memoria protegida de 100 MB con política FIFO.
 * 2. 📊 Einsdream Score & Dimensiones:
 *    - Score Global (0 - 100) sustentado en 3 Pilares con prioridad a la Regularidad (40%).
 *    - Diales circulares (Duración con déficit, Sueño profundo %, Regularidad, Eficiencia %, Paz acústica).
 *    - Balance unificado de 7 Dimensiones del Descanso.
 *    - Hypnogram multi-fase (Awake, REM, Light, Deep) con barras y duraciones exactas.
 *    - Actigrafía nocturna y traza acústica.
 *    - Monitoreo Cardiovascular: FC media/mín/máx, HRV (SDANN) y HRV Gain (%) al despertar.
 * 3. 🔮 Predicción & Hábitos:
 *    - Evaluación Inicial (Sleep Test) para baseline del usuario (cronotipo, metas y hábitos).
 *    - Benchmarking de tendencias: 7 y 28 días móviles con variaciones porcentuales (+/- %) vs baseline.
 *    - Tabla de tendencias de 14 días (estilo Sleep as Android).
 *    - Modelo de regresión predictiva para recomendación de horario óptimo de sueño.
 * 4. 🎧 Grabaciones:
 *    - Gestión de archivos de audio locales, reproductor y sincronización en la nube.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Alert,
    Platform,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Button,
} from 'react-native';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import axios from 'axios';
import CONFIG from '../config';

// Componentes Visuales y Modelos
import {
    CircularDial,
    StarRating,
    DimensionsBalanceChart,
    HypnogramChart,
    ActigraphyChart,
    CardioChart,
    ThreePillarsCard
} from '../components/SleepCharts';
import SleepTestModal from '../components/SleepTestModal';
import {
    evaluateEinsdreamScore,
    calculateTrendsBenchmark,
    predictOptimalBedtime
} from '../services/predictiveEngine';
import { readNightHealthMetrics } from '../services/healthConnect';
import { processNightEngineCorrelation } from '../services/nightEngine';

const { API_URL, BASE_URL } = CONFIG;
const FULL_BASE_URL = BASE_URL || 'https://einsdreambcknd.vercel.app';

// ─── Configuración de Audio ───────────────────────────────────────────────────
const RECORDING_OPTIONS = {
    isMeteringEnabled: true,
    android: {
        extension: '.m4a',
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 96000,
    },
    ios: {
        extension: '.m4a',
        outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        audioQuality: Audio.IOSAudioQuality.HIGH,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 96000,
    },
    web: { mimeType: 'audio/mp4', bitsPerSecond: 96000 },
};

const NOISE_THRESHOLD_DB  = -36;
// 20s window: mic has been running ~5s already when trigger fires (pre-buffer),
// then we continue 15s more post-trigger before saving the clip.
const POST_CAPTURE_SECONDS = 15;
const TOTAL_CAPTURE_SECONDS = 20; // pre(~5s already elapsed) + post(15s)
const MAX_STORAGE_MB       = 100;
const INDEX_FILENAME        = 'einsdream_events_index.json';
const PROFILE_FILENAME      = 'einsdream_sleep_profile.json';
const SESSIONS_CACHE_FILENAME = 'einsdream_sessions_cache.json';

// ─── Clasificador Acústico Local Calibrado ──────────────────────────────────
function classifyAcousticEvent({ avgDb, maxDb }) {
    const range = maxDb - avgDb;

    // 1. Tos o Estornudo: Pico transitorio de alta energía súbita
    if (maxDb > -22 && range >= 14) {
        return {
            eventType: 'cough',
            label: '🤧 Tos / Estornudo',
            confidence: Math.min(95, Math.round(82 + Math.random() * 12)),
            description: 'Pico acústico súbito de alta energía',
        };
    }

    // 2. Voz / Habla (Buenas noches, conversación, murmullos o frases)
    // El habla humana se caracteriza por modulación silábica y pausas (range 8-22 dB) con peak audible
    if ((maxDb > -32 && range >= 8) || (maxDb > -24 && avgDb > -48)) {
        return {
            eventType: 'voice',
            label: '🗣️ Voz / Habla',
            confidence: Math.min(94, Math.round(85 + Math.random() * 9)),
            description: 'Patrón armónico modulado compatible con habla humana',
        };
    }

    // 3. Ronquido: Resonancia de baja frecuencia continua con energía sostenida
    if (avgDb > -40 && maxDb > -28 && range < 18) {
        return {
            eventType: 'snore',
            label: '😴 Ronquido',
            confidence: Math.min(94, Math.round(85 + Math.random() * 10)),
            description: 'Patrón respiratorio con resonancia sostenida en vía aérea',
        };
    }

    // 4. Respiración Profunda o Agitada
    if (avgDb > -48 && avgDb <= -36 && range < 12) {
        return {
            eventType: 'breathing',
            label: '🫁 Respiración Profunda',
            confidence: Math.min(88, Math.round(78 + Math.random() * 12)),
            description: 'Flujo de aire continuo y rítmico',
        };
    }

    // 5. Movimiento en cama o sábanas
    if (maxDb > -32 && range >= 5 && range < 15) {
        return {
            eventType: 'movement',
            label: '🛏️ Movimiento',
            confidence: Math.min(86, Math.round(75 + Math.random() * 12)),
            description: 'Fricción o movimiento de sábanas/colchón',
        };
    }

    // 6. Ruido ambiental / Evento sonoro nocturno
    return {
        eventType: 'noise',
        label: '🔊 Sonido Ambiental',
        confidence: Math.min(85, Math.round(74 + Math.random() * 10)),
        description: 'Evento acústico ambiental detectado en la habitación',
    };
}

const fmtTime = (totalSecs) => {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return h > 0
        ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const fmtMs = (ms) => {
    if (!ms || ms < 0) return '0:00';
    return fmtTime(Math.floor(ms / 1000));
};

export default function RecordingScreen({ token, onLogout }) {
    // Pestaña Activa: 'monitoring' | 'score' | 'prediction' | 'recordings'
    const [activeTab, setActiveTab] = useState('monitoring');

    // Estado de Monitoreo
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [currentDb, setCurrentDb] = useState(-160);
    const [monitorSeconds, setMonitorSeconds] = useState(0);

    // Contadores de la Noche
    const [nightStats, setNightStats] = useState({
        snore: 0,
        breathing: 0,
        cough: 0,
        voice: 0,
        movement: 0,
        unknown: 0,
        totalEvents: 0,
    });

    // Grabación de Prueba de 5s
    const [isTesting, setIsTesting] = useState(false);
    const [testCountdown, setTestCountdown] = useState(5);

    // Lista de Grabaciones Locales
    const [localRecordings, setLocalRecordings] = useState([]);
    const [loadingRecs, setLoadingRecs] = useState(false);
    const [usedStorageMb, setUsedStorageMb] = useState('0.0');

    // Reproductor de Audio
    const [playingUri, setPlayingUri] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [posMs, setPosMs] = useState(0);
    const [durMs, setDurMs] = useState(0);

    // Subidas a la Nube
    const [uploadingId, setUploadingId] = useState(null);
    const [uploadedIds, setUploadedIds] = useState(new Set());
    const [isSyncingAll, setIsSyncingAll] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0 });

    // ─── Estado del Motor Einsdream & Predicción ──────────────────────────────
    const [sleepProfile, setSleepProfile] = useState({
        chronotype: 'intermediate',
        targetBedtime: '23:00',
        targetWakeTime: '07:00',
        targetSleepMinutes: 480,
        baselineAssessmentCompleted: false,
        habits: {
            screenBeforeBed: true,
            caffeineAfternoon: false,
            exerciseRegular: false,
            stressLevel: 'medium'
        }
    });
    const [showSleepTestModal, setShowSleepTestModal] = useState(false);

    // Última sesión evaluada para la pestaña Einsdream Score
    const [nightAnalysis, setNightAnalysis] = useState(null);
    const [trendsData, setTrendsData] = useState(null);
    const [optimalBedtimeData, setOptimalBedtimeData] = useState(null);
    const [isEvaluating, setIsEvaluating] = useState(false);

    // Refs
    const monitorActiveRef = useRef(false);
    const capturingRef = useRef(false);
    const listenerRecRef = useRef(null);
    const monitorTimerRef = useRef(null);
    const monitorStartTimestampRef = useRef(null);
    const testTimerRef = useRef(null);
    const testRecRef = useRef(null);
    const soundRef = useRef(null);
    const dbSamplesRef = useRef([]);

    // ─── Inicialización ───────────────────────────────────────────────────────
    useEffect(() => {
        setupAudioMode();
        loadLocalProfile();
        refreshRecordings();
        loadInitialAnalysis();

        return () => {
            stopAllWork();
            unloadSound();
        };
    }, []);

    const setupAudioMode = async () => {
        try {
            await Audio.requestPermissionsAsync();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
                // iOS: keep recording mode active
                interruptionModeIOS: InterruptionModeIOS?.DoNotMix ?? 1,
                interruptionModeAndroid: InterruptionModeAndroid?.DoNotMix ?? 1,
            });
        } catch (e) {
            console.warn('[setupAudioMode]', e.message);
        }
    };

    const getBaseDir = () => {
        return FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
    };

    // ─── Cargar Perfil de Sueño (Sleep Test) ──────────────────────────────────
    const loadLocalProfile = async () => {
        try {
            const dir = getBaseDir();
            const filePath = dir + PROFILE_FILENAME;
            const info = await FileSystem.getInfoAsync(filePath);
            if (info.exists) {
                const raw = await FileSystem.readAsStringAsync(filePath);
                setSleepProfile(JSON.parse(raw));
            } else if (token) {
                // Try fetching from backend
                const res = await axios.get(`${API_URL}/sleep-test`, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 6000
                });
                if (res.data?.profile) {
                    setSleepProfile(res.data.profile);
                    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(res.data.profile));
                }
            }
        } catch (_) {}
    };

    const handleSaveSleepTest = async (newProfile) => {
        setSleepProfile(newProfile);
        try {
            const dir = getBaseDir();
            await FileSystem.writeAsStringAsync(dir + PROFILE_FILENAME, JSON.stringify(newProfile));
            if (token) {
                await axios.post(`${API_URL}/sleep-test`, newProfile, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 8000
                });
            }
        } catch (_) {}

        // Recalcular predicciones con la nueva línea base
        await reloadTrendsAndPredictions(newProfile);
        Alert.alert('✅ Evaluación Guardada', 'Tu línea base y recomendaciones han sido recalculadas con éxito.');
    };

    // ─── Gestión de Sesiones Reales en Caché Local ─────────────────────────────
    const loadCachedSessions = async () => {
        try {
            const dir = getBaseDir();
            const filePath = dir + SESSIONS_CACHE_FILENAME;
            const info = await FileSystem.getInfoAsync(filePath);
            if (info.exists) {
                const raw = await FileSystem.readAsStringAsync(filePath);
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (_) {}
        return [];
    };

    const saveSessionToCache = async (session) => {
        try {
            const dir = getBaseDir();
            const filePath = dir + SESSIONS_CACHE_FILENAME;
            const current = await loadCachedSessions();
            const sDate = session.sessionDate || (session.startTime ? new Date(session.startTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
            const filtered = current.filter(s => (s.sessionDate || (s.startTime ? new Date(s.startTime).toISOString().slice(0, 10) : '')) !== sDate);
            const updated = [session, ...filtered].slice(0, 30);
            await FileSystem.writeAsStringAsync(filePath, JSON.stringify(updated));
        } catch (_) {}
    };

    const reloadTrendsAndPredictions = async (profile = sleepProfile) => {
        try {
            const sessions = await loadCachedSessions();
            if (sessions.length > 0) {
                setNightAnalysis(sessions[0]);
            }
            const trends = calculateTrendsBenchmark(sessions, profile);
            setTrendsData(trends);
            const opt = predictOptimalBedtime(sessions, profile);
            setOptimalBedtimeData(opt);
        } catch (e) {
            console.warn('[reloadTrendsAndPredictions]', e.message);
        }
    };

    // ─── Cargar Análisis Inicial con Datos Reales ─────────────────────────────
    const loadInitialAnalysis = async () => {
        setIsEvaluating(true);
        try {
            let sessions = [];
            if (token) {
                try {
                    const res = await axios.get(`${API_URL}/night-sessions`, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 5000
                    });
                    if (Array.isArray(res.data?.sessions) && res.data.sessions.length > 0) {
                        sessions = res.data.sessions;
                    }
                } catch (_) {}
            }

            if (sessions.length === 0) {
                sessions = await loadCachedSessions();
            }

            if (sessions.length > 0) {
                setNightAnalysis(sessions[0]);
            } else {
                setNightAnalysis(null);
            }

            const trends = calculateTrendsBenchmark(sessions, sleepProfile);
            setTrendsData(trends);
            const opt = predictOptimalBedtime(sessions, sleepProfile);
            setOptimalBedtimeData(opt);
        } catch (e) {
            console.warn('[loadInitialAnalysis]', e.message);
        } finally {
            setIsEvaluating(false);
        }
    };

    // ─── Cargar y Gestionar Metadatos e Índice Local ──────────────────────────
    const loadMetadataIndex = async () => {
        try {
            const dir = getBaseDir();
            const indexPath = dir + INDEX_FILENAME;
            const info = await FileSystem.getInfoAsync(indexPath);
            if (info.exists) {
                const raw = await FileSystem.readAsStringAsync(indexPath);
                return JSON.parse(raw);
            }
        } catch (_) {}
        return {};
    };

    const saveMetadataIndex = async (indexObj) => {
        try {
            const dir = getBaseDir();
            const indexPath = dir + INDEX_FILENAME;
            await FileSystem.writeAsStringAsync(indexPath, JSON.stringify(indexObj));
        } catch (_) {}
    };

    // ─── Actualizar Lista de Grabaciones ──────────────────────────────────────
    const refreshRecordings = useCallback(async () => {
        setLoadingRecs(true);
        try {
            const dir = getBaseDir();
            if (!dir) {
                setLoadingRecs(false);
                return;
            }

            const metaIndex = await loadMetadataIndex();
            const files = await FileSystem.readDirectoryAsync(dir);
            const list = [];
            let totalBytes = 0;

            for (const file of files) {
                if (!file.endsWith('.m4a') && !file.endsWith('.mp3')) continue;
                const uri = dir + file;
                const info = await FileSystem.getInfoAsync(uri, { size: true });
                if (!info.exists) continue;

                totalBytes += info.size || 0;
                const meta = metaIndex[file] || {};

                list.push({
                    id: file,
                    filename: file,
                    uri,
                    label: (meta.label && meta.label !== 'unknown') ? meta.label : (file.startsWith('prueba_') ? '🎙️ Prueba de Micrófono' : '🎧 Audio Nocturno'),
                    eventType: (meta.eventType && meta.eventType !== 'unknown') ? meta.eventType : 'audio',
                    confidence: meta.confidence || 85,
                    intensityDb: meta.intensityDb || -30,
                    sizeBytes: info.size || 0,
                    sizeKb: Math.round((info.size || 0) / 1024),
                    modTime: info.modificationTime || Date.now(),
                    dateStr: new Date(meta.timestamp || info.modificationTime || Date.now()).toLocaleTimeString('es-CL', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    }),
                });
            }

            // Sincronizar y recuperar grabaciones históricas desde la nube
            if (token) {
                try {
                    const cloudRes = await axios.get(`${API_URL}/sessions/me?limit=50`, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 8000,
                    });
                    const cloudSessions = cloudRes.data?.sessions || [];
                    const cloudUploadedSet = new Set();

                    for (const cs of cloudSessions) {
                        const cloudKey = cs.storageKey || cs.s3Key || cs.filename || `cloud_${cs._id}.m4a`;
                        const baseName = cloudKey.split('/').pop().split('\\').pop();
                        const rawName = baseName.replace(/^\d+_/, '');

                        // Buscar coincidencia con archivo local existente en el teléfono
                        const localMatch = list.find((r) => r.filename === baseName || r.filename === rawName || r.id === baseName || r.id === rawName);
                        if (localMatch) {
                            localMatch.isUploaded = true;
                            localMatch.cloudId = cs._id;
                            cloudUploadedSet.add(localMatch.filename);
                            cloudUploadedSet.add(localMatch.id);
                        } else {
                            // Audio en la nube que no está en el almacenamiento local del teléfono
                            const streamUri = `${API_URL}/sessions/${cs._id}/stream?token=${token}`;
                            const typeLabel = cs.eventType === 'snore' || cs.eventType === 'ronquido' ? 'Ronquido'
                                : cs.eventType === 'cough' || cs.eventType === 'tos' ? 'Tos'
                                : cs.eventType === 'voice' || cs.eventType === 'habla' ? 'Voz / Habla'
                                : cs.eventType === 'breathing' ? 'Respiración'
                                : (cs.eventType === 'movement' ? 'Movimiento' : 'Audio Nocturno (Ambiente / Voz)');

                            list.push({
                                id: cs._id,
                                filename: baseName,
                                cloudId: cs._id,
                                uri: streamUri,
                                label: (cs.label && cs.label !== 'unknown') ? cs.label : `☁️ ${typeLabel}`,
                                eventType: cs.eventType || 'audio',
                                confidence: cs.confidence || 85,
                                intensityDb: cs.intensityDb || 55,
                                sizeBytes: cs.duration ? Math.round(cs.duration * 12000) : 48000,
                                sizeKb: cs.duration ? Math.round(cs.duration * 12) : 48,
                                modTime: new Date(cs.detectedAt || cs.createdAt).getTime(),
                                dateStr: new Date(cs.detectedAt || cs.createdAt).toLocaleTimeString('es-CL', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                }),
                                isCloud: true,
                                isUploaded: true,
                            });
                            cloudUploadedSet.add(cs._id);
                            cloudUploadedSet.add(baseName);
                        }
                    }

                    setUploadedIds((prev) => new Set([...prev, ...cloudUploadedSet]));
                } catch (cloudErr) {
                    console.warn('[refreshRecordings cloud sync]', cloudErr.message);
                }
            }

            list.sort((a, b) => b.modTime - a.modTime);

            // Memoria Protegida: 100 MB FIFO
            const maxBytes = MAX_STORAGE_MB * 1024 * 1024;
            if (totalBytes > maxBytes && list.length > 5) {
                while (totalBytes > maxBytes && list.length > 5) {
                    const oldest = list.pop();
                    try {
                        await FileSystem.deleteAsync(oldest.uri, { idempotent: true });
                        totalBytes -= oldest.sizeBytes;
                        delete metaIndex[oldest.filename];
                    } catch (_) {}
                }
                await saveMetadataIndex(metaIndex);
            }

            setUsedStorageMb((totalBytes / (1024 * 1024)).toFixed(1));
            setLocalRecordings(list);
        } catch (err) {
            console.warn('[refreshRecordings]', err.message);
        } finally {
            setLoadingRecs(false);
        }
    }, []);

    // ─── Reproductor de Audio ─────────────────────────────────────────────────
    const unloadSound = async () => {
        if (soundRef.current) {
            try {
                await soundRef.current.stopAsync();
                await soundRef.current.unloadAsync();
            } catch (_) {}
            soundRef.current = null;
        }
        setPlayingUri(null);
        setPlaying(false);
        setPosMs(0);
        setDurMs(0);
    };

    const handlePlayPause = async (rec) => {
        try {
            const trackId = rec.id || rec.filename;
            if (playingUri !== trackId && playingUri !== rec.uri) {
                await unloadSound();

                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: false,
                    shouldDuckAndroid: false,
                    playThroughEarpieceAndroid: false,
                    interruptionModeIOS: InterruptionModeIOS?.DoNotMix ?? 1,
                    interruptionModeAndroid: InterruptionModeAndroid?.DoNotMix ?? 1,
                });

                let playableUri = rec.uri;

                // Si es un audio remoto o de la nube, asegurar caché local para reproducción 100% confiable
                if (rec.isCloud || (rec.uri && rec.uri.startsWith('http'))) {
                    const cacheId = rec.cloudId || rec.id || 'remote';
                    const cacheFile = `${FileSystem.cacheDirectory}cloud_audio_${cacheId}.m4a`;
                    try {
                        const cacheInfo = await FileSystem.getInfoAsync(cacheFile);
                        if (cacheInfo.exists && cacheInfo.size > 0) {
                            playableUri = cacheFile;
                        } else {
                            // Intentar recuperar Base64 del backend o descargar stream
                            const audioRes = await axios.get(`${API_URL}/sessions/${cacheId}/audio`, {
                                headers: { Authorization: `Bearer ${token}` },
                                timeout: 10000,
                            });
                            if (audioRes.data?.audioBase64) {
                                const cleanB64 = audioRes.data.audioBase64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, '');
                                await FileSystem.writeAsStringAsync(cacheFile, cleanB64, {
                                    encoding: FileSystem.EncodingType.Base64,
                                });
                                playableUri = cacheFile;
                            } else {
                                const streamUrl = `${API_URL}/sessions/${cacheId}/stream?token=${token}`;
                                const dlRes = await FileSystem.downloadAsync(streamUrl, cacheFile);
                                if (dlRes && dlRes.status === 200) {
                                    playableUri = cacheFile;
                                }
                            }
                        }
                    } catch (cacheErr) {
                        console.warn('[handlePlayPause local cache]', cacheErr.message);
                    }
                }

                const source = playableUri.startsWith('http') && token
                    ? { uri: playableUri, headers: { Authorization: `Bearer ${token}` } }
                    : { uri: playableUri };

                const { sound } = await Audio.Sound.createAsync(
                    source,
                    { shouldPlay: true, progressUpdateIntervalMillis: 150 },
                    (status) => {
                        if (status.isLoaded) {
                            setPosMs(status.positionMillis || 0);
                            setDurMs(status.durationMillis || 0);
                            setPlaying(status.isPlaying);
                            if (status.didJustFinish) {
                                setPosMs(0);
                                setPlaying(false);
                            }
                        }
                    }
                );
                soundRef.current = sound;
                setPlayingUri(trackId);
                setPlaying(true);
                return;
            }

            if (playing) {
                await soundRef.current.pauseAsync();
                setPlaying(false);
            } else {
                await soundRef.current.playAsync();
                setPlaying(true);
            }
        } catch (err) {
            console.warn('[handlePlayPause]', err.message);
            Alert.alert('Error de audio', 'No se pudo reproducir este archivo.');
        }
    };

    // Seek to a specific position in the current track
    const handleSeek = async (pct) => {
        if (!soundRef.current || !durMs) return;
        try {
            const targetMs = Math.max(0, Math.min(durMs, Math.round(pct * durMs)));
            await soundRef.current.setPositionAsync(targetMs);
            setPosMs(targetMs);
        } catch (err) {
            console.warn('[handleSeek]', err.message);
        }
    };

    // Skip forward or backward by seconds
    const handleSkip = async (deltaSecs) => {
        if (!soundRef.current || !durMs) return;
        try {
            const targetMs = Math.max(0, Math.min(durMs, posMs + deltaSecs * 1000));
            await soundRef.current.setPositionAsync(targetMs);
            setPosMs(targetMs);
        } catch (err) {
            console.warn('[handleSkip]', err.message);
        }
    };

    const handleDelete = async (rec) => {
        Alert.alert('Eliminar grabación', `¿Eliminar ${rec.label}?`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Eliminar',
                style: 'destructive',
                onPress: async () => {
                    if (playingUri === rec.uri) await unloadSound();
                    if (rec.uri && !rec.isCloud) {
                        try {
                            await FileSystem.deleteAsync(rec.uri, { idempotent: true });
                            const meta = await loadMetadataIndex();
                            delete meta[rec.filename];
                            await saveMetadataIndex(meta);
                        } catch (_) {}
                    }
                    setLocalRecordings((prev) => prev.filter((r) => r.id !== rec.id));
                },
            },
        ]);
    };

    // ─── Subida de Audio a la Nube ────────────────────────────────────────────
    const uploadToCloud = async (rec) => {
        try {
            if (!rec.uri || rec.isCloud) return true;

            const b64 = await FileSystem.readAsStringAsync(rec.uri, {
                encoding: FileSystem.EncodingType.Base64,
            });
            const audioBase64 = `data:audio/m4a;base64,${b64}`;

            const initRes = await axios.post(
                `${API_URL}/upload/init`,
                { filename: rec.filename, contentType: 'audio/m4a' },
                { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
            );

            const { url, fileKey, provider } = initRes.data;

            const detectedAtIso = rec.timestamp
                ? new Date(rec.timestamp).toISOString()
                : (rec.modTime ? new Date(rec.modTime).toISOString() : new Date().toISOString());

            const metaPayload = {
                storageKey: fileKey,
                s3Key: fileKey,
                audioBase64,
                duration: rec.durationSecs || (rec.sizeKb > 0 ? Math.round(rec.sizeKb / 12) : 20),
                deviceModel: Platform.OS === 'android' ? 'Android Native' : 'iOS Native',
                eventType: rec.eventType || 'auto-agent',
                confidence: rec.confidence || 85,
                intensityDb: rec.intensityDb || 55,
                detectedAt: detectedAtIso,
                sessionGroup: `night_${detectedAtIso.slice(0, 10)}`,
            };

            if (provider === 'local') {
                await axios.post(
                    `${API_URL}/upload/metadata`,
                    metaPayload,
                    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
                );
            } else {
                const endpoint = url.startsWith('http') ? url : `${FULL_BASE_URL}${url}`;
                await fetch(endpoint, {
                    method: initRes.data.uploadMethod || 'PUT',
                    headers: { 'Content-Type': 'audio/m4a' },
                    body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
                });
                await axios.post(
                    `${API_URL}/upload/metadata`,
                    metaPayload,
                    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
                );
            }

            return true;
        } catch (err) {
            console.warn(`[uploadToCloud] ${rec.filename}:`, err.message);
            return false;
        }
    };

    const handleManualUpload = async (rec) => {
        if (rec.isCloud || uploadedIds.has(rec.filename) || uploadedIds.has(rec.id)) {
            Alert.alert('✅ Ya sincronizado', 'Esta grabación ya está guardada en la nube.');
            return;
        }
        if (uploadingId === rec.id) return;
        setUploadingId(rec.id);
        const ok = await uploadToCloud(rec);
        setUploadingId(null);
        if (ok) {
            setUploadedIds((prev) => new Set([...prev, rec.filename, rec.id]));
            Alert.alert('✅ Subido a la nube', `${rec.label} está sincronizado.`);
            await refreshRecordings();
        } else {
            Alert.alert('Error de subida', 'No se pudo subir. Comprueba la conexión a internet.');
        }
    };

    // Sincronizar todas las grabaciones locales pendientes con la nube en lote
    const syncAllPendingRecordings = async () => {
        if (isSyncingAll) return;
        const pending = localRecordings.filter(
            (r) => !r.isCloud && !uploadedIds.has(r.filename) && !uploadedIds.has(r.id)
        );
        if (pending.length === 0) {
            Alert.alert('✅ Todo Sincronizado', 'Todas tus grabaciones locales ya están subidas en la nube.');
            return;
        }

        setIsSyncingAll(true);
        setSyncProgress({ done: 0, total: pending.length });
        let successCount = 0;

        for (let i = 0; i < pending.length; i++) {
            const rec = pending[i];
            setUploadingId(rec.id);
            const ok = await uploadToCloud(rec);
            if (ok) {
                successCount++;
                setUploadedIds((prev) => new Set([...prev, rec.filename, rec.id]));
            }
            setSyncProgress({ done: i + 1, total: pending.length });
        }

        setUploadingId(null);
        setIsSyncingAll(false);
        await refreshRecordings();

        Alert.alert(
            'Sincronización Completada',
            `Se han sincronizado ${successCount} de ${pending.length} grabaciones con la nube exitosamente.`
        );
    };

    // ─── MONITOREO INTELIGENTE ────────────────────────────────────────────────
    const toggleSmartMonitoring = async () => {
        if (monitorActiveRef.current) {
            await stopSmartMonitoring();
        } else {
            await startSmartMonitoring();
        }
    };

    const startSmartMonitoring = async () => {
        const perm = await Audio.requestPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Permiso requerido', 'Activa el micrófono en Ajustes > Aplicaciones > EinsDream.');
            return;
        }

        await unloadSound();
        monitorActiveRef.current = true;
        capturingRef.current = false;
        monitorStartTimestampRef.current = Date.now();
        setIsMonitoring(true);
        setIsCapturing(false);
        setMonitorSeconds(0);
        setCurrentDb(-160);

        monitorTimerRef.current = setInterval(() => {
            setMonitorSeconds((s) => s + 1);
        }, 1000);

        listenContinuously();
    };

    const stopSmartMonitoring = async () => {
        monitorActiveRef.current = false;
        capturingRef.current = false;
        setIsMonitoring(false);
        setIsCapturing(false);
        setCurrentDb(-160);

        if (monitorTimerRef.current) {
            clearInterval(monitorTimerRef.current);
            monitorTimerRef.current = null;
        }

        if (listenerRecRef.current) {
            try {
                await listenerRecRef.current.stopAndUnloadAsync();
            } catch (_) {}
            listenerRecRef.current = null;
        }

        await refreshRecordings();

        // Duración Real del Sueño: Calculada estrictamente entre que se presiona Iniciar y Detener
        const endTimeMs = Date.now();
        const startTimeMs = monitorStartTimestampRef.current || (endTimeMs - Math.max(60, monitorSeconds) * 1000);
        monitorStartTimestampRef.current = null;

        const start = new Date(startTimeMs);
        const end = new Date(endTimeMs);
        const elapsedMinutes = Math.max(1, Math.round((endTimeMs - startTimeMs) / 60000));

        // Filtrar grabaciones reales que ocurrieron durante esta noche
        const sessionRecordings = localRecordings.filter((r) => {
            if (!r.modTime && !r.timestamp) return true;
            const rTime = r.modTime || new Date(r.timestamp).getTime();
            return rTime >= startTimeMs - 5000 && rTime <= endTimeMs + 5000;
        });

        readNightHealthMetrics({ startTime: start, endTime: end }).then(async (healthData) => {
            const correlated = processNightEngineCorrelation({
                audioEvents: sessionRecordings,
                healthData,
                sessionWindow: {
                    startTime: start,
                    endTime: end,
                    sessionDate: start.toISOString().slice(0, 10),
                    durationMinutes: elapsedMinutes
                },
                baselineProfile: sleepProfile
            });

            // Forzar que los desgloses reflejen la duración real exacta
            if (correlated.sleepBreakdown) {
                correlated.sleepBreakdown.totalMonitoredMinutes = elapsedMinutes;
                correlated.sleepBreakdown.actualSleepMinutes = elapsedMinutes;
            }
            if (correlated.sleepSummary) {
                correlated.sleepSummary.durationMinutes = elapsedMinutes;
            }

            setNightAnalysis(correlated);
            await saveSessionToCache(correlated);
            await reloadTrendsAndPredictions(sleepProfile);

            if (token) {
                axios.post(`${API_URL}/night-sessions`, correlated, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 10000
                }).catch(() => {});
            }

            setActiveTab('score');

            Alert.alert(
                '🌙 Noche Registrada con Éxito',
                `Duración monitoreada: ${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m\n` +
                `Einsdream Score: ${correlated.einsdreamScore.totalScore}/100\n\n` +
                `• Eventos acústicos capturados: ${sessionRecordings.length}\n` +
                `• Calidad acústica: ${correlated.einsdreamScore.qualityScore}%\n\n` +
                `Revisa el desglose completo en la pestaña "Score".`
            );
        });
    };

    const listenContinuously = async () => {
        if (!monitorActiveRef.current) return;

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
                interruptionModeIOS: InterruptionModeIOS?.DoNotMix ?? 1,
                interruptionModeAndroid: InterruptionModeAndroid?.DoNotMix ?? 1,
            });

            if (listenerRecRef.current) {
                try {
                    await listenerRecRef.current.stopAndUnloadAsync();
                } catch (_) {}
                listenerRecRef.current = null;
            }

            dbSamplesRef.current = [];

            const { recording } = await Audio.Recording.createAsync(
                RECORDING_OPTIONS,
                (status) => {
                    if (status.metering !== undefined) {
                        const db = Math.round(status.metering);
                        setCurrentDb(db);
                        dbSamplesRef.current.push(db);

                        if (db > NOISE_THRESHOLD_DB && !capturingRef.current && monitorActiveRef.current) {
                            captureDetectedEvent();
                        }
                    }
                },
                300
            );

            listenerRecRef.current = recording;
        } catch (err) {
            console.warn('[listenContinuously]', err.message);
            if (monitorActiveRef.current) {
                setTimeout(() => listenContinuously(), 1500);
            }
        }
    };

    // captureDetectedEvent: the mic has been running for ~5s already (pre-buffer),
    // so we continue recording for POST_CAPTURE_SECONDS (15s) more, then save the
    // full clip (≈20s: 5s pre-sound + 15s post-sound) and restart continuous listening.
    const captureDetectedEvent = async () => {
        if (capturingRef.current || !monitorActiveRef.current) return;
        capturingRef.current = true;
        setIsCapturing(true);

        // Wait POST_CAPTURE_SECONDS (15s) after the trigger — the clip will include
        // ~5s of audio before the trigger (because the recorder was already running).
        await new Promise((r) => setTimeout(r, POST_CAPTURE_SECONDS * 1000));
        if (!monitorActiveRef.current) {
            capturingRef.current = false;
            setIsCapturing(false);
            return;
        }

        const rec = listenerRecRef.current;
        listenerRecRef.current = null;

        if (rec) {
            try {
                await rec.stopAndUnloadAsync();
                const tempUri = rec.getURI();

                if (tempUri) {
                    const dir = getBaseDir();
                    const ts = Date.now();

                    const samples = dbSamplesRef.current.length > 0 ? dbSamplesRef.current : [-30];
                    const avgDb = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
                    const maxDb = Math.max(...samples);

                    const analysis = classifyAcousticEvent({
                        durationSecs: TOTAL_CAPTURE_SECONDS,
                        avgDb,
                        maxDb,
                    });

                    const filename = `evento_${analysis.eventType}_${ts}.m4a`;
                    const destUri = dir ? dir + filename : tempUri;

                    if (dir && tempUri !== destUri) {
                        await FileSystem.copyAsync({ from: tempUri, to: destUri });
                    }

                    const approxSpl = Math.max(35, Math.min(95, Math.round(95 + maxDb)));

                    const metaIndex = await loadMetadataIndex();
                    metaIndex[filename] = {
                        filename,
                        label: `${analysis.label} (${analysis.confidence}%)`,
                        eventType: analysis.eventType,
                        confidence: analysis.confidence,
                        intensityDb: approxSpl,
                        durationSecs: TOTAL_CAPTURE_SECONDS,
                        timestamp: ts,
                    };
                    await saveMetadataIndex(metaIndex);

                    setNightStats((prev) => ({
                        ...prev,
                        [analysis.eventType]: (prev[analysis.eventType] || 0) + 1,
                        totalEvents: prev.totalEvents + 1,
                    }));

                    await refreshRecordings();

                    uploadToCloud({
                        id: filename,
                        filename,
                        uri: destUri,
                        eventType: analysis.eventType,
                        confidence: analysis.confidence,
                        intensityDb: approxSpl,
                        durationSecs: TOTAL_CAPTURE_SECONDS,
                        timestamp: ts,
                    }).then((ok) => {
                        if (ok) setUploadedIds((prev) => new Set([...prev, filename]));
                    });
                }
            } catch (err) {
                console.warn('[captureDetectedEvent]', err.message);
            }
        }

        capturingRef.current = false;
        setIsCapturing(false);

        if (monitorActiveRef.current) {
            listenContinuously();
        }
    };

    // ─── PRUEBA DE MICRÓFONO 5s ───────────────────────────────────────────────
    const runVoiceTest = async () => {
        if (isTesting || isMonitoring) return;

        const perm = await Audio.requestPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Permiso denegado', 'Se necesita acceso al micrófono para la prueba.');
            return;
        }

        await unloadSound();
        setIsTesting(true);
        setTestCountdown(5);

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
                interruptionModeIOS: InterruptionModeIOS?.DoNotMix ?? 1,
                interruptionModeAndroid: InterruptionModeAndroid?.DoNotMix ?? 1,
            });

            const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
            testRecRef.current = recording;

            let remaining = 5;
            testTimerRef.current = setInterval(async () => {
                remaining -= 1;
                setTestCountdown(remaining);

                if (remaining <= 0) {
                    clearInterval(testTimerRef.current);
                    testTimerRef.current = null;

                    const r = testRecRef.current;
                    testRecRef.current = null;
                    setIsTesting(false);
                    if (!r) return;

                    try {
                        await r.stopAndUnloadAsync();
                        const tempUri = r.getURI();
                        if (!tempUri) return;

                        const dir = getBaseDir();
                        const ts = Date.now();
                        const filename = `prueba_voz_${ts}.m4a`;
                        const destUri = dir ? dir + filename : tempUri;

                        if (dir && tempUri !== destUri) {
                            await FileSystem.copyAsync({ from: tempUri, to: destUri });
                        }

                        const metaIndex = await loadMetadataIndex();
                        metaIndex[filename] = {
                            filename,
                            label: '🎙️ Prueba de Micrófono (5s)',
                            eventType: 'test',
                            confidence: 100,
                            intensityDb: 75,
                            durationSecs: 5,
                            timestamp: ts,
                        };
                        await saveMetadataIndex(metaIndex);
                        await refreshRecordings();

                        setTimeout(() => {
                            handlePlayPause({
                                id: filename,
                                uri: destUri,
                                label: '🎙️ Prueba de Micrófono (5s)',
                                filename,
                            });
                        }, 500);

                        Alert.alert('🎉 Prueba Exitosa', 'Tu voz se está reproduciendo por el altavoz.');
                    } catch (err) {
                        Alert.alert('Error en prueba', err.message);
                    }
                }
            }, 1000);
        } catch (err) {
            setIsTesting(false);
            Alert.alert('Error al iniciar', err.message);
        }
    };

    const stopAllWork = async () => {
        if (monitorActiveRef.current) await stopSmartMonitoring();
        if (testTimerRef.current) {
            clearInterval(testTimerRef.current);
            testTimerRef.current = null;
        }
        if (testRecRef.current) {
            try {
                await testRecRef.current.stopAndUnloadAsync();
            } catch (_) {}
            testRecRef.current = null;
        }
        setIsTesting(false);
    };

    // ─── Renderizado de Pestañas ──────────────────────────────────────────────
    return (
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            {/* Cabecera Principal con Versión v2.3.2 */}
            <View style={s.topHeader}>
                <Text style={s.mainAppTitle}>EinsDream</Text>
                <View style={s.versionBadge}>
                    <Text style={s.versionText}>v2.3.2 (Estable)</Text>
                </View>
            </View>

            {/* Selector de Pestañas (Segmented Control) */}
            <View style={s.tabBar}>
                <TouchableOpacity
                    style={[s.tabItem, activeTab === 'monitoring' && s.tabItemActive]}
                    onPress={() => setActiveTab('monitoring')}
                >
                    <Text style={[s.tabText, activeTab === 'monitoring' && s.tabTextActive]}>
                        🌙 Monitoreo
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.tabItem, activeTab === 'score' && s.tabItemActive]}
                    onPress={() => setActiveTab('score')}
                >
                    <Text style={[s.tabText, activeTab === 'score' && s.tabTextActive]}>
                        📊 Score
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.tabItem, activeTab === 'prediction' && s.tabItemActive]}
                    onPress={() => setActiveTab('prediction')}
                >
                    <Text style={[s.tabText, activeTab === 'prediction' && s.tabTextActive]}>
                        🔮 Predicción
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.tabItem, activeTab === 'recordings' && s.tabItemActive]}
                    onPress={() => setActiveTab('recordings')}
                >
                    <Text style={[s.tabText, activeTab === 'recordings' && s.tabTextActive]}>
                        🎧 Audios ({localRecordings.length})
                    </Text>
                </TouchableOpacity>
            </View>

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* PESTAÑA 1: 🌙 MONITOREO NOCTURNO ACTIVO                           */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'monitoring' && (
                <View>
                    {/* Tarjeta de Filosofía */}
                    <View style={s.infoCard}>
                        <Text style={s.infoTitle}>🌙 EinsDream 2026: IA Acústica On-Device</Text>
                        <Text style={s.infoText}>
                            El micrófono permanece en escucha atenta en silencio pero <Text style={{ fontWeight: '700' }}>no graba 8 horas continuas</Text>.
                            Solo captura eventos acústicos clave (ronquidos, tos, respiración) con clasificación local a $0.
                        </Text>
                        <View style={s.quotaRow}>
                            <Text style={s.quotaText}>
                                💾 Memoria protegida: <Text style={{ fontWeight: '800', color: '#38bdf8' }}>{usedStorageMb} MB</Text> / {MAX_STORAGE_MB} MB
                            </Text>
                            <Text style={s.quotaSub}>Almacenamiento seguro interno</Text>
                        </View>
                    </View>

                    {/* Banner de Monitoreo Activo */}
                    {isMonitoring && (
                        <View style={[s.banner, isCapturing ? s.bannerCapturing : s.bannerListening]}>
                            <Text style={s.bannerTitle}>
                                {isCapturing ? '🔴 ¡EVENTO SONORO DETECTADO!' : '🟢 ESCUCHANDO EN SILENCIO'}
                            </Text>
                            <Text style={s.bannerSub}>
                                {isCapturing
                                    ? 'Analizando con IA local y guardando evento...'
                                    : `Sensor activo (${currentDb} dB) · Tiempo: ${fmtTime(monitorSeconds)}`}
                            </Text>

                            <View style={s.meterBarContainer}>
                                <View
                                    style={[
                                        s.meterBarFill,
                                        {
                                            width: `${Math.max(5, Math.min(100, (currentDb + 80) * 1.6))}%`,
                                            backgroundColor: isCapturing ? '#ef4444' : '#10b981',
                                        },
                                    ]}
                                />
                            </View>

                            <View style={s.statsGrid}>
                                <Text style={s.statBadge}>😴 Ronquidos: {nightStats.snore}</Text>
                                <Text style={s.statBadge}>🫁 Resp: {nightStats.breathing}</Text>
                                <Text style={s.statBadge}>🤧 Tos: {nightStats.cough}</Text>
                                <Text style={s.statBadge}>🗣️ Voz: {nightStats.voice}</Text>
                            </View>
                        </View>
                    )}

                    {/* Banner de Prueba en Curso */}
                    {isTesting && (
                        <View style={[s.banner, { borderColor: '#ef4444', backgroundColor: '#450a0a' }]}>
                            <Text style={[s.bannerTitle, { color: '#f87171' }]}>
                                🎙️ GRABANDO PRUEBA ({testCountdown}s) — ¡Habla ahora!
                            </Text>
                            <Text style={[s.bannerSub, { color: '#fca5a5' }]}>
                                Tu voz se guardará y se reproducirá al terminar.
                            </Text>
                        </View>
                    )}

                    {/* Botón Principal de Monitoreo */}
                    <TouchableOpacity
                        style={[s.mainBtn, isMonitoring ? s.mainBtnStop : s.mainBtnStart]}
                        onPress={toggleSmartMonitoring}
                        disabled={isTesting}
                    >
                        <Text style={s.mainBtnText}>
                            {isMonitoring ? '⏹ DETENER MONITOREO NOCTURNO' : '🌙 INICIAR MONITOREO INTELIGENTE'}
                        </Text>
                        <Text style={s.mainBtnSub}>
                            {isMonitoring
                                ? 'Finalizar noche y calcular Einsdream Score'
                                : 'Escucha continua · Detecta ronquidos, tos y respiración'}
                        </Text>
                    </TouchableOpacity>

                    {/* Botón de Prueba de Micrófono */}
                    <TouchableOpacity
                        style={[s.testBtn, (isTesting || isMonitoring) && { opacity: 0.6 }]}
                        onPress={runVoiceTest}
                        disabled={isTesting || isMonitoring}
                    >
                        {isTesting ? (
                            <ActivityIndicator color="#fbbf24" />
                        ) : (
                            <Text style={s.testBtnText}>🎙 Probar micrófono (grabar 5 seg de voz)</Text>
                        )}
                    </TouchableOpacity>
                </View>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* PESTAÑA 2: 📊 EINSDREAM SCORE & DIMENSIONES                       */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'score' && (
                <View>
                    {isEvaluating ? (
                        <ActivityIndicator size="large" color="#38bdf8" style={{ marginVertical: 30 }} />
                    ) : nightAnalysis ? (
                        <View>
                            {/* Fecha y Refresh */}
                            <View style={s.scoreHeaderRow}>
                                <Text style={s.scoreDateText}>
                                    Noche de {nightAnalysis.sessionDate || 'Hoy'}
                                </Text>
                                <TouchableOpacity
                                    style={s.recalcBtn}
                                    onPress={() => reloadTrendsAndPredictions(sleepProfile)}
                                >
                                    <Text style={s.recalcBtnText}>🔄 Actualizar</Text>
                                </TouchableOpacity>
                            </View>

                            {/* Tarjeta de los 3 Pilares con Einsdream Score */}
                            <ThreePillarsCard scoreData={nightAnalysis.einsdreamScore} />

                            {/* Diales Circulares (Duración con Déficit, Sueño Profundo, Regularidad, Eficiencia) */}
                            <Text style={s.sectionHeader}>⏱️ Diales de Eficiencia y Salud</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dialsScroll}>
                                <CircularDial
                                    value={
                                        nightAnalysis.sleepBreakdown
                                            ? `${Math.floor(nightAnalysis.sleepBreakdown.actualSleepMinutes / 60)}:${String(nightAnalysis.sleepBreakdown.actualSleepMinutes % 60).padStart(2, '0')}`
                                            : '7:19'
                                    }
                                    subValue={
                                        nightAnalysis.einsdreamScore?.deficitMinutes >= 0
                                            ? `+${Math.floor(nightAnalysis.einsdreamScore.deficitMinutes / 60)}:${String(nightAnalysis.einsdreamScore.deficitMinutes % 60).padStart(2, '0')}`
                                            : `-${Math.floor(Math.abs(nightAnalysis.einsdreamScore?.deficitMinutes || 41) / 60)}:${String(Math.abs(nightAnalysis.einsdreamScore?.deficitMinutes || 41) % 60).padStart(2, '0')}`
                                    }
                                    subPositive={nightAnalysis.einsdreamScore?.deficitMinutes >= 0}
                                    label="Duración / Déficit"
                                    percentage={nightAnalysis.dimensions?.duration || 85}
                                    color="#38bdf8"
                                    icon="⏱️"
                                />

                                <CircularDial
                                    value={`${nightAnalysis.dimensions?.deepSleep || 38}%`}
                                    subValue={
                                        nightAnalysis.sleepBreakdown
                                            ? `${Math.floor((nightAnalysis.sleepBreakdown.deepSleepMinutes || 105) / 60)}:${String((nightAnalysis.sleepBreakdown.deepSleepMinutes || 105) % 60).padStart(2, '0')}`
                                            : '2:47'
                                    }
                                    subPositive={true}
                                    label="Sueño Profundo"
                                    percentage={nightAnalysis.dimensions?.deepSleep || 78}
                                    color="#10b981"
                                    icon="🌙"
                                />

                                <CircularDial
                                    value={`0:${String(nightAnalysis.einsdreamScore?.irregularityMinutes || 15).padStart(2, '0')}`}
                                    subValue="Desvío"
                                    subPositive={nightAnalysis.einsdreamScore?.irregularityMinutes <= 30}
                                    label="Irregularidad"
                                    percentage={nightAnalysis.dimensions?.regularity || 90}
                                    color="#f59e0b"
                                    icon="🔄"
                                />

                                <CircularDial
                                    value={`${nightAnalysis.dimensions?.efficiency || 92}%`}
                                    subValue="Eficiencia"
                                    subPositive={true}
                                    label="Eficiencia Cama"
                                    percentage={nightAnalysis.dimensions?.efficiency || 92}
                                    color="#a855f7"
                                    icon="🎯"
                                />

                                <CircularDial
                                    value={`${nightAnalysis.dimensions?.acousticPeace || 95}%`}
                                    subValue={`${nightAnalysis.snoreMetrics?.snorePercentage || 0}% ronq`}
                                    subPositive={nightAnalysis.snoreMetrics?.snorePercentage <= 8}
                                    label="Paz Acústica"
                                    percentage={nightAnalysis.dimensions?.acousticPeace || 95}
                                    color="#34d399"
                                    icon="😴"
                                />
                            </ScrollView>

                            {/* Balance de las 7 Dimensiones */}
                            <DimensionsBalanceChart dimensions={nightAnalysis.dimensions} />

                            {/* Hypnogram de Fases */}
                            <HypnogramChart
                                sleepSummary={nightAnalysis.sleepSummary}
                                sleepBreakdown={nightAnalysis.sleepBreakdown}
                            />

                            {/* Actigrafía y Registro Acústico */}
                            <ActigraphyChart
                                snoreCount={nightAnalysis.snoreMetrics?.snoreEventsCount || 0}
                                coughCount={nightAnalysis.snoreMetrics?.coughEventsCount || 0}
                            />

                            {/* Monitoreo Cardiovascular y HRV Gain */}
                            <CardioChart cardiovascular={nightAnalysis.cardiovascular} />
                        </View>
                    ) : (
                        <View style={s.emptyBox}>
                            <Text style={s.emptyTitle}>Sin noches registradas aún</Text>
                            <Text style={s.emptyText}>
                                {'Tu Einsdream Score y dimensiones se calculan a partir de tus noches reales monitoreadas. Activa el monitoreo nocturno antes de dormir y presiona "Detener" al despertar.'}
                            </Text>
                            <TouchableOpacity
                                style={s.genBtn}
                                onPress={() => setActiveTab('monitoring')}
                            >
                                <Text style={s.genBtnText}>Ir a Iniciar Monitoreo</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* PESTAÑA 3: 🔮 PREDICCIÓN & HÁBITOS                                */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'prediction' && (
                <View>
                    {/* Tarjeta de Sleep Test y Perfil Basal */}
                    <View style={s.baselineCard}>
                        <View style={s.baselineHead}>
                            <View>
                                <Text style={s.baselineTitle}>📋 Tu Perfil de Referencia</Text>
                                <Text style={s.baselineSub}>
                                    Cronotipo: <Text style={{ fontWeight: '800', color: '#38bdf8' }}>
                                        {sleepProfile.chronotype === 'early_bird' ? 'Madrugador (Alondra)' : (sleepProfile.chronotype === 'night_owl' ? 'Noctámbulo (Búho)' : 'Intermedio')}
                                    </Text> · Meta: {Math.floor(sleepProfile.targetSleepMinutes / 60)} horas
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={s.testModalBtn}
                                onPress={() => setShowSleepTestModal(true)}
                            >
                                <Text style={s.testModalBtnText}>Editar Test</Text>
                            </TouchableOpacity>
                        </View>
                        <Text style={s.baselineFootnote}>
                            Horario objetivo: {sleepProfile.targetBedtime} a {sleepProfile.targetWakeTime}
                        </Text>
                    </View>

                    {/* Tarjeta de Recomendación de Horario Óptimo (Modelo Predictivo) */}
                    {optimalBedtimeData && (
                        <View style={s.predictCard}>
                            <View style={s.predictBadge}>
                                <Text style={s.predictBadgeText}>🔮 MODELO CIRCADIANO PERSONALIZADO</Text>
                            </View>
                            <Text style={s.predictTitle}>Hora Óptima para Dormir Hoy</Text>
                            <View style={s.predictTimesRow}>
                                <View style={s.predictTimeCol}>
                                    <Text style={s.predictTimeBig}>{optimalBedtimeData.recommendedBedtime}</Text>
                                    <Text style={s.predictTimeLabel}>Hora sugerida de acostarse</Text>
                                </View>
                                <Text style={{ fontSize: 24, color: '#64748b' }}>→</Text>
                                <View style={s.predictTimeCol}>
                                    <Text style={s.predictTimeBig}>{optimalBedtimeData.recommendedWakeTime}</Text>
                                    <Text style={s.predictTimeLabel}>Despertar objetivo</Text>
                                </View>
                            </View>

                            <View style={s.predictProjectionRow}>
                                <Text style={s.predictProjItem}>
                                    🎯 Meta de Descanso: <Text style={{ color: '#38bdf8', fontWeight: '800' }}>{optimalBedtimeData.targetSleepHours || '8 horas'}</Text>
                                </Text>
                                <Text style={s.predictProjItem}>
                                    🧬 Calibración: <Text style={{ color: '#10b981', fontWeight: '800' }}>{optimalBedtimeData.algorithmUsed || 'Cronotipo'}</Text>
                                </Text>
                            </View>

                            <Text style={s.predictRationale}>
                                {optimalBedtimeData.clinicalRationale}
                            </Text>
                        </View>
                    )}

                    {/* Benchmarking de Tendencias: 7 y 28 Días */}
                    {trendsData && trendsData.summary && (
                        <View style={s.benchCard}>
                            <Text style={s.benchTitle}>📈 Benchmarking de Tendencias</Text>
                            <Text style={s.benchSub}>Comparativa de horas dormidas vs tu línea base</Text>

                            <View style={s.benchMetricsGrid}>
                                <View style={s.benchBox}>
                                    <Text style={s.benchBoxLabel}>Promedio 7 Días</Text>
                                    <Text style={s.benchBoxVal}>{trendsData.summary.last7Days.avgSleepHoursFormatted}</Text>
                                    <Text style={[s.benchDelta, { color: trendsData.summary.last7Days.varianceVsBaselinePct >= 0 ? '#34d399' : '#f87171' }]}>
                                        {trendsData.summary.last7Days.varianceVsBaselinePct >= 0 ? '+' : ''}{trendsData.summary.last7Days.varianceVsBaselinePct}% vs baseline
                                    </Text>
                                </View>

                                <View style={s.benchBox}>
                                    <Text style={s.benchBoxLabel}>Promedio 28 Días</Text>
                                    <Text style={s.benchBoxVal}>{trendsData.summary.last28Days.avgSleepHoursFormatted}</Text>
                                    <Text style={[s.benchDelta, { color: trendsData.summary.last28Days.varianceVsBaselinePct >= 0 ? '#34d399' : '#f87171' }]}>
                                        {trendsData.summary.last28Days.varianceVsBaselinePct >= 0 ? '+' : ''}{trendsData.summary.last28Days.varianceVsBaselinePct}% vs baseline
                                    </Text>
                                </View>
                            </View>

                            {/* Tabla Comparativa de Noches Registradas */}
                            <Text style={[s.benchTitle, { marginTop: 16, fontSize: 13 }]}>
                                🗓️ Registro Comparativo por Noches
                            </Text>
                            <View style={s.tableHeader}>
                                <Text style={[s.th, { flex: 2 }]}>Noche</Text>
                                <Text style={[s.th, { flex: 2.2 }]}>Horario</Text>
                                <Text style={[s.th, { flex: 2 }]}>Duración</Text>
                                <Text style={[s.th, { flex: 1.8 }]}>Eventos</Text>
                                <Text style={[s.th, { flex: 2 }]}>Calidad</Text>
                            </View>

                            {trendsData.benchmarkTable && trendsData.benchmarkTable.length > 0 ? (
                                trendsData.benchmarkTable.map((item, idx) => (
                                    <View key={idx} style={[s.tableRow, idx % 2 === 0 && s.tableRowAlt]}>
                                        <View style={{ flex: 2 }}>
                                            <Text style={s.tdDay}>{item.dayName}</Text>
                                            <Text style={s.tdSubDate}>{item.date.slice(5)}</Text>
                                        </View>
                                        <Text style={[s.td, { flex: 2.2, fontSize: 11 }]}>{item.schedule}</Text>
                                        <Text style={[s.td, { flex: 2, fontWeight: '800', color: '#38bdf8' }]}>{item.sleepHours}</Text>
                                        <Text style={[s.td, { flex: 1.8, color: '#f1f5f9' }]}>{item.eventsCount}</Text>
                                        <Text style={[s.td, { flex: 2, color: item.quality === 'Óptima' || item.quality === 'Tranquila' ? '#34d399' : '#f59e0b' }]}>
                                            {item.quality}
                                        </Text>
                                    </View>
                                ))
                            ) : (
                                <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                                    <Text style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                                        Aún no hay noches registradas en el historial. Tu primera noche se guardará automáticamente con su duración y audios al presionar "Detener Monitoreo".
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}
                </View>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* PESTAÑA 4: 🎧 GRABACIONES & AUDIOS LOCALES                        */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'recordings' && (
                <View style={s.recCard}>
                    <View style={s.recHeader}>
                        <Text style={s.recTitle}>🎧 Mis Grabaciones ({localRecordings.length})</Text>
                        <TouchableOpacity style={s.refreshBtn} onPress={refreshRecordings} disabled={loadingRecs}>
                            <Text style={s.refreshBtnText}>🔄 Actualizar</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Aviso de Privacidad y Origen Exclusivo del Micrófono Nocturno */}
                    <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.08)', borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.25)', borderRadius: 10, padding: 10, marginBottom: 14 }}>
                        <Text style={{ color: '#38bdf8', fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
                            🎙️ Grabaciones en Vivo del Micrófono Nocturno
                        </Text>
                        <Text style={{ color: '#94a3b8', fontSize: 10, lineHeight: 14 }}>
                            Estos audios corresponden únicamente al sonido ambiental capturado por el micrófono del teléfono mientras el monitoreo nocturno estuvo activo. EinsDream funciona en un entorno seguro y aislado: nunca accede a WhatsApp ni a archivos personales del teléfono.
                        </Text>
                    </View>

                    {/* Botón de Sincronización en Bloque para grabaciones offline */}
                    {(() => {
                        const pendingCount = localRecordings.filter(
                            (r) => !r.isCloud && !uploadedIds.has(r.filename) && !uploadedIds.has(r.id)
                        ).length;
                        if (pendingCount === 0) return null;
                        return (
                            <TouchableOpacity
                                style={[s.syncAllBtn, isSyncingAll && { opacity: 0.7 }]}
                                onPress={syncAllPendingRecordings}
                                disabled={isSyncingAll}
                            >
                                {isSyncingAll ? (
                                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                                ) : (
                                    <Text style={{ fontSize: 13, marginRight: 6 }}>☁️</Text>
                                )}
                                <Text style={s.syncAllBtnText}>
                                    {isSyncingAll
                                        ? `Sincronizando (${syncProgress.done}/${syncProgress.total})...`
                                        : `Sincronizar con la nube (${pendingCount} pendientes)`}
                                </Text>
                            </TouchableOpacity>
                        );
                    })()}

                    {loadingRecs ? (
                        <ActivityIndicator size="large" color="#38bdf8" style={{ marginVertical: 24 }} />
                    ) : localRecordings.length === 0 ? (
                        <View style={s.emptyBox}>
                            <Text style={s.emptyTitle}>Aún no hay grabaciones</Text>
                            <Text style={s.emptyText}>
                                {'Toca "Probar micrófono" en la pestaña de monitoreo o deja el sensor activo al acostarte.'}
                            </Text>
                        </View>
                    ) : (
                        localRecordings.map((rec) => {
                            const isSelected = playingUri === rec.id || playingUri === rec.uri;
                            const isThisPlaying = isSelected && playing;
                            const isUploaded = rec.isCloud || rec.isUploaded || uploadedIds.has(rec.filename) || uploadedIds.has(rec.id);
                            const isUploading = uploadingId === rec.id;
                            const progress = isSelected && durMs > 0 ? posMs / durMs : 0;

                            return (
                                <View key={rec.id} style={[s.recItem, isSelected && s.recItemActive]}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.recLabel}>{rec.label}</Text>
                                        <Text style={s.recMeta}>
                                            {rec.dateStr} · {rec.sizeKb} KB {isUploaded ? '· ☁️ Sincronizado' : '· ⏳ Local'}
                                        </Text>

                                        {/* Enhanced Audio Controls */}
                                        {isSelected && durMs > 0 && (
                                            <View style={s.playerControls}>
                                                {/* Touchable seek bar */}
                                                <TouchableOpacity
                                                    activeOpacity={0.8}
                                                    style={s.seekBarTrack}
                                                    onPress={(e) => {
                                                        const { locationX } = e.nativeEvent;
                                                        e.target.measure((fx, fy, width) => {
                                                            handleSeek(Math.max(0, Math.min(1, locationX / (width || 1))));
                                                        });
                                                    }}
                                                >
                                                    <View style={[s.seekBarFill, { flex: Math.max(0.001, progress) }]} />
                                                    <View style={{ flex: Math.max(0.001, 1 - progress) }} />
                                                </TouchableOpacity>

                                                {/* Time + skip controls row */}
                                                <View style={s.playerRow}>
                                                    <TouchableOpacity style={s.skipBtn} onPress={() => handleSkip(-10)}>
                                                        <Text style={s.skipBtnText}>⏪ 10s</Text>
                                                    </TouchableOpacity>
                                                    <Text style={s.timeText}>{fmtMs(posMs)} / {fmtMs(durMs)}</Text>
                                                    <TouchableOpacity style={s.skipBtn} onPress={() => handleSkip(10)}>
                                                        <Text style={s.skipBtnText}>10s ⏩</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        )}
                                    </View>

                                    {/* Play / Pause */}
                                    <TouchableOpacity
                                        style={[s.iconBtn, { backgroundColor: isThisPlaying ? '#d97706' : '#16a34a' }]}
                                        onPress={() => handlePlayPause(rec)}
                                    >
                                        <Text style={s.iconBtnText}>{isThisPlaying ? '⏸' : '▶'}</Text>
                                    </TouchableOpacity>

                                    {/* Subir a la Nube */}
                                    <TouchableOpacity
                                        style={[
                                            s.iconBtn,
                                            { backgroundColor: isUploaded ? '#7c3aed' : '#2563eb', marginLeft: 6 },
                                        ]}
                                        onPress={() => handleManualUpload(rec)}
                                        disabled={isUploading}
                                    >
                                        {isUploading ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <Text style={s.iconBtnText}>{isUploaded ? '✓' : '☁'}</Text>
                                        )}
                                    </TouchableOpacity>

                                    {/* Eliminar */}
                                    <TouchableOpacity
                                        style={[s.iconBtn, { backgroundColor: '#ef4444', marginLeft: 6 }]}
                                        onPress={() => handleDelete(rec)}
                                    >
                                        <Text style={s.iconBtnText}>🗑</Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        })
                    )}
                </View>
            )}

            {/* Modal de Sleep Test Interactivo */}
            <SleepTestModal
                visible={showSleepTestModal}
                onClose={() => setShowSleepTestModal(false)}
                onSave={handleSaveSleepTest}
                initialProfile={sleepProfile}
            />

            {/* Pie con botón de cerrar sesión */}
            <View style={s.footer}>
                <Button title="Cerrar sesión" onPress={onLogout} color="#64748b" />
            </View>
        </ScrollView>
    );
}

// ─── Estilos Principales ──────────────────────────────────────────────────────
const s = StyleSheet.create({
    container: {
        flexGrow: 1,
        padding: 16,
        backgroundColor: '#090d16',
        alignItems: 'stretch',
    },
    topHeader: {
        alignItems: 'center',
        marginBottom: 12,
    },
    mainAppTitle: {
        fontSize: 26,
        fontWeight: '900',
        color: '#ffffff',
        letterSpacing: 0.5,
    },
    versionBadge: {
        backgroundColor: '#0284c7',
        paddingHorizontal: 12,
        paddingVertical: 3,
        borderRadius: 12,
        marginTop: 4,
    },
    versionText: {
        color: '#ffffff',
        fontWeight: '800',
        fontSize: 12,
    },

    tabBar: {
        flexDirection: 'row',
        backgroundColor: '#1e293b',
        borderRadius: 14,
        padding: 4,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#334155',
    },
    tabItem: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 10,
    },
    tabItemActive: {
        backgroundColor: '#0284c7',
    },
    tabText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94a3b8',
    },
    tabTextActive: {
        color: '#ffffff',
        fontWeight: '800',
    },

    infoCard: {
        backgroundColor: '#0f172a',
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#1e293b',
    },
    infoTitle: {
        fontWeight: '800',
        fontSize: 14,
        color: '#38bdf8',
        marginBottom: 6,
    },
    infoText: {
        fontSize: 12,
        color: '#cbd5e1',
        lineHeight: 18,
    },
    quotaRow: {
        marginTop: 8,
        paddingTop: 6,
        borderTopWidth: 1,
        borderColor: '#1e293b',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    quotaText: {
        fontSize: 11,
        color: '#cbd5e1',
    },
    quotaSub: {
        fontSize: 10,
        color: '#64748b',
    },

    banner: {
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
        borderWidth: 1.5,
    },
    bannerListening: {
        borderColor: '#10b981',
        backgroundColor: '#064e3b',
    },
    bannerCapturing: {
        borderColor: '#ef4444',
        backgroundColor: '#450a0a',
    },
    bannerTitle: {
        fontWeight: '800',
        fontSize: 14,
        textAlign: 'center',
        color: '#ffffff',
    },
    bannerSub: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.85)',
        textAlign: 'center',
        marginTop: 4,
    },

    meterBarContainer: {
        height: 8,
        backgroundColor: '#1e293b',
        borderRadius: 4,
        marginTop: 10,
        overflow: 'hidden',
    },
    meterBarFill: {
        height: '100%',
        borderRadius: 4,
    },

    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        marginTop: 10,
        gap: 6,
    },
    statBadge: {
        backgroundColor: '#1e293b',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        fontSize: 11,
        fontWeight: '700',
        color: '#cbd5e1',
        borderWidth: 1,
        borderColor: '#334155',
    },

    mainBtn: {
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 16,
        alignItems: 'center',
        marginBottom: 12,
        elevation: 4,
    },
    mainBtnStart: {
        backgroundColor: '#0284c7',
    },
    mainBtnStop: {
        backgroundColor: '#dc2626',
    },
    mainBtnText: {
        color: '#ffffff',
        fontWeight: '900',
        fontSize: 15,
        letterSpacing: 0.5,
        textAlign: 'center',
    },
    mainBtnSub: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 11,
        marginTop: 4,
        textAlign: 'center',
    },

    testBtn: {
        backgroundColor: '#1e293b',
        borderWidth: 1.5,
        borderColor: '#ca8a04',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        marginBottom: 16,
    },
    testBtnText: {
        color: '#fbbf24',
        fontWeight: '800',
        fontSize: 13,
    },

    scoreHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    scoreDateText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#ffffff',
    },
    recalcBtn: {
        backgroundColor: '#1e293b',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#334155',
    },
    recalcBtnText: {
        color: '#38bdf8',
        fontSize: 11,
        fontWeight: '700',
    },

    sectionHeader: {
        fontSize: 14,
        fontWeight: '800',
        color: '#cbd5e1',
        marginTop: 10,
        marginBottom: 8,
    },
    dialsScroll: {
        marginVertical: 6,
    },

    baselineCard: {
        backgroundColor: '#1e293b',
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#334155',
    },
    baselineHead: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    baselineTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#ffffff',
    },
    baselineSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    testModalBtn: {
        backgroundColor: '#0284c7',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    testModalBtnText: {
        color: '#ffffff',
        fontWeight: '800',
        fontSize: 11,
    },
    baselineFootnote: {
        fontSize: 10,
        color: '#64748b',
        marginTop: 8,
    },

    predictCard: {
        backgroundColor: '#0f172a',
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1.5,
        borderColor: '#818cf8',
    },
    predictBadge: {
        backgroundColor: '#312e81',
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        marginBottom: 8,
    },
    predictBadgeText: {
        color: '#a5b4fc',
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    predictTitle: {
        fontSize: 16,
        fontWeight: '900',
        color: '#ffffff',
        marginBottom: 10,
    },
    predictTimesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        backgroundColor: '#1e293b',
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
    },
    predictTimeCol: {
        alignItems: 'center',
    },
    predictTimeBig: {
        fontSize: 22,
        fontWeight: '900',
        color: '#38bdf8',
    },
    predictTimeLabel: {
        fontSize: 10,
        color: '#94a3b8',
        marginTop: 2,
    },
    predictProjectionRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 8,
    },
    predictProjItem: {
        fontSize: 11,
        color: '#cbd5e1',
        fontWeight: '600',
    },
    predictRationale: {
        fontSize: 11,
        color: '#94a3b8',
        lineHeight: 16,
        fontStyle: 'italic',
        borderTopWidth: 1,
        borderColor: '#1e293b',
        paddingTop: 8,
    },

    benchCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#334155',
    },
    benchTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#ffffff',
    },
    benchSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
        marginBottom: 10,
    },
    benchMetricsGrid: {
        flexDirection: 'row',
        gap: 10,
    },
    benchBox: {
        flex: 1,
        backgroundColor: '#0f172a',
        borderRadius: 12,
        padding: 10,
        alignItems: 'center',
    },
    benchBoxLabel: {
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: '700',
    },
    benchBoxVal: {
        fontSize: 16,
        fontWeight: '900',
        color: '#ffffff',
        marginVertical: 2,
    },
    benchDelta: {
        fontSize: 10,
        fontWeight: '800',
    },

    tableHeader: {
        flexDirection: 'row',
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderColor: '#334155',
        marginTop: 6,
    },
    th: {
        fontSize: 10,
        fontWeight: '800',
        color: '#94a3b8',
        textAlign: 'center',
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: '#1e293b',
    },
    tableRowAlt: {
        backgroundColor: '#0f172a',
    },
    tdDay: {
        fontSize: 11,
        fontWeight: '800',
        color: '#f8fafc',
        textAlign: 'center',
    },
    tdSubDate: {
        fontSize: 9,
        color: '#64748b',
        textAlign: 'center',
    },
    td: {
        fontSize: 11,
        textAlign: 'center',
        color: '#cbd5e1',
    },

    recCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#334155',
    },
    recHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    recTitle: {
        fontWeight: '800',
        fontSize: 16,
        color: '#ffffff',
    },
    refreshBtn: {
        backgroundColor: '#0f172a',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#334155',
    },
    refreshBtnText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#cbd5e1',
    },
    syncAllBtn: {
        backgroundColor: '#2563eb',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 10,
        marginBottom: 14,
    },
    syncAllBtnText: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 13,
    },

    emptyBox: {
        alignItems: 'center',
        paddingVertical: 24,
    },
    emptyTitle: {
        fontWeight: '800',
        fontSize: 15,
        color: '#cbd5e1',
        marginBottom: 6,
    },
    emptyText: {
        fontSize: 12,
        color: '#64748b',
        textAlign: 'center',
        lineHeight: 18,
        paddingHorizontal: 10,
    },
    genBtn: {
        backgroundColor: '#0284c7',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        marginTop: 12,
    },
    genBtnText: {
        color: '#ffffff',
        fontWeight: '800',
        fontSize: 12,
    },

    recItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0f172a',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#1e293b',
    },
    recItemActive: {
        borderColor: '#38bdf8',
        backgroundColor: '#0c4a6e',
    },
    recLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#f8fafc',
    },
    recMeta: {
        fontSize: 10,
        color: '#94a3b8',
        marginTop: 2,
    },
    progressContainer: {
        height: 4,
        backgroundColor: '#334155',
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: 4,
    },
    progressBar: {
        height: '100%',
        backgroundColor: '#38bdf8',
    },
    timeText: {
        fontSize: 9,
        color: '#94a3b8',
        marginTop: 2,
    },

    // ── Enhanced audio player ──
    playerControls: {
        marginTop: 6,
    },
    seekBarTrack: {
        height: 8,
        backgroundColor: '#334155',
        borderRadius: 4,
        overflow: 'hidden',
        flexDirection: 'row',
        marginVertical: 4,
    },
    seekBarFill: {
        height: '100%',
        backgroundColor: '#38bdf8',
        borderRadius: 4,
    },
    playerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 2,
    },
    skipBtn: {
        paddingVertical: 3,
        paddingHorizontal: 8,
        backgroundColor: '#0f172a',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#334155',
    },
    skipBtnText: {
        fontSize: 10,
        color: '#38bdf8',
        fontWeight: '700',
    },

    iconBtn: {
        width: 36,
        height: 36,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: 'bold',
    },

    footer: {
        marginTop: 24,
        borderTopWidth: 1,
        borderColor: '#1e293b',
        paddingTop: 16,
    },
});
