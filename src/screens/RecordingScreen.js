/**
 * RecordingScreen.js - EinsDream Mobile v2.1.0
 *
 * ARQUITECTURA DE GRABACIÓN:
 * - Modo Nocturno Local: Grabación continua en segmentos de 30s.
 *   Cada segmento se guarda en FileSystem.documentDirectory como
 *   "night_YYYYMMDD_HH_seg00X.m4a" y aparece inmediatamente en la lista.
 *
 * - Auto-Agent (Nube): VAD silencioso. Graba chunk de 8s, guarda local
 *   (auto_event_TIMESTAMP.m4a) y sube a la nube sin ninguna alerta.
 *
 * - Prueba rápida: 5 segundos, se guarda y se reproduce automáticamente.
 *
 * UBICACIÓN FÍSICA en el teléfono:
 *   Android: /data/data/host.exp.exponent/files/  (interno, privado)
 *   Accesible desde la app siempre. No requiere permisos de almacenamiento externo.
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
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import CONFIG from '../config';

const { API_URL, BASE_URL } = CONFIG;
const FULL_BASE_URL = BASE_URL || 'https://einsdreambcknd.vercel.app';

// ─── Recording Quality ────────────────────────────────────────────────────────
// Mono AAC MPEG-4: máxima compatibilidad Huawei / EMUI, reproduce en web
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

// Segmento nocturno en segundos. 30s es el equilibrio óptimo:
// - Evita que Android mate el proceso de MediaRecorder (que ocurre con grabaciones largas)
// - Genera archivos manejables de ~350 KB por segmento
const NIGHT_SEGMENT_SECONDS = 30;
const AUTO_CHUNK_SECONDS = 8;
const NOISE_THRESHOLD_DB = -35;

// ─── Helper ───────────────────────────────────────────────────────────────────
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

const friendlyDate = (filename) => {
    // night_20260903_22_seg001.m4a → Noche 03 sep 22:XX seg 1
    const nightMatch = filename.match(/night_(\d{4})(\d{2})(\d{2})_(\d{2})_seg(\d+)/);
    if (nightMatch) {
        const [, , mm, dd, hh, seg] = nightMatch;
        return `Noche ${dd}/${mm} ${hh}:xx · seg ${parseInt(seg)}`;
    }
    // auto_event_1725408000000.m4a
    const autoMatch = filename.match(/auto_event_(\d+)/);
    if (autoMatch) {
        const d = new Date(parseInt(autoMatch[1]));
        return `Auto ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    // manual_record_1725408000000.m4a (prueba / legado)
    const manualMatch = filename.match(/manual_record_(\d+)/);
    if (manualMatch) {
        const d = new Date(parseInt(manualMatch[1]));
        return `Prueba ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return filename;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function RecordingScreen({ token, onLogout }) {
    // ── State ────────────────────────────────────────────────────────────────
    const [localRecordings, setLocalRecordings] = useState([]);
    const [loadingRecs, setLoadingRecs] = useState(false);

    const [nightActive, setNightActive] = useState(false);
    const [nightSeconds, setNightSeconds] = useState(0);
    const [nightSegmentCount, setNightSegmentCount] = useState(0);

    const [autoActive, setAutoActive] = useState(false);
    const [autoRecording, setAutoRecording] = useState(false);
    const [autoEventCount, setAutoEventCount] = useState(0);
    const [meteringDb, setMeteringDb] = useState(-160);

    const [isTesting, setIsTesting] = useState(false);
    const [testCountdown, setTestCountdown] = useState(5);

    const [playingUri, setPlayingUri] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [posMs, setPosMs] = useState(0);
    const [durMs, setDurMs] = useState(0);
    const [uploadingId, setUploadingId] = useState(null);
    const [uploadedIds, setUploadedIds] = useState(new Set());

    // ── Refs (survive re-renders, safe for async callbacks) ─────────────────
    const nightActiveRef = useRef(false);
    const autoActiveRef = useRef(false);
    const isCapturingRef = useRef(false);

    const nightRecRef = useRef(null);       // current segment recording
    const nightTimerRef = useRef(null);     // countdown interval
    const nightSegTimerRef = useRef(null);  // segment boundary timeout
    const nightDateRef = useRef('');        // YYYYMMDD_HH for filename
    const nightSegRef = useRef(0);          // segment counter

    const autoListenerRef = useRef(null);   // VAD recording
    const autoRecRef = useRef(null);        // chunk recording

    const testRecRef = useRef(null);
    const testTimerRef = useRef(null);

    const soundRef = useRef(null);

    // ── Initial setup ────────────────────────────────────────────────────────
    useEffect(() => {
        requestMicPermission();
        refreshRecordings();
        return () => { stopAll(); unloadSound(); };
    }, []);

    const requestMicPermission = async () => {
        await Audio.requestPermissionsAsync();
        await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: true,
            playThroughEarpieceAndroid: false,
        });
    };

    // ── Recordings list ──────────────────────────────────────────────────────
    const refreshRecordings = useCallback(async () => {
        setLoadingRecs(true);
        try {
            const dir = FileSystem.documentDirectory;
            const allFiles = await FileSystem.readDirectoryAsync(dir);
            const audioFiles = [];

            for (const filename of allFiles) {
                if (!filename.endsWith('.m4a') && !filename.endsWith('.mp3')) continue;
                const uri = dir + filename;
                const info = await FileSystem.getInfoAsync(uri, { size: true });
                if (!info.exists) continue;

                const sizeMb = info.size ? (info.size / (1024 * 1024)).toFixed(2) : '?';
                const label = friendlyDate(filename);

                audioFiles.push({
                    id: filename,
                    filename,
                    uri,
                    label,
                    sizeMb,
                    modTime: info.modificationTime || 0,
                    size: info.size || 0,
                });
            }

            audioFiles.sort((a, b) => b.modTime - a.modTime);
            setLocalRecordings(audioFiles);
        } catch (err) {
            console.warn('[refreshRecordings]', err.message);
        } finally {
            setLoadingRecs(false);
        }
    }, []);

    // ── Player ───────────────────────────────────────────────────────────────
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
            // Switch track
            if (playingUri !== rec.uri) {
                await unloadSound();
                // Switch audio mode to playback
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: false,
                    shouldDuckAndroid: false,
                    playThroughEarpieceAndroid: false,
                });
                const { sound } = await Audio.Sound.createAsync(
                    { uri: rec.uri },
                    { shouldPlay: true, progressUpdateIntervalMillis: 300 },
                    (status) => {
                        if (status.isLoaded) {
                            setPosMs(status.positionMillis || 0);
                            setDurMs(status.durationMillis || 0);
                            setPlaying(status.isPlaying);
                            if (status.didJustFinish) { setPosMs(0); setPlaying(false); }
                        }
                    }
                );
                soundRef.current = sound;
                setPlayingUri(rec.uri);
                setPlaying(true);
                return;
            }
            // Toggle same track
            if (playing) {
                await soundRef.current?.pauseAsync();
                setPlaying(false);
            } else {
                await soundRef.current?.playAsync();
                setPlaying(true);
            }
        } catch (err) {
            console.warn('[handlePlayPause]', err.message);
            Alert.alert('Error al reproducir', err.message);
        } finally {
            // Restore recording mode
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });
        }
    };

    const handleDelete = async (rec) => {
        Alert.alert('Eliminar grabación', `¿Eliminar ${rec.label}?`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Eliminar', style: 'destructive',
                onPress: async () => {
                    if (playingUri === rec.uri) await unloadSound();
                    await FileSystem.deleteAsync(rec.uri, { idempotent: true }).catch(() => {});
                    refreshRecordings();
                }
            }
        ]);
    };

    // ── Cloud Upload ─────────────────────────────────────────────────────────
    const uploadToCloud = async (fileUri, filename, eventType = 'auto-agent') => {
        try {
            // Read base64 from local file
            const b64 = await FileSystem.readAsStringAsync(fileUri, {
                encoding: FileSystem.EncodingType.Base64
            });
            const audioBase64 = `data:audio/m4a;base64,${b64}`;

            // Get upload token/endpoint from backend
            const initRes = await axios.post(`${API_URL}/upload/init`,
                { filename, contentType: 'audio/m4a' },
                { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
            );

            const { url, fileKey, provider } = initRes.data;

            if (provider === 'local') {
                // For Vercel serverless: send as multipart + base64 payload
                const formData = new FormData();
                formData.append('audio', {
                    uri: fileUri,
                    name: filename,
                    type: 'audio/m4a',
                });
                const uploadRes = await axios.post(
                    url.startsWith('http') ? url : `${FULL_BASE_URL}${url}`,
                    formData,
                    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }, timeout: 30000 }
                );
                const finalKey = uploadRes.data.fileKey || fileKey;
                await axios.post(`${API_URL}/upload/metadata`, {
                    s3Key: finalKey,
                    audioBase64,
                    duration: eventType === 'auto-agent' ? AUTO_CHUNK_SECONDS : NIGHT_SEGMENT_SECONDS,
                    deviceModel: Platform.OS === 'android' ? 'android' : 'ios',
                    eventType,
                }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
            } else {
                // S3/GCS: PUT raw bytes then save metadata
                const endpoint = url.startsWith('http') ? url : `${FULL_BASE_URL}${url}`;
                await fetch(endpoint, {
                    method: initRes.data.uploadMethod || 'PUT',
                    headers: { 'Content-Type': 'audio/m4a' },
                    body: Uint8Array.from(atob(b64), c => c.charCodeAt(0)),
                });
                await axios.post(`${API_URL}/upload/metadata`, {
                    s3Key: fileKey,
                    audioBase64,
                    duration: eventType === 'auto-agent' ? AUTO_CHUNK_SECONDS : NIGHT_SEGMENT_SECONDS,
                    deviceModel: Platform.OS === 'android' ? 'android' : 'ios',
                    eventType,
                }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
            }

            return true;
        } catch (err) {
            console.warn(`[uploadToCloud] ${filename}:`, err.message);
            return false;
        }
    };

    const handleManualUpload = async (rec) => {
        if (uploadingId === rec.id || uploadedIds.has(rec.id)) return;
        setUploadingId(rec.id);
        const ok = await uploadToCloud(rec.uri, rec.filename, 'manual');
        setUploadingId(null);
        if (ok) {
            setUploadedIds(prev => new Set([...prev, rec.id]));
            Alert.alert('✅ Subido a la nube', `${rec.label} está ahora disponible en el Dashboard web.`);
        } else {
            Alert.alert('Error de subida', 'No se pudo subir. Comprueba la conexión e intenta de nuevo.');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // MODO 1: GRABACIÓN NOCTURNA CONTINUA (segmentada c/30s)
    // ═══════════════════════════════════════════════════════════════════════
    const startNightRecording = async () => {
        const perm = await Audio.requestPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Sin permiso de micrófono', 'Ve a Ajustes → Apps → EinsDream → Permisos y activa el micrófono.');
            return;
        }
        if (autoActiveRef.current) await stopAutoAgent();
        await unloadSound();

        nightActiveRef.current = true;
        nightSegRef.current = 0;
        setNightActive(true);
        setNightSeconds(0);
        setNightSegmentCount(0);

        // Timestamp for filename prefix  e.g. 20260903_22
        const now = new Date();
        nightDateRef.current = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}`;

        // Wall-clock counter
        nightTimerRef.current = setInterval(() => setNightSeconds(s => s + 1), 1000);

        recordNightSegment();
    };

    const recordNightSegment = async () => {
        if (!nightActiveRef.current) return;

        try {
            // Ensure recording mode
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });

            const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
            nightRecRef.current = recording;

            // After NIGHT_SEGMENT_SECONDS, stop and immediately start the next segment
            nightSegTimerRef.current = setTimeout(async () => {
                if (!nightActiveRef.current) return;
                await finishNightSegment(false);
            }, NIGHT_SEGMENT_SECONDS * 1000);
        } catch (err) {
            console.warn('[recordNightSegment] start error:', err.message);
            if (nightActiveRef.current) {
                // Retry after 1 second
                setTimeout(() => recordNightSegment(), 1000);
            }
        }
    };

    const finishNightSegment = async (isFinalStop) => {
        if (nightSegTimerRef.current) { clearTimeout(nightSegTimerRef.current); nightSegTimerRef.current = null; }
        const rec = nightRecRef.current;
        nightRecRef.current = null;
        if (!rec) return;

        try {
            await rec.stopAndUnloadAsync();
            const tempUri = rec.getURI();
            if (!tempUri) {
                console.warn('[finishNightSegment] getURI returned null');
                if (!isFinalStop && nightActiveRef.current) recordNightSegment();
                return;
            }

            nightSegRef.current += 1;
            const segNum = String(nightSegRef.current).padStart(3, '0');
            const destFilename = `night_${nightDateRef.current}_seg${segNum}.m4a`;
            const destUri = FileSystem.documentDirectory + destFilename;

            // Copy to permanent location
            await FileSystem.copyAsync({ from: tempUri, to: destUri });

            // Update list immediately
            setNightSegmentCount(nightSegRef.current);
            refreshRecordings();  // non-blocking, will update state when done

            // Silent background upload (don't await - never blocks the next segment)
            uploadToCloud(destUri, destFilename, 'auto-agent').then((ok) => {
                if (ok) console.log(`[night] segment ${segNum} uploaded`);
            });

            if (!isFinalStop && nightActiveRef.current) {
                recordNightSegment();
            }
        } catch (err) {
            console.warn('[finishNightSegment] error:', err.message);
            if (!isFinalStop && nightActiveRef.current) {
                setTimeout(() => recordNightSegment(), 500);
            }
        }
    };

    const stopNightRecording = async () => {
        nightActiveRef.current = false;
        setNightActive(false);
        if (nightTimerRef.current) { clearInterval(nightTimerRef.current); nightTimerRef.current = null; }
        await finishNightSegment(true);
        await refreshRecordings();
        Alert.alert(
            '✅ Noche guardada',
            `Se guardaron ${nightSegRef.current} segmentos de audio en tu teléfono.\n\n` +
            `Los archivos están en la lista "🎧 Mis Grabaciones" abajo.\n\n` +
            `Cada segmento también se subió silenciosamente al Dashboard web.`
        );
    };

    // ═══════════════════════════════════════════════════════════════════════
    // MODO 2: AUTO-AGENT (VAD silencioso + chunk 8s a la nube)
    // ═══════════════════════════════════════════════════════════════════════
    const startAutoAgent = async () => {
        const perm = await Audio.requestPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Sin permiso de micrófono', 'Activa el micrófono en los ajustes del sistema.');
            return;
        }
        if (nightActiveRef.current) await stopNightRecording();
        await unloadSound();

        autoActiveRef.current = true;
        isCapturingRef.current = false;
        setAutoActive(true);
        setAutoEventCount(0);
        setMeteringDb(-160);

        listenForNoise();
    };

    const listenForNoise = async () => {
        if (!autoActiveRef.current) return;
        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });

            if (autoListenerRef.current) {
                try { await autoListenerRef.current.stopAndUnloadAsync(); } catch (_) {}
                autoListenerRef.current = null;
            }

            const { recording } = await Audio.Recording.createAsync(
                RECORDING_OPTIONS,
                (status) => {
                    if (status.metering !== undefined) {
                        setMeteringDb(Math.round(status.metering));
                        if (status.metering > NOISE_THRESHOLD_DB && !isCapturingRef.current && autoActiveRef.current) {
                            captureAutoChunk();
                        }
                    }
                },
                500
            );
            autoListenerRef.current = recording;
        } catch (err) {
            console.warn('[listenForNoise] retry:', err.message);
            if (autoActiveRef.current) setTimeout(() => listenForNoise(), 1500);
        }
    };

    const captureAutoChunk = async () => {
        if (isCapturingRef.current || !autoActiveRef.current) return;
        isCapturingRef.current = true;
        setAutoRecording(true);

        // Let the current VAD recording capture the event for AUTO_CHUNK_SECONDS
        await new Promise(r => setTimeout(r, AUTO_CHUNK_SECONDS * 1000));
        if (!autoActiveRef.current) { isCapturingRef.current = false; setAutoRecording(false); return; }

        // Grab what was recorded by the VAD listener
        const rec = autoListenerRef.current;
        autoListenerRef.current = null;
        let savedOk = false;

        if (rec) {
            try {
                await rec.stopAndUnloadAsync();
                const tempUri = rec.getURI();
                if (tempUri) {
                    const ts = Date.now();
                    const filename = `auto_event_${ts}.m4a`;
                    const destUri = FileSystem.documentDirectory + filename;
                    await FileSystem.copyAsync({ from: tempUri, to: destUri });
                    savedOk = true;
                    setAutoEventCount(c => c + 1);
                    refreshRecordings();
                    // Upload in background
                    uploadToCloud(destUri, filename, 'auto-agent').then(ok => {
                        if (ok) console.log('[auto] event uploaded:', filename);
                    });
                }
            } catch (err) {
                console.warn('[captureAutoChunk] save/upload error:', err.message);
            }
        }

        isCapturingRef.current = false;
        setAutoRecording(false);
        // Resume listening
        if (autoActiveRef.current) listenForNoise();
    };

    const stopAutoAgent = async () => {
        autoActiveRef.current = false;
        isCapturingRef.current = false;
        setAutoActive(false);
        setAutoRecording(false);
        setMeteringDb(-160);
        if (autoListenerRef.current) {
            try { await autoListenerRef.current.stopAndUnloadAsync(); } catch (_) {}
            autoListenerRef.current = null;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // MODO 3: PRUEBA RÁPIDA DE VOZ (5 SEGUNDOS)
    // ═══════════════════════════════════════════════════════════════════════
    const runVoiceTest = async () => {
        if (isTesting) return;
        const perm = await Audio.requestPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Sin permiso de micrófono'); return;
        }
        if (nightActiveRef.current) await stopNightRecording();
        if (autoActiveRef.current) await stopAutoAgent();
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
                        if (!tempUri) { Alert.alert('Error', 'No se generó el archivo de audio.'); return; }

                        const ts = Date.now();
                        const filename = `manual_record_${ts}.m4a`;
                        const destUri = FileSystem.documentDirectory + filename;
                        await FileSystem.copyAsync({ from: tempUri, to: destUri });
                        await refreshRecordings();

                        // Auto-play immediately
                        setTimeout(() => handlePlayPause({ id: filename, uri: destUri, label: 'Prueba de voz', filename }), 400);
                        Alert.alert('🎉 ¡Prueba exitosa!', 'Tu voz quedó grabada y se está reproduciendo ahora. También aparece en "Mis Grabaciones" abajo.');
                    } catch (err) {
                        console.warn('[voiceTest finish]', err.message);
                        Alert.alert('Aviso', 'Prueba completada. Revisa la lista de grabaciones.');
                        await refreshRecordings();
                    }
                }
            }, 1000);
        } catch (err) {
            setIsTesting(false);
            console.warn('[runVoiceTest]', err.message);
            Alert.alert('Error', 'No se pudo iniciar la prueba: ' + err.message);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // stopAll
    // ═══════════════════════════════════════════════════════════════════════
    const stopAll = async () => {
        if (nightActiveRef.current) await stopNightRecording();
        else if (autoActiveRef.current) await stopAutoAgent();
        if (testTimerRef.current) { clearInterval(testTimerRef.current); testTimerRef.current = null; }
        if (testRecRef.current) {
            try { await testRecRef.current.stopAndUnloadAsync(); } catch (_) {}
            testRecRef.current = null;
        }
        setIsTesting(false);
    };

    // ─── Render ──────────────────────────────────────────────────────────────
    const anyActive = nightActive || autoActive;

    return (
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>EinsDream Mobile</Text>

            {/* ─── Info card ──────────────────────────────────────────────── */}
            <View style={s.infoCard}>
                <Text style={s.infoTitle}>📁 Dónde se guardan tus grabaciones</Text>
                <Text style={s.infoText}>
                    Todos los audios se guardan de forma permanente en la memoria interna del teléfono
                    (almacenamiento privado de la app). Puedes escucharlos en cualquier momento en la lista
                    de abajo, aunque estés sin internet.
                </Text>
                <Text style={s.infoPath}>
                    Android: /data/data/host.exp.exponent/files/
                </Text>
            </View>

            {/* ─── Status banner ──────────────────────────────────────────── */}
            {isTesting && (
                <View style={[s.banner, { borderColor: '#ef4444', backgroundColor: '#fff1f2' }]}>
                    <Text style={[s.bannerTitle, { color: '#b91c1c' }]}>
                        🔴 GRABANDO PRUEBA ({testCountdown}s) — ¡Habla ahora!
                    </Text>
                </View>
            )}
            {nightActive && (
                <View style={[s.banner, { borderColor: '#2563eb', backgroundColor: '#eff6ff' }]}>
                    <Text style={[s.bannerTitle, { color: '#1d4ed8' }]}>
                        🔴 GRABACIÓN NOCTURNA — {fmtTime(nightSeconds)}
                    </Text>
                    <Text style={s.bannerSub}>
                        Segmentos guardados: {nightSegmentCount} · Cada segmento ~30 seg
                    </Text>
                    <Text style={s.bannerSub}>
                        Cada segmento se guarda en tu teléfono y se sube al Dashboard automáticamente.
                    </Text>
                </View>
            )}
            {autoActive && (
                <View style={[s.banner, { borderColor: '#10b981', backgroundColor: '#f0fdf4' }]}>
                    <Text style={[s.bannerTitle, { color: '#065f46' }]}>
                        {autoRecording ? '🔴 CAPTURANDO EVENTO DE RUIDO...' : `👂 MONITOREANDO EN SILENCIO (${meteringDb} dB)`}
                    </Text>
                    <Text style={s.bannerSub}>Eventos capturados esta noche: {autoEventCount}</Text>
                </View>
            )}

            {/* ─── Main action buttons ─────────────────────────────────────── */}
            <View style={s.btnGroup}>
                {!anyActive && !isTesting && (
                    <>
                        <TouchableOpacity style={[s.mainBtn, { backgroundColor: '#2563EB' }]} onPress={startNightRecording}>
                            <Text style={s.mainBtnIcon}>🌙</Text>
                            <Text style={s.mainBtnText}>GRABAR TODA LA NOCHE</Text>
                            <Text style={s.mainBtnSub}>Continuo, segmentado c/30s — Sin interrupciones</Text>
                        </TouchableOpacity>

                        <View style={{ height: 12 }} />

                        <TouchableOpacity style={[s.mainBtn, { backgroundColor: '#10B981' }]} onPress={startAutoAgent}>
                            <Text style={s.mainBtnIcon}>☁️</Text>
                            <Text style={s.mainBtnText}>AUTO-AGENT (DETECTAR RUIDOS)</Text>
                            <Text style={s.mainBtnSub}>Graba solo cuando detecta ronquidos — Sube solo</Text>
                        </TouchableOpacity>
                    </>
                )}

                {anyActive && !isTesting && (
                    <TouchableOpacity style={[s.mainBtn, { backgroundColor: '#DC2626' }]} onPress={stopAll}>
                        <Text style={s.mainBtnIcon}>⏹️</Text>
                        <Text style={s.mainBtnText}>DETENER Y GUARDAR</Text>
                        <Text style={s.mainBtnSub}>Finaliza la noche — El audio queda en "Mis Grabaciones"</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* ─── Recordings list ─────────────────────────────────────────── */}
            <View style={s.recCard}>
                <View style={s.recHeader}>
                    <Text style={s.recTitle}>🎧 Mis Grabaciones ({localRecordings.length})</Text>
                    <TouchableOpacity style={s.refreshBtn} onPress={refreshRecordings}>
                        <Text style={s.refreshBtnText}>🔄 Actualizar</Text>
                    </TouchableOpacity>
                </View>

                {/* Voice test button */}
                <TouchableOpacity
                    style={[s.testBtn, isTesting && { backgroundColor: '#fef9c3', borderColor: '#eab308' }]}
                    onPress={runVoiceTest}
                    disabled={isTesting}
                >
                    {isTesting
                        ? <ActivityIndicator color="#ca8a04" />
                        : <Text style={s.testBtnText}>🎙 Probar micrófono (grabar 5 seg de voz)</Text>
                    }
                </TouchableOpacity>

                <View style={{ height: 12 }} />

                {loadingRecs ? (
                    <ActivityIndicator size="large" color="#2563EB" style={{ marginVertical: 24 }} />
                ) : localRecordings.length === 0 ? (
                    <View style={s.emptyBox}>
                        <Text style={s.emptyTitle}>Aún no hay grabaciones</Text>
                        <Text style={s.emptyText}>
                            Toca "GRABAR TODA LA NOCHE" al acostarte.{'\n'}
                            Los audios aparecerán aquí en tiempo real.
                        </Text>
                    </View>
                ) : (
                    localRecordings.map(rec => {
                        const isSelected = playingUri === rec.uri;
                        const isThisPlaying = isSelected && playing;
                        const isUploaded = uploadedIds.has(rec.id);
                        const isUploading = uploadingId === rec.id;

                        return (
                            <View key={rec.id} style={[s.recItem, isSelected && s.recItemActive]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.recLabel}>{rec.label}</Text>
                                    <Text style={s.recMeta}>{rec.sizeMb} MB</Text>
                                    {isSelected && (
                                        <Text style={s.recProgress}>
                                            {isThisPlaying ? '▶ ' : '⏸ '}{fmtMs(posMs)} / {fmtMs(durMs)}
                                        </Text>
                                    )}
                                </View>

                                {/* Play/Pause */}
                                <TouchableOpacity
                                    style={[s.iconBtn, { backgroundColor: isThisPlaying ? '#f59e0b' : '#10b981' }]}
                                    onPress={() => handlePlayPause(rec)}
                                >
                                    <Text style={s.iconBtnText}>{isThisPlaying ? '⏸' : '▶'}</Text>
                                </TouchableOpacity>

                                {/* Upload */}
                                <TouchableOpacity
                                    style={[s.iconBtn, { backgroundColor: isUploaded ? '#6366f1' : '#3b82f6', marginLeft: 6 }]}
                                    onPress={() => handleManualUpload(rec)}
                                    disabled={isUploaded || isUploading}
                                >
                                    {isUploading
                                        ? <ActivityIndicator size="small" color="#fff" />
                                        : <Text style={s.iconBtnText}>{isUploaded ? '✓' : '☁'}</Text>
                                    }
                                </TouchableOpacity>

                                {/* Delete */}
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

            <View style={{ marginTop: 28, borderTopWidth: 1, borderColor: '#e2e8f0', paddingTop: 18, width: '100%' }}>
                <Button title="Cerrar sesión" onPress={onLogout} color="#64748b" />
            </View>
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    container: { flexGrow: 1, padding: 16, backgroundColor: '#f8fafc', alignItems: 'stretch' },
    title: { fontSize: 26, fontWeight: '900', color: '#0f172a', textAlign: 'center', marginBottom: 16, letterSpacing: 0.5 },

    infoCard: { backgroundColor: '#e0f2fe', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#7dd3fc' },
    infoTitle: { fontWeight: '700', fontSize: 15, color: '#0369a1', marginBottom: 6 },
    infoText: { fontSize: 13, color: '#334155', lineHeight: 19 },
    infoPath: { fontSize: 11, color: '#64748b', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 6, backgroundColor: '#dbeafe', padding: 4, borderRadius: 4 },

    banner: { borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1.5 },
    bannerTitle: { fontWeight: '800', fontSize: 15, textAlign: 'center' },
    bannerSub: { fontSize: 12, color: '#334155', textAlign: 'center', marginTop: 4 },

    btnGroup: { marginBottom: 20 },
    mainBtn: { borderRadius: 14, padding: 16, alignItems: 'center', elevation: 3 },
    mainBtnIcon: { fontSize: 22, marginBottom: 2 },
    mainBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
    mainBtnSub: { color: 'rgba(255,255,255,0.82)', fontSize: 12, marginTop: 3 },

    recCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#cbd5e1', elevation: 3 },
    recHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    recTitle: { fontWeight: '800', fontSize: 17, color: '#0f172a' },
    refreshBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' },
    refreshBtnText: { fontSize: 13, fontWeight: '600', color: '#334155' },

    testBtn: { backgroundColor: '#eff6ff', paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#3b82f6', alignItems: 'center' },
    testBtnText: { color: '#1d4ed8', fontWeight: '800', fontSize: 14 },

    emptyBox: { alignItems: 'center', paddingVertical: 20 },
    emptyTitle: { fontWeight: '700', fontSize: 16, color: '#334155', marginBottom: 6 },
    emptyText: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22 },

    recItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
    recItemActive: { borderColor: '#6366f1', backgroundColor: '#f5f3ff' },
    recLabel: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
    recMeta: { fontSize: 12, color: '#64748b' },
    recProgress: { fontSize: 11, fontWeight: '600', color: '#6366f1', marginTop: 3 },

    iconBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginLeft: 6, alignItems: 'center', justifyContent: 'center' },
    iconBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
