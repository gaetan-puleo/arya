import React, { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useUnistyles } from '@/theme/ThemeContext';

const WS_STORAGE_KEY = 'arya-companion-ws';

interface WsConfig {
  url: string;
  token?: string;
}

const DEFAULT_CONFIG: WsConfig = { url: 'ws://<host>:<port>' };

export default function ConfigScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [url, setUrl] = useState(DEFAULT_CONFIG.url);
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState<WsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const { theme } = useUnistyles();

  const bg = theme.colors.background;
  const bgSecondary = theme.colors.backgroundSecondary;
  const bgTertiary = theme.colors.backgroundTertiary;
  const bgInput = theme.colors.backgroundInput;
  const textColor = theme.colors.text;
  const textSecondary = theme.colors.textSecondary;
  const textPlaceholder = theme.colors.textPlaceholder;
  const borderColor = theme.colors.border;
  const dangerColor = theme.colors.danger;
  const successColor = theme.colors.success;

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const stored = await AsyncStorage.getItem(WS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setUrl(parsed.url || DEFAULT_CONFIG.url);
        setToken(parsed.token || '');
        setSaved(parsed);
      }
    } catch {
      // use defaults
    }
  };

  const handleSave = async () => {
    if (!url.trim()) {
      alert("L'URL WebSocket est requise");
      return;
    }
    setSaving(true);
    try {
      const cfg: WsConfig = {
        url: url.trim(),
        token: token.trim() || undefined,
      };
      await AsyncStorage.setItem(WS_STORAGE_KEY, JSON.stringify(cfg));
      setSaved(cfg);
      alert('Configuration mise à jour. Redémarre l\'app pour reconnecter.');
    } catch {
      alert('Impossible de sauvegarder');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    await AsyncStorage.removeItem(WS_STORAGE_KEY);
    setUrl(DEFAULT_CONFIG.url);
    setToken('');
    setSaved(null);
    alert('Configuration réinitialisée');
  };

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Chat',
          headerTintColor: textColor,
          headerStyle: { backgroundColor: bgSecondary },
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: 'transparent',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name="arrow-back" size={22} color={textColor} />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={{ padding: 20 }}>
          <Text
            style={{
              fontSize: 28,
              fontWeight: '700',
              color: textColor,
              marginBottom: 24,
            }}
          >
            Configuration
          </Text>

          {/* QR Code Scan */}
          <Pressable
            onPress={() => router.navigate('/scan')}
            style={({ pressed }) => ({
              backgroundColor: bgSecondary,
              borderRadius: 14,
              height: 50,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              borderWidth: 1,
              borderColor,
              flexDirection: 'row',
              gap: 10,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="qr-code-outline" size={20} color={textColor} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: textColor }}>
              Scanner un QR code
            </Text>
          </Pressable>

          {/* URL Section */}
          <View
            style={{
              backgroundColor: bgSecondary,
              borderRadius: 14,
              padding: 16,
              marginBottom: 16,
              borderWidth: 1,
              borderColor,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: textSecondary,
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              URL WebSocket
            </Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="ws://<host>:<port>"
              placeholderTextColor={textPlaceholder}
              style={{
                backgroundColor: bgInput,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                color: textColor,
                borderWidth: 1,
                borderColor,
              }}
            />
            <Text style={{ fontSize: 12, color: textPlaceholder, marginTop: 8 }}>
              {"L'URL du serveur Companion WebSocket"}
            </Text>
          </View>

          {/* Token Section */}
          <View
            style={{
              backgroundColor: bgSecondary,
              borderRadius: 14,
              padding: 16,
              marginBottom: 24,
              borderWidth: 1,
              borderColor,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: textSecondary,
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Token (optionnel)
            </Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Token de connexion"
              placeholderTextColor={textPlaceholder}
              secureTextEntry
              style={{
                backgroundColor: bgInput,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                color: textColor,
                borderWidth: 1,
                borderColor,
              }}
            />
            <Text style={{ fontSize: 12, color: textPlaceholder, marginTop: 8 }}>
              Si le serveur est protégé par un token (COMPANION_TOKEN)
            </Text>
          </View>

          {/* Save Button */}
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => ({
              backgroundColor: saving ? bgTertiary : '#10A37F',
              borderRadius: 14,
              height: 50,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>
              {saving ? 'Sauvegarde...' : 'Sauvegarder'}
            </Text>
          </Pressable>

          {/* Saved Config */}
          {saved && (
            <View
              style={{
                backgroundColor: 'rgba(46,213,115,0.08)',
                borderRadius: 14,
                padding: 16,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: 'rgba(46,213,115,0.2)',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: successColor,
                  marginBottom: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                Configuration actuelle
              </Text>
              <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: textSecondary,
                    width: 60,
                  }}
                >
                  URL :
                </Text>
                <Text
                  numberOfLines={2}
                  style={{ fontSize: 14, color: textColor, flex: 1 }}
                >
                  {saved.url}
                </Text>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: textSecondary,
                    width: 60,
                  }}
                >
                  Token :
                </Text>
                <Text style={{ fontSize: 14, color: textColor }}>
                  {saved.token ? '••••••••' : '(aucun)'}
                </Text>
              </View>
            </View>
          )}

          {/* Reset Button */}
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => ({
              backgroundColor: 'transparent',
              height: 44,
              marginBottom: 32,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: dangerColor }}>
              Réinitialiser
            </Text>
          </Pressable>

          {/* Info Section */}
          <View
            style={{
              backgroundColor: bgSecondary,
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor,
            }}
          >
            <Text
              style={{
                fontSize: 17,
                fontWeight: '700',
                color: textColor,
                marginBottom: 14,
              }}
            >
              Comment connecter Arya
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: textSecondary,
                lineHeight: 22,
                marginBottom: 8,
              }}
            >
              {"1. Démarre Arya avec les variables d'environnement :"}
            </Text>
            <View
              style={{
                backgroundColor: bgInput,
                borderRadius: 10,
                padding: 12,
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 13, color: textColor, lineHeight: 22 }}>
                COMPANION_PORT=3001 \{'\n'}COMPANION_TOKEN=monsecret
              </Text>
            </View>
            <Text
              style={{
                fontSize: 14,
                color: textSecondary,
                lineHeight: 22,
                marginBottom: 8,
              }}
            >
              {"2. Note l'URL affichée dans la console"}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: textSecondary,
                lineHeight: 22,
              }}
            >
              3. Colle-la dans le champ URL ci-dessus
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
