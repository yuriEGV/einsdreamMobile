/**
 * SleepTestModal.js
 * Interactive Initial Sleep Health Assessment (Sleep Test):
 * Sets user's chronotype, baseline targets, and habits.
 */

import React, { useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Switch
} from 'react-native';

export default function SleepTestModal({ visible, onClose, onSave, initialProfile = {} }) {
    const [chronotype, setChronotype] = useState(initialProfile.chronotype || 'intermediate');
    const [targetHours, setTargetHours] = useState(initialProfile.targetSleepMinutes ? (initialProfile.targetSleepMinutes / 60) : 8);
    const [targetBedtime, setTargetBedtime] = useState(initialProfile.targetBedtime || '23:00');
    const [targetWakeTime, setTargetWakeTime] = useState(initialProfile.targetWakeTime || '07:00');

    // Habits
    const [screenBeforeBed, setScreenBeforeBed] = useState(
        initialProfile.habits?.screenBeforeBed !== undefined ? initialProfile.habits.screenBeforeBed : true
    );
    const [caffeineAfternoon, setCaffeineAfternoon] = useState(
        initialProfile.habits?.caffeineAfternoon !== undefined ? initialProfile.habits.caffeineAfternoon : false
    );
    const [exerciseRegular, setExerciseRegular] = useState(
        initialProfile.habits?.exerciseRegular !== undefined ? initialProfile.habits.exerciseRegular : false
    );
    const [stressLevel, setStressLevel] = useState(initialProfile.habits?.stressLevel || 'medium');

    const handleSave = () => {
        onSave({
            chronotype,
            targetSleepMinutes: Math.round(targetHours * 60),
            targetBedtime,
            targetWakeTime,
            habits: {
                screenBeforeBed,
                caffeineAfternoon,
                exerciseRegular,
                stressLevel
            },
            baselineAssessmentCompleted: true
        });
        onClose();
    };

    return (
        <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
            <View style={s.overlay}>
                <View style={s.modalCard}>
                    <View style={s.header}>
                        <Text style={s.title}>📋 Evaluación Inicial (Sleep Test)</Text>
                        <Text style={s.subtitle}>
                            Establece tu perfil de referencia y línea base para personalizar el Einsdream Score y predicciones.
                        </Text>
                    </View>

                    <ScrollView style={s.scrollBody} showsVerticalScrollIndicator={false}>
                        {/* 1. Cronotipo */}
                        <Text style={s.sectionTitle}>1. Tu Cronotipo Biológico</Text>
                        <View style={s.chipRow}>
                            <TouchableOpacity
                                style={[s.chip, chronotype === 'early_bird' && s.chipActive]}
                                onPress={() => {
                                    setChronotype('early_bird');
                                    setTargetBedtime('22:15');
                                    setTargetWakeTime('06:15');
                                }}
                            >
                                <Text style={s.chipIcon}>🌅</Text>
                                <Text style={[s.chipText, chronotype === 'early_bird' && s.chipTextActive]}>
                                    Madrugador (Alondra)
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[s.chip, chronotype === 'intermediate' && s.chipActive]}
                                onPress={() => {
                                    setChronotype('intermediate');
                                    setTargetBedtime('23:15');
                                    setTargetWakeTime('07:15');
                                }}
                            >
                                <Text style={s.chipIcon}>☀️</Text>
                                <Text style={[s.chipText, chronotype === 'intermediate' && s.chipTextActive]}>
                                    Intermedio (Oso)
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[s.chip, chronotype === 'night_owl' && s.chipActive]}
                                onPress={() => {
                                    setChronotype('night_owl');
                                    setTargetBedtime('00:30');
                                    setTargetWakeTime('08:30');
                                }}
                            >
                                <Text style={s.chipIcon}>🌙</Text>
                                <Text style={[s.chipText, chronotype === 'night_owl' && s.chipTextActive]}>
                                    Noctámbulo (Búho)
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* 2. Horas Objetivo */}
                        <Text style={s.sectionTitle}>2. Meta de Sueño Diaria</Text>
                        <View style={s.hoursRow}>
                            {[7.0, 7.5, 8.0, 8.5].map((h) => (
                                <TouchableOpacity
                                    key={h}
                                    style={[s.hourBtn, targetHours === h && s.hourBtnActive]}
                                    onPress={() => setTargetHours(h)}
                                >
                                    <Text style={[s.hourBtnText, targetHours === h && s.hourBtnTextActive]}>
                                        {h}h
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        <Text style={s.helpText}>
                            Horario habitual sincronizado: Acostarse a las {targetBedtime} · Despertar a las {targetWakeTime}
                        </Text>

                        {/* 3. Nivel de Estrés */}
                        <Text style={s.sectionTitle}>3. Nivel de Estrés Actual</Text>
                        <View style={s.chipRow}>
                            {['low', 'medium', 'high'].map((lvl) => (
                                <TouchableOpacity
                                    key={lvl}
                                    style={[s.stressChip, stressLevel === lvl && s.stressChipActive]}
                                    onPress={() => setStressLevel(lvl)}
                                >
                                    <Text style={[s.chipText, stressLevel === lvl && s.chipTextActive]}>
                                        {lvl === 'low' ? '😌 Bajo' : (lvl === 'medium' ? '😐 Moderado' : '⚡ Alto')}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* 4. Hábitos Pre-sueño */}
                        <Text style={s.sectionTitle}>4. Hábitos y Factores Nocturnos</Text>

                        <View style={s.switchRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={s.switchLabel}>📱 Pantallas antes de dormir</Text>
                                <Text style={s.switchSub}>Uso de móvil/PC a oscuras en la cama</Text>
                            </View>
                            <Switch
                                value={screenBeforeBed}
                                onValueChange={setScreenBeforeBed}
                                trackColor={{ false: '#334155', true: '#3b82f6' }}
                                thumbColor="#ffffff"
                            />
                        </View>

                        <View style={s.switchRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={s.switchLabel}>☕ Cafeína en la tarde</Text>
                                <Text style={s.switchSub}>Café, té o energizantes después de las 16:00</Text>
                            </View>
                            <Switch
                                value={caffeineAfternoon}
                                onValueChange={setCaffeineAfternoon}
                                trackColor={{ false: '#334155', true: '#3b82f6' }}
                                thumbColor="#ffffff"
                            />
                        </View>

                        <View style={s.switchRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={s.switchLabel}>🏃 Actividad física regular</Text>
                                <Text style={s.switchSub}>Al menos 30 min de ejercicio diario</Text>
                            </View>
                            <Switch
                                value={exerciseRegular}
                                onValueChange={setExerciseRegular}
                                trackColor={{ false: '#334155', true: '#10b981' }}
                                thumbColor="#ffffff"
                            />
                        </View>
                    </ScrollView>

                    {/* Botones de Acción */}
                    <View style={s.actionRow}>
                        <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
                            <Text style={s.cancelBtnText}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.saveBtn} onPress={handleSave}>
                            <Text style={s.saveBtnText}>✓ Guardar Evaluación</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        backgroundColor: '#0f172a',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
        maxHeight: '90%',
        borderWidth: 1,
        borderColor: '#334155',
    },
    header: {
        marginBottom: 14,
        borderBottomWidth: 1,
        borderColor: '#1e293b',
        paddingBottom: 10,
    },
    title: {
        fontSize: 18,
        fontWeight: '900',
        color: '#ffffff',
    },
    subtitle: {
        fontSize: 12,
        color: '#94a3b8',
        marginTop: 4,
        lineHeight: 17,
    },
    scrollBody: {
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#38bdf8',
        marginTop: 14,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    chipRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    chip: {
        flex: 1,
        minWidth: 100,
        backgroundColor: '#1e293b',
        borderRadius: 12,
        padding: 10,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#334155',
    },
    chipActive: {
        borderColor: '#38bdf8',
        backgroundColor: '#0369a1',
    },
    chipIcon: {
        fontSize: 18,
        marginBottom: 4,
    },
    chipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#cbd5e1',
        textAlign: 'center',
    },
    chipTextActive: {
        color: '#ffffff',
        fontWeight: '800',
    },
    hoursRow: {
        flexDirection: 'row',
        gap: 8,
    },
    hourBtn: {
        flex: 1,
        backgroundColor: '#1e293b',
        borderRadius: 10,
        paddingVertical: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155',
    },
    hourBtnActive: {
        backgroundColor: '#10b981',
        borderColor: '#059669',
    },
    hourBtnText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#cbd5e1',
    },
    hourBtnTextActive: {
        color: '#ffffff',
    },
    helpText: {
        fontSize: 11,
        color: '#64748b',
        marginTop: 6,
    },
    stressChip: {
        flex: 1,
        backgroundColor: '#1e293b',
        borderRadius: 10,
        paddingVertical: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155',
    },
    stressChipActive: {
        borderColor: '#f59e0b',
        backgroundColor: '#78350f',
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#1e293b',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#334155',
    },
    switchLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#f8fafc',
    },
    switchSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    actionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 10,
    },
    cancelBtn: {
        flex: 1,
        backgroundColor: '#334155',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    cancelBtnText: {
        color: '#cbd5e1',
        fontWeight: '700',
        fontSize: 14,
    },
    saveBtn: {
        flex: 2,
        backgroundColor: '#38bdf8',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    saveBtnText: {
        color: '#0f172a',
        fontWeight: '900',
        fontSize: 14,
    },
});
