import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import axios from 'axios';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import CONFIG from '../config';

const { API_URL, GOOGLE_WEB_CLIENT_ID } = CONFIG;

export default function LoginScreen({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phone, setPhone] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [needsPhoneForGoogle, setNeedsPhoneForGoogle] = useState(false);
    const [pendingGoogleToken, setPendingGoogleToken] = useState(null);

    useEffect(() => {
        GoogleSignin.configure({
            webClientId: GOOGLE_WEB_CLIENT_ID,
            offlineAccess: true,
        });
    }, []);

    const handleEmailSubmit = async () => {
        if (!email || !password || (isRegistering && !phone)) {
            Alert.alert('Error', 'Please fill all required fields');
            return;
        }

        try {
            const endpoint = isRegistering ? '/auth/register' : '/auth/login';
            const payload = isRegistering ? { email, password, phone } : { email, password };

            const response = await axios.post(`${API_URL}${endpoint}`, payload);

            if (response.data.token) {
                onLogin(response.data.token);
            }
        } catch (error) {
            const message = error.response?.data?.message || 'Network error';
            Alert.alert('Error', message);
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            if (needsPhoneForGoogle) {
                if (!phone) {
                    Alert.alert('Error', 'Phone number is required to complete registration.');
                    return;
                }
            } else {
                await GoogleSignin.hasPlayServices();
                const userInfo = await GoogleSignin.signIn();
                setPendingGoogleToken(userInfo.idToken);
                await completeGoogleLogin(userInfo.idToken, phone); // Initially phone is empty
                return; // Wait for complete function
            }

            // If we are here, we already have a pending token and we are re-trying to submit exactly with phone number
            await completeGoogleLogin(pendingGoogleToken, phone);

        } catch (error) {
            console.error(error);
            if (error.code === statusCodes.SIGN_IN_CANCELLED) {
                // user cancelled
            } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
                Alert.alert('Error', 'Google Play Services not available');
            } else {
                Alert.alert('Google Sign-In Error', error.message || 'An unknown error occurred');
            }
        }
    };

    const completeGoogleLogin = async (idToken, phoneNumber) => {
        try {
            const payload = { idToken };
            if (phoneNumber) payload.phone = phoneNumber;

            const response = await axios.post(`${API_URL}/auth/google`, payload);

            if (response.data.token) {
                onLogin(response.data.token);
            }
        } catch (err) {
            // Check if backend specifically asks for phone
            if (err.response?.status === 400 && err.response?.data?.requirePhone) {
                setNeedsPhoneForGoogle(true);
                Alert.alert('Phone Required', 'Please enter your phone number to complete Google Registration.');
            } else {
                Alert.alert('Error', err.response?.data?.message || 'Failed Google Auth');
                setNeedsPhoneForGoogle(false);
                setPendingGoogleToken(null);
            }
        }
    }

    // If Google sign-up flow specifically requested the phone string
    if (needsPhoneForGoogle) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Complete Registration</Text>
                <Text style={{ textAlign: 'center', marginBottom: 20 }}>Please enter your phone number to complete your Google Sign In setup.</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Phone Number (+12345678)"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                />
                <Button title="Complete Setup" onPress={handleGoogleSignIn} />
                <Button title="Cancel" color="#888" onPress={() => { setNeedsPhoneForGoogle(false); setPendingGoogleToken(null); }} />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{isRegistering ? 'Register' : 'Login'}</Text>

            <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
            />
            <TextInput
                style={styles.input}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
            />

            {isRegistering && (
                <TextInput
                    style={styles.input}
                    placeholder="Phone Number"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                />
            )}

            <View style={styles.buttonContainer}>
                <Button title={isRegistering ? 'Sign Up' : 'Sign In'} onPress={handleEmailSubmit} />
            </View>

            <Text style={styles.orText}>- OR -</Text>

            <TouchableOpacity style={styles.googleButton} onPress={handleGoogleSignIn}>
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 20 }}>
                <Button
                    title={isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
                    onPress={() => { setIsRegistering(!isRegistering); setPhone(''); }}
                    color="#888"
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        padding: 20,
        backgroundColor: '#fff',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        padding: 10,
        marginBottom: 15,
        borderRadius: 5,
    },
    buttonContainer: {
        marginBottom: 15,
    },
    orText: {
        textAlign: 'center',
        marginVertical: 15,
        color: '#666',
        fontWeight: 'bold'
    },
    googleButton: {
        backgroundColor: '#4285F4',
        padding: 12,
        borderRadius: 5,
        alignItems: 'center',
    },
    googleButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold'
    }
});
