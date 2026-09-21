/**
 * PartnerImpactCard.js - EinsDream 2026 v2.9.0
 * 
 * Tarjeta de Correlación Cruzada e Impacto del Acompañante
 * Muestra el desglose de eventos acústicos triangulados entre los dos celulares:
 * - Tus ronquidos personales vs Ronquidos de la pareja
 * - Ruido ambiental filtrado
 * - Microdespertares o perturbaciones cruzadas inducidas por el acompañante
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function PartnerImpactCard({ pairData, myRole = 'left' }) {
    if (!pairData) return null;

    const {
        summary = {},
        crossImpact = {}
    } = pairData;

    const isLeft = myRole === 'left';
    const mySnores = isLeft ? (summary.hostSnores || 0) : (summary.guestSnores || 0);
    const partnerSnores = isLeft ? (summary.guestSnores || 0) : (summary.hostSnores || 0);
    const ambientNoise = summary.ambientEvents || crossImpact.ambientNoiseEvents || 0;
    
    // Perturbaciones que el compañero provocó en el usuario
    const disturbancesByPartner = isLeft 
        ? (crossImpact.hostDisturbancesByGuest || 0)
        : (crossImpact.guestDisturbancesByHost || 0);

    return (
        <View style={s.card}>
            <View style={s.headerRow}>
                <View style={s.iconBadge}>
                    <Text style={s.iconTxt}>👥</Text>
                </View>
                <View style={s.headerTextCol}>
                    <Text style={s.title}>Impacto del Acompañante</Text>
                    <Text style={s.subtitle}>Triangulación acústica con 2 celulares (TDOA)</Text>
                </View>
                <View style={s.activeBadge}>
                    <Text style={s.activeBadgeTxt}>Dual Link ✓</Text>
                </View>
            </View>

            {/* Fila de Comparación de Métricas */}
            <View style={s.metricsRow}>
                {/* Métricas Usuario */}
                <View style={[s.metricCol, s.metricColMine]}>
                    <Text style={s.metricLabel}>Tus Ronquidos</Text>
                    <Text style={[s.metricVal, { color: '#818CF8' }]}>{mySnores}</Text>
                    <Text style={s.metricSub}>Lado {isLeft ? 'Izquierdo' : 'Derecho'}</Text>
                </View>

                {/* Separador */}
                <View style={s.vsCol}>
                    <Text style={s.vsTxt}>VS</Text>
                </View>

                {/* Métricas Pareja */}
                <View style={[s.metricCol, s.metricColPartner]}>
                    <Text style={s.metricLabel}>Ronquidos Pareja</Text>
                    <Text style={[s.metricVal, { color: '#F472B6' }]}>{partnerSnores}</Text>
                    <Text style={s.metricSub}>Lado {isLeft ? 'Derecho' : 'Izquierdo'}</Text>
                </View>

                {/* Ruido Ambiental */}
                <View style={[s.metricCol, s.metricColAmbient]}>
                    <Text style={s.metricLabel}>Ruido Ambiente</Text>
                    <Text style={[s.metricVal, { color: '#34D399' }]}>{ambientNoise}</Text>
                    <Text style={s.metricSub}>Filtrado</Text>
                </View>
            </View>

            {/* Análisis de Correlación Cruzada */}
            <View style={s.correlationBox}>
                <View style={s.corrHeader}>
                    <Text style={s.corrIcon}>⚡</Text>
                    <Text style={s.corrTitle}>Correlación de Microdespertares</Text>
                </View>
                <Text style={s.corrText}>
                    {disturbancesByPartner === 0
                        ? '✨ Los ruidos de tu acompañante no provocaron interrupciones detectables en tu descanso esta noche.'
                        : `Se detectaron ${disturbancesByPartner} momentos donde un ronquido intenso de tu pareja coincidió con movimiento o cambio de fase en tu lado.`}
                </Text>
            </View>

            <View style={s.footerNotice}>
                <Text style={s.footerNoticeTxt}>
                    ℹ️ Tu Einsdream Score se calcula exclusivamente con tus propios datos, sin verse afectado por el ruido de tu acompañante.
                </Text>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    card: {
        backgroundColor: '#111827',
        borderRadius: 18,
        padding: 18,
        marginHorizontal: 16,
        marginVertical: 12,
        borderWidth: 1,
        borderColor: '#1F2937',
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 6
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16
    },
    iconBadge: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#1E1B4B',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12
    },
    iconTxt: {
        fontSize: 20
    },
    headerTextCol: {
        flex: 1
    },
    title: {
        fontSize: 16,
        fontWeight: '800',
        color: '#F9FAFB'
    },
    subtitle: {
        fontSize: 11,
        color: '#9CA3AF',
        marginTop: 2
    },
    activeBadge: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderWidth: 1,
        borderColor: '#10B981',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8
    },
    activeBadgeTxt: {
        color: '#10B981',
        fontSize: 10,
        fontWeight: '700'
    },
    metricsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1F2937',
        borderRadius: 14,
        padding: 12,
        marginBottom: 14
    },
    metricCol: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 4
    },
    metricColMine: {
        borderRightWidth: 1,
        borderRightColor: '#374151'
    },
    metricColPartner: {
        borderRightWidth: 1,
        borderRightColor: '#374151'
    },
    metricColAmbient: {},
    vsCol: {
        paddingHorizontal: 6
    },
    vsTxt: {
        color: '#6B7280',
        fontSize: 10,
        fontWeight: '800'
    },
    metricLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#9CA3AF',
        marginBottom: 2
    },
    metricVal: {
        fontSize: 22,
        fontWeight: '900'
    },
    metricSub: {
        fontSize: 9,
        color: '#6B7280',
        marginTop: 2
    },
    correlationBox: {
        backgroundColor: '#1E1B4B',
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#3730A3'
    },
    corrHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4
    },
    corrIcon: {
        fontSize: 14,
        marginRight: 6
    },
    corrTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: '#C7D2FE'
    },
    corrText: {
        fontSize: 12,
        color: '#E0E7FF',
        lineHeight: 16
    },
    footerNotice: {
        paddingTop: 4
    },
    footerNoticeTxt: {
        fontSize: 11,
        color: '#6B7280',
        lineHeight: 15,
        fontStyle: 'italic'
    }
});
