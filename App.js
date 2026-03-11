import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import LoginScreen from './src/screens/LoginScreen';
import RecordingScreen from './src/screens/RecordingScreen';

export default function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [token, setToken] = useState(null);

    useEffect(() => {
        checkToken();
    }, []);

    const checkToken = async () => {
        try {
            const storedToken = await SecureStore.getItemAsync('userToken');
            if (storedToken) {
                setToken(storedToken);
                setIsAuthenticated(true);
            }
        } catch (e) {
            console.log('Failed to fetch token', e);
        }
    };

    const handleLogin = async (newToken) => {
        await SecureStore.setItemAsync('userToken', newToken);
        setToken(newToken);
        setIsAuthenticated(true);
    };

    const handleLogout = async () => {
        await SecureStore.deleteItemAsync('userToken');
        setToken(null);
        setIsAuthenticated(false);
    };

    if (!isAuthenticated) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    return <RecordingScreen token={token} onLogout={handleLogout} />;
}
