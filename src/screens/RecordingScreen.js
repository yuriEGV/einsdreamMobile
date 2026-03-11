import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Button, StyleSheet, Alert, Platform, ScrollView } from 'react-native';
import { Audio } from 'expo-av';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import CONFIG from '../config';

const { API_URL } = CONFIG;

export default function RecordingScreen({ token, onLogout }) {
    const [hasPermission, setHasPermission] = useState(false);
    const [isAutoAgentRunning, setIsAutoAgentRunning] = useState(false);
    const [isManualRecording, setIsManualRecording] = useState(false);

    // For Auto-Agent
    const [isAutoRecording, setIsAutoRecording] = useState(false); // when it's actively capturing a chunk
    const [meteringValue, setMeteringValue] = useState(-160);
    const [lastNoiseTime, setLastNoiseTime] = useState(Date.now());

    const backgroundListenerRef = useRef(null);
    const autoRecordingRef = useRef(null);
    const manualRecordingRef = useRef(null);

    const autoRecordingTimeoutRef = useRef(null);
    const autoStopTimeoutRef = useRef(null);

    // VAD Configuration for Cloud
    const NOISE_THRESHOLD = -35;
    const MAX_AUTO_DURATION = 10000;
    const SILENCE_TIMEOUT = 3000;

    useEffect(() => {
        (async () => {
            const { status } = await Audio.requestPermissionsAsync();
            setHasPermission(status === 'granted');
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });
        })();
        return () => {
            stopAll();
        };
    }, []);

    const stopAll = async () => {
        console.log("Stop All requested");
        if (isAutoAgentRunning) {
            await stopAutoAgent();
        }
        if (isManualRecording) {
            await stopManualRecording();
        }
    };

    // ==========================================
    // 1. AUTO-AGENT CLOUD RECORDING
    // ==========================================
    const startAutoAgent = async () => {
        if (!hasPermission) return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono.');
        try {
            console.log('Starting Auto-Agent VAD listener...');
            setIsAutoAgentRunning(true);
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.LOW_QUALITY,
                (status) => {
                    if (status.metering !== undefined) {
                        setMeteringValue(Math.round(status.metering));
                        if (status.metering > NOISE_THRESHOLD) {
                            console.log('NOISE DETECTED. Capturing chunk...');
                            stopVADListener().then(() => startAutoChunkRecording());
                        }
                    }
                },
                500
            );
            backgroundListenerRef.current = recording;
        } catch (err) {
            console.error(err);
        }
    };

    const stopVADListener = async () => {
        if (!backgroundListenerRef.current) return;
        await backgroundListenerRef.current.stopAndUnloadAsync();
        backgroundListenerRef.current = null;
    };

    const stopAutoAgent = async () => {
        setIsAutoAgentRunning(false);
        setMeteringValue(-160);
        await stopVADListener();
        if (isAutoRecording) {
            await stopAutoChunkRecording(true); // pass true to indicate manual stop
        }
    };

    const startAutoChunkRecording = async () => {
        try {
            setLastNoiseTime(Date.now());
            setIsAutoRecording(true);
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.LOW_QUALITY,
                (status) => {
                    if (status.metering !== undefined) {
                        setMeteringValue(Math.round(status.metering));
                        if (status.metering > NOISE_THRESHOLD) setLastNoiseTime(Date.now());
                    }
                },
                300
            );
            autoRecordingRef.current = recording;

            autoRecordingTimeoutRef.current = setTimeout(() => {
                stopAutoChunkRecording();
            }, MAX_AUTO_DURATION);

            autoStopTimeoutRef.current = setInterval(() => {
                if (Date.now() - lastNoiseTime > SILENCE_TIMEOUT) stopAutoChunkRecording();
            }, 500);

        } catch (err) {
            console.error(err);
        }
    };

    const stopAutoChunkRecording = async (isManualStop = false) => {
        if (!autoRecordingRef.current) return;
        try {
            setIsAutoRecording(false);
            if (autoRecordingTimeoutRef.current) clearTimeout(autoRecordingTimeoutRef.current);
            if (autoStopTimeoutRef.current) clearInterval(autoStopTimeoutRef.current);

            await autoRecordingRef.current.stopAndUnloadAsync();
            const uri = autoRecordingRef.current.getURI();
            autoRecordingRef.current = null;

            if (uri) uploadAudio(uri);

            // If auto agent is still enabled and we didn't manually stop it, resume listening
            if (isAutoAgentRunning && !isManualStop) {
                startAutoAgent();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const uploadAudio = async (uri) => {
        try {
            const filename = uri.split('/').pop();
            const contentType = Platform.OS === 'ios' ? 'audio/x-m4a' : 'audio/m4a';

            const initRes = await axios.post(`${API_URL}/upload/init`,
                { filename, contentType },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const { uploadMethod, url, fileKey, provider } = initRes.data;

            if (provider === 'local') {
                const formData = new FormData();
                formData.append('audio', {
                    uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
                    name: filename,
                    type: contentType,
                });
                const localRes = await axios.post(`${API_URL}${url}`, formData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                });
                await saveMetadata(localRes.data.fileKey || fileKey, localRes.data.fileData);
            } else {
                const audioData = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                await fetch(url, { method: uploadMethod || 'PUT', headers: { 'Content-Type': contentType }, body: Buffer.from(audioData, 'base64') });
                // For non-local (S3/GCS), we don't store base64 in Mongo to save space
                await saveMetadata(fileKey, null);
            }
            console.log('Auto-Agent Cloud Upload Success!');
            Alert.alert('Éxito', 'Grabación enviada correctamente al servidor ✅');
        } catch (error) {
            console.error('Upload error:', error);
            Alert.alert('Error de Subida', `No se pudo subir el audio: ${error.response?.data?.message || error.message}`);
        }
    };

    const saveMetadata = async (fileKey, audioBase64) => {
        try {
            await axios.post(`${API_URL}/upload/metadata`,
                { s3Key: fileKey, audioBase64, duration: 15, deviceModel: Platform.OS, eventType: 'auto-agent' },
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch (error) {
            console.error('Metadata error:', error);
            throw new Error(`Error al guardar metadatos: ${error.response?.data?.message || error.message}`);
        }
    };

    // ==========================================
    // 2. MANUAL LOCAL RECORDING
    // ==========================================
    const startManualRecording = async () => {
        if (!hasPermission) return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono.');
        try {
            console.log('Starting continuous manual recording...');
            setIsManualRecording(true);
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            manualRecordingRef.current = recording;
        } catch (err) {
            console.error(err);
            Alert.alert('Error', 'Failed to start manual recording');
        }
    };

    const stopManualRecording = async () => {
        if (!manualRecordingRef.current) return;
        try {
            console.log('Stopping continuous manual recording...');
            setIsManualRecording(false);
            await manualRecordingRef.current.stopAndUnloadAsync();
            const uri = manualRecordingRef.current.getURI();
            manualRecordingRef.current = null;

            if (uri) {
                // Move to persistent app directory so it doesn't get cleared from cache
                const filename = `manual_record_${Date.now()}.m4a`;
                const newPath = FileSystem.documentDirectory + filename;
                await FileSystem.copyAsync({ from: uri, to: newPath });

                Alert.alert(
                    'Grabación Local Guardada',
                    `La grabación nocturna continua ha sido guardada directamente en la memoria de tu teléfono de forma OFFLINE para evitar colapsar la nube.\n\nRuta: ${newPath}`
                );
            }
        } catch (err) {
            console.error('Failed to stop manual recording', err);
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.title}>Einsdream Mobile</Text>

            <View style={styles.infoBox}>
                <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#333' }}>☁️ Auto-Agent (Cloud)</Text>
                <Text style={styles.infoText}>Tecnología Inteligente: Detecta ruido automáticamente y sube clips precisos a la nube (Google/AWS) para ahorrar espacio y no colapsar la plataforma.</Text>
                <View style={{ height: 15 }} />
                <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#333' }}>📱 Grabación Continua (Local)</Text>
                <Text style={styles.infoText}>Tecnología Pesada: Graba de forma ininterrumpida por horas. Por su altísimo peso, NO se sube a Vercel ni a la nube, se almacena directamente de forma OFFLINE en tu celular.</Text>
            </View>

            <View style={styles.statusBox}>
                <Text style={styles.statusText}>
                    {isManualRecording ? "🔴 GRABACIÓN CONTINUA (MÓVIL)..." :
                        isAutoAgentRunning ? (isAutoRecording ? "🔵 CAPTURANDO AUDIO (NUBE)..." : "🟢 ESCUCHANDO RUIDO...") :
                            "⚪ INACTIVO"}
                </Text>
                {isAutoAgentRunning && (
                    <Text style={{ color: '#666', marginTop: 8 }}>Nivel de Ruido: {meteringValue} dB</Text>
                )}
            </View>

            <View style={styles.buttonContainer}>
                {!isManualRecording && !isAutoAgentRunning && (
                    <>
                        <Button title="ACTIVAR AUTO-AGENT (NUBE)" onPress={startAutoAgent} color="green" />
                        <View style={{ marginTop: 25 }}>
                            <Button title="GRABAR TODA LA NOCHE (LOCAL)" onPress={startManualRecording} color="#2196F3" />
                        </View>
                    </>
                )}

                {(isAutoAgentRunning || isManualRecording) && (
                    <Button
                        title="DETERNER TECNOLOGÍA"
                        onPress={stopAll}
                        color="red"
                    />
                )}
            </View>

            <View style={{ marginTop: 40, borderTopWidth: 1, borderColor: '#eee', paddingTop: 20, width: '100%' }}>
                <Button title="Cerrar Sesión" onPress={onLogout} color="#888" />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#fff',
    },
    title: {
        fontSize: 26,
        fontWeight: 'bold',
        marginBottom: 25,
        color: '#222'
    },
    infoBox: {
        backgroundColor: '#e3f2fd',
        padding: 18,
        borderRadius: 12,
        width: '100%',
        marginBottom: 25,
        borderColor: '#bbdefb',
        borderWidth: 1,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 5,
        elevation: 2
    },
    infoText: {
        color: '#444',
        fontSize: 14,
        marginTop: 6,
        lineHeight: 20
    },
    statusBox: {
        padding: 25,
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
        marginBottom: 35,
        borderWidth: 1,
        borderColor: '#ddd'
    },
    statusText: {
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        color: '#333'
    },
    buttonContainer: {
        width: '100%',
    }
});
