/**
 * PairModal.js - EinsDream 2026 v2.9.0
 * 
 * Flujo de Emparejamiento Dual (EinsDream Pair):
 * Diseñado especialmente para adultos y adultos mayores:
 * - Selección intuitiva "¿Duermes solo o en pareja?"
 * - Números gigantes para el PIN de 4 dígitos (sin necesidad de enfocar cámara en penumbra)
 * - Calibración acústica con 1 toque
 * - Feedback visual de alta legibilidad
 */

import React, { useState, useEffect } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    Alert
} from 'react-native';
import {
    createPairRoom,
    joinPairRoom,
    checkRoomStatus,
    playCalibrationPulse,
    measureClockOffset,
    startPairNight
} from '../services/einsdreamPairService';

export default function PairModal({
    visible,
    onClose,
    onSelectSolo,
    onStartPairMonitoring
}) {
    // Paso del flujo: 1 = Selector Solo/Pareja, 2 = Rol (Crear o Unirse), 3 = Sala Activa (Host o Guest)
    const [step, setStep] = useState(1);
    const [mode, setMode] = useState(null); // 'host' | 'guest'
    const [myRole, setMyRole] = useState('left'); // 'left' | 'right'
    const [roomCodeInput, setRoomCodeInput] = useState('');
    const [roomInfo, setRoomInfo] = useState(null); // { roomId, roomCode, role, status }
    const [loading, setLoading] = useState(false);
    const [partnerConnected, setPartnerConnected] = useState(false);
    const [chirpPlaying, setChirpPlaying] = useState(false);

    // Resetear al abrir
    useEffect(() => {
        if (visible) {
            setStep(1);
            setMode(null);
            setMyRole('left');
            setRoomCodeInput('');
            setRoomInfo(null);
            setPartnerConnected(false);
        }
    }, [visible]);

    // Sondeo de estado cuando es Host esperando al Guest
    useEffect(() => {
        let timer = null;
        if (step === 3 && mode === 'host' && roomInfo?.roomId && !partnerConnected) {
            timer = setInterval(async () => {
                const res = await checkRoomStatus(roomInfo.roomId);
                if (res.hasGuest || res.status === 'paired' || res.status === 'active') {
                    setPartnerConnected(true);
                }
            }, 3000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [step, mode, roomInfo, partnerConnected]);

    // 1. Crear Sala como Host
    const handleCreateRoom = async (selectedRole) => {
        setLoading(true);
        try {
            const data = await createPairRoom({ role: selectedRole });
            setRoomInfo(data);
            setMyRole(selectedRole);
            setMode('host');
            setStep(3);
        } catch (e) {
            Alert.alert('Error', 'No se pudo generar la sala. Inténtalo de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    // 2. Unirse a Sala como Guest
    const handleJoinRoom = async () => {
        if (!roomCodeInput || roomCodeInput.trim().length < 4) {
            Alert.alert('Código incompleto', 'Por favor ingresa el código de 4 dígitos.');
            return;
        }
        setLoading(true);
        try {
            const data = await joinPairRoom({ roomCode: roomCodeInput });
            setRoomInfo(data);
            setMyRole(data.role);
            setMode('guest');
            setPartnerConnected(true);
            setStep(3);
        } catch (err) {
            Alert.alert('No se pudo vincular', err.message || 'Verifica el código e intenta nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    // 3. Probar Calibración de Audio (Chirp)
    const handleTestChirp = async () => {
        setChirpPlaying(true);
        await playCalibrationPulse();
        setTimeout(() => setChirpPlaying(false), 1200);
    };

    // 4. Iniciar Noche en Pareja
    const handleStartNight = async () => {
        setLoading(true);
        try {
            const clockOffset = await measureClockOffset();
            if (mode === 'host' && roomInfo?.roomId) {
                await startPairNight(roomInfo.roomId);
            }
            onStartPairMonitoring({
                isPair: true,
                roomId: roomInfo?.roomId || 'local_pair',
                roomCode: roomInfo?.roomCode || '0000',
                role: myRole,
                partnerRole: myRole === 'left' ? 'right' : 'left',
                clockOffsetMs: clockOffset
            });
            onClose();
        } catch (e) {
            console.warn('Start pair night error:', e);
            onStartPairMonitoring({
                isPair: true,
                roomId: roomInfo?.roomId || 'local_pair',
                roomCode: roomInfo?.roomCode || '0000',
                role: myRole,
                partnerRole: myRole === 'left' ? 'right' : 'left',
                clockOffsetMs: 0
            });
            onClose();
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
            <View style={s.overlay}>
                <View style={s.modalCard}>
                    
                    {/* Botón cerrar */}
                    <TouchableOpacity style={s.closeBtn} onPress={onClose}>
                        <Text style={s.closeTxt}>✕</Text>
                    </TouchableOpacity>

                    {/* ─── PASO 1: ¿Cómo duermes hoy? ─────────────────────────── */}
                    {step === 1 && (
                        <View>
                            <Text style={s.headerTitle}>¿Cómo duermes hoy?</Text>
                            <Text style={s.headerSub}>
                                Selecciona si descansarás solo o con tu pareja para calibrar la detección acústica.
                            </Text>

                            {/* Opción Solo */}
                            <TouchableOpacity
                                style={s.optionCard}
                                onPress={() => {
                                    onClose();
                                    onSelectSolo();
                                }}
                                activeOpacity={0.8}
                            >
                                <View style={s.optionIconBg}>
                                    <Text style={s.optionIcon}>🛌</Text>
                                </View>
                                <View style={s.optionInfo}>
                                    <Text style={s.optionTitle}>Duermo Solo</Text>
                                    <Text style={s.optionDesc}>
                                        Monitoreo acústico individual. Detección directa de tus ronquidos y sueño.
                                    </Text>
                                </View>
                            </TouchableOpacity>

                            {/* Opción En Pareja */}
                            <TouchableOpacity
                                style={[s.optionCard, s.optionCardHighlight]}
                                onPress={() => setStep(2)}
                                activeOpacity={0.8}
                            >
                                <View style={[s.optionIconBg, { backgroundColor: '#312E81' }]}>
                                    <Text style={s.optionIcon}>👥</Text>
                                </View>
                                <View style={s.optionInfo}>
                                    <View style={s.badgeRow}>
                                        <Text style={s.optionTitle}>En Pareja (2 Celulares)</Text>
                                        <View style={s.pairBadge}>
                                            <Text style={s.pairBadgeTxt}>EinsDream Pair</Text>
                                        </View>
                                    </View>
                                    <Text style={s.optionDesc}>
                                        Sincroniza dos teléfonos en la cama. Triangula el sonido y separa tus ronquidos de los de tu acompañante.
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ─── PASO 2: Rol en la Cama ──────────────────────────────── */}
                    {step === 2 && (
                        <View>
                            <Text style={s.headerTitle}>Sincronización de Pareja</Text>
                            <Text style={s.headerSub}>
                                Uno de los dos teléfonos debe crear la sala y el otro simplemente unirse.
                            </Text>

                            {/* Celular Principal */}
                            <View style={s.roleBox}>
                                <Text style={s.roleBoxTitle}>📱 Celular 1 (Principal)</Text>
                                <Text style={s.roleBoxDesc}>Crea la sala y genera el código para el otro teléfono.</Text>
                                
                                <Text style={s.sideLabel}>¿De qué lado duermes?</Text>
                                <View style={s.sideRow}>
                                    <TouchableOpacity
                                        style={[s.sideBtn, myRole === 'left' && s.sideBtnActive]}
                                        onPress={() => setMyRole('left')}
                                    >
                                        <Text style={s.sideBtnTxt}>🛏️ Izquierda</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[s.sideBtn, myRole === 'right' && s.sideBtnActive]}
                                        onPress={() => setMyRole('right')}
                                    >
                                        <Text style={s.sideBtnTxt}>🛏️ Derecha</Text>
                                    </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                    style={s.primaryActionBtn}
                                    onPress={() => handleCreateRoom(myRole)}
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <ActivityIndicator color="#FFF" />
                                    ) : (
                                        <Text style={s.primaryActionBtnTxt}>✨ Crear Sala y Mostrar Código</Text>
                                    )}
                                </TouchableOpacity>
                            </View>

                            {/* Separador */}
                            <View style={s.orDivider}>
                                <View style={s.dividerLine} />
                                <Text style={s.dividerTxt}>O BIEN</Text>
                                <View style={s.dividerLine} />
                            </View>

                            {/* Celular Secundario */}
                            <View style={s.roleBox}>
                                <Text style={s.roleBoxTitle}>🔗 Celular 2 (Secundario)</Text>
                                <Text style={s.roleBoxDesc}>
                                    Si tu pareja ya creó la sala, ingresa el código de 4 dígitos:
                                </Text>

                                <View style={s.inputRow}>
                                    <TextInput
                                        style={s.pinInput}
                                        placeholder="Ej: 4821"
                                        placeholderTextColor="#64748B"
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        value={roomCodeInput}
                                        onChangeText={setRoomCodeInput}
                                    />
                                    <TouchableOpacity
                                        style={[s.joinBtn, roomCodeInput.length === 4 && s.joinBtnReady]}
                                        onPress={handleJoinRoom}
                                        disabled={loading || roomCodeInput.length < 4}
                                    >
                                        {loading ? (
                                            <ActivityIndicator color="#FFF" />
                                        ) : (
                                            <Text style={s.joinBtnTxt}>Unirme</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
                                <Text style={s.backBtnTxt}>← Volver</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ─── PASO 3: Sala Conectada y Lista ─────────────────────── */}
                    {step === 3 && (
                        <View>
                            <Text style={s.headerTitle}>
                                {mode === 'host' ? 'Sala Creada' : 'Conectado a la Sala'}
                            </Text>

                            {/* Tarjeta de Código Gigante para Adultos Mayores */}
                            <View style={s.codeDisplayCard}>
                                <Text style={s.codeLabel}>CÓDIGO DE ENLACE</Text>
                                <Text style={s.codeBigTxt}>{roomInfo?.roomCode || '----'}</Text>
                                {mode === 'host' && (
                                    <Text style={s.codeInstruction}>
                                        Dile a tu pareja que abra EinsDream en su teléfono y digite estos 4 números.
                                    </Text>
                                )}
                            </View>

                            {/* Badge de Estado */}
                            <View style={[s.statusPill, partnerConnected ? s.statusPillOk : s.statusPillWait]}>
                                <Text style={s.statusDot}>{partnerConnected ? '🟢' : '⏳'}</Text>
                                <Text style={s.statusTxt}>
                                    {partnerConnected
                                        ? `Vinculado con Celular ${myRole === 'left' ? 'Derecho' : 'Izquierdo'}`
                                        : 'Esperando que tu pareja ingrese el código...'}
                                </Text>
                            </View>

                            {/* Asignación de rol */}
                            <View style={s.roleSummaryBox}>
                                <Text style={s.roleSummaryTxt}>
                                    Este celular: <Text style={s.bold}>{myRole === 'left' ? '🛏️ Lado Izquierdo' : '🛏️ Lado Derecho'}</Text>
                                </Text>
                            </View>

                            {/* Botón Calibración Acústica */}
                            <TouchableOpacity
                                style={s.chirpBtn}
                                onPress={handleTestChirp}
                                disabled={chirpPlaying}
                            >
                                <Text style={s.chirpBtnTxt}>
                                    {chirpPlaying ? '🔊 Emitiendo pulso...' : '🔊 Probar Micrófonos (Beep de 100ms)'}
                                </Text>
                            </TouchableOpacity>

                            {/* Botón Principal Iniciar Noche */}
                            <TouchableOpacity
                                style={[s.startNightBtn, (!partnerConnected && mode === 'host') && s.startNightBtnWarning]}
                                onPress={handleStartNight}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={s.startNightBtnTxt}>
                                        {partnerConnected ? '🌙 Iniciar Monitoreo en Pareja' : '🌙 Iniciar Monitoreo de Todos Modos'}
                                    </Text>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={s.backBtn}
                                onPress={() => setStep(2)}
                            >
                                <Text style={s.backBtnTxt}>← Cambiar Configuración</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16
    },
    modalCard: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: '#0F172A',
        borderRadius: 20,
        padding: 24,
        borderWidth: 1,
        borderColor: '#1E293B',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10
    },
    closeBtn: {
        position: 'absolute',
        top: 16,
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#1E293B',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10
    },
    closeTxt: {
        color: '#94A3B8',
        fontSize: 16,
        fontWeight: 'bold'
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#F8FAFC',
        marginBottom: 6
    },
    headerSub: {
        fontSize: 14,
        color: '#94A3B8',
        marginBottom: 20,
        lineHeight: 20
    },
    optionCard: {
        flexDirection: 'row',
        backgroundColor: '#1E293B',
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155'
    },
    optionCardHighlight: {
        borderColor: '#6366F1',
        backgroundColor: '#131B38'
    },
    optionIconBg: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#334155',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14
    },
    optionIcon: {
        fontSize: 26
    },
    optionInfo: {
        flex: 1
    },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2
    },
    optionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFFFFF'
    },
    pairBadge: {
        backgroundColor: '#4F46E5',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8
    },
    pairBadgeTxt: {
        color: '#EEF2FF',
        fontSize: 10,
        fontWeight: '800'
    },
    optionDesc: {
        fontSize: 12,
        color: '#94A3B8',
        marginTop: 4,
        lineHeight: 16
    },
    roleBox: {
        backgroundColor: '#1E293B',
        borderRadius: 14,
        padding: 14,
        marginBottom: 10
    },
    roleBoxTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#F1F5F9',
        marginBottom: 4
    },
    roleBoxDesc: {
        fontSize: 12,
        color: '#94A3B8',
        marginBottom: 10
    },
    sideLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#CBD5E1',
        marginBottom: 6
    },
    sideRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 12
    },
    sideBtn: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: '#0F172A',
        borderWidth: 1,
        borderColor: '#334155',
        alignItems: 'center'
    },
    sideBtnActive: {
        backgroundColor: '#4338CA',
        borderColor: '#818CF8'
    },
    sideBtnTxt: {
        color: '#F8FAFC',
        fontSize: 13,
        fontWeight: '700'
    },
    primaryActionBtn: {
        backgroundColor: '#4F46E5',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center'
    },
    primaryActionBtnTxt: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 14
    },
    orDivider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 10
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#334155'
    },
    dividerTxt: {
        color: '#64748B',
        fontSize: 11,
        fontWeight: '700',
        marginHorizontal: 10
    },
    inputRow: {
        flexDirection: 'row',
        gap: 10
    },
    pinInput: {
        flex: 1,
        backgroundColor: '#0F172A',
        borderWidth: 1,
        borderColor: '#334155',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: 4
    },
    joinBtn: {
        backgroundColor: '#334155',
        paddingHorizontal: 20,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center'
    },
    joinBtnReady: {
        backgroundColor: '#10B981'
    },
    joinBtnTxt: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 14
    },
    backBtn: {
        paddingVertical: 10,
        alignItems: 'center',
        marginTop: 6
    },
    backBtnTxt: {
        color: '#94A3B8',
        fontSize: 13
    },
    codeDisplayCard: {
        backgroundColor: '#131B38',
        borderColor: '#4338CA',
        borderWidth: 1.5,
        borderRadius: 16,
        padding: 20,
        alignItems: 'center',
        marginBottom: 14
    },
    codeLabel: {
        color: '#818CF8',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 1.5,
        marginBottom: 4
    },
    codeBigTxt: {
        fontSize: 44,
        fontWeight: '900',
        color: '#FFFFFF',
        letterSpacing: 8,
        marginVertical: 6
    },
    codeInstruction: {
        fontSize: 12,
        color: '#C7D2FE',
        textAlign: 'center',
        lineHeight: 16,
        marginTop: 4
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        marginBottom: 12
    },
    statusPillOk: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderWidth: 1,
        borderColor: '#059669'
    },
    statusPillWait: {
        backgroundColor: 'rgba(234, 179, 8, 0.12)',
        borderWidth: 1,
        borderColor: '#CA8A04'
    },
    statusDot: {
        fontSize: 14,
        marginRight: 8
    },
    statusTxt: {
        color: '#F8FAFC',
        fontSize: 13,
        fontWeight: '600',
        flex: 1
    },
    roleSummaryBox: {
        backgroundColor: '#1E293B',
        padding: 10,
        borderRadius: 10,
        marginBottom: 12,
        alignItems: 'center'
    },
    roleSummaryTxt: {
        color: '#94A3B8',
        fontSize: 13
    },
    bold: {
        color: '#F1F5F9',
        fontWeight: '700'
    },
    chirpBtn: {
        backgroundColor: '#1E293B',
        borderWidth: 1,
        borderColor: '#334155',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        marginBottom: 12
    },
    chirpBtnTxt: {
        color: '#A5B4FC',
        fontSize: 13,
        fontWeight: '600'
    },
    startNightBtn: {
        backgroundColor: '#4F46E5',
        borderRadius: 14,
        paddingVertical: 15,
        alignItems: 'center',
        marginBottom: 6
    },
    startNightBtnWarning: {
        backgroundColor: '#4338CA'
    },
    startNightBtnTxt: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800'
    }
});
