import React, { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  YStack,
  XStack,
  Input,
  Button,
  ScrollView,
  SizableText,
  useTheme,
  type ColorTokens,
} from 'tamagui';

const WS_STORAGE_KEY = 'arya-companion-ws';

interface WsConfig {
  url: string;
  token?: string;
}

const DEFAULT_CONFIG: WsConfig = { url: 'ws://<host>:<port>' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getThemeColor = (theme: any, key: string): string => {
  const val = theme[key];
  if (val && typeof val.get === 'function') return val.get();
  return typeof val === 'string' ? val : '';
};

export default function ConfigScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [url, setUrl] = useState(DEFAULT_CONFIG.url);
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState<WsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const theme = useTheme();

  const bg = getThemeColor(theme, 'background');
  const bgSecondary = getThemeColor(theme, 'backgroundSecondary');
  const bgTertiary = getThemeColor(theme, 'backgroundTertiary');
  const bgInput = getThemeColor(theme, 'backgroundInput');
  const textColor = getThemeColor(theme, 'text');
  const textSecondary = getThemeColor(theme, 'textSecondary');
  const textPlaceholder = getThemeColor(theme, 'textPlaceholder');
  const borderColor = getThemeColor(theme, 'border');
  const primary = getThemeColor(theme, 'primary');
  const dangerColor = getThemeColor(theme, 'danger');
  const successColor = getThemeColor(theme, 'success');

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
    <YStack flex={1} backgroundColor={bg}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Chat',
          headerTintColor: textColor,
          headerStyle: { backgroundColor: bgSecondary },
          headerLeft: () => (
            <Button
              onPress={() => router.back()}
              width={32}
              height={32}
              borderRadius={16}
              backgroundColor="transparent"
              borderWidth={0}
              padding={0}
              justifyContent="center"
              alignItems="center"
            >
              <Ionicons name="arrow-back" size={22} color={textColor} />
            </Button>
          ),
        }}
      />

      <ScrollView
        flex={1}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <YStack padding={20}>
          <SizableText
            fontSize={28}
            fontWeight="700"
            color={textColor}
            marginBottom={24}
          >
            Configuration
          </SizableText>

          {/* QR Code Scan */}
          <Button
            onPress={() => router.navigate('/scan')}
            backgroundColor={bgSecondary}
            borderRadius={14}
            height={50}
            alignItems="center"
            justifyContent="center"
            marginBottom={16}
            borderWidth={1}
            borderColor={borderColor}
            pressStyle={{ opacity: 0.7 }}
          >
            <XStack gap={10} alignItems="center">
              <Ionicons name="qr-code-outline" size={20} color={textColor} />
              <SizableText fontSize={15} fontWeight="600" color={textColor}>
                Scanner un QR code
              </SizableText>
            </XStack>
          </Button>

          {/* URL Section */}
          <YStack
            backgroundColor={bgSecondary}
            borderRadius={14}
            padding={16}
            marginBottom={16}
            borderWidth={1}
            borderColor={borderColor}
          >
            <SizableText
              fontSize={13}
              fontWeight="600"
              color={textSecondary}
              marginBottom={8}
              textTransform="uppercase"
              letterSpacing={0.5}
            >
              URL WebSocket
            </SizableText>
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="ws://<host>:<port>"
              placeholderTextColor={textPlaceholder as ColorTokens}
              backgroundColor={bgInput}
              borderRadius={10}
              paddingHorizontal={14}
              paddingVertical={12}
              fontSize={15}
              color={textColor}
              borderWidth={1}
              borderColor={borderColor}
            />
            <SizableText
              fontSize={12}
              color={textPlaceholder}
              marginTop={8}
            >
              L'URL du serveur Companion WebSocket
            </SizableText>
          </YStack>

          {/* Token Section */}
          <YStack
            backgroundColor={bgSecondary}
            borderRadius={14}
            padding={16}
            marginBottom={24}
            borderWidth={1}
            borderColor={borderColor}
          >
            <SizableText
              fontSize={13}
              fontWeight="600"
              color={textSecondary}
              marginBottom={8}
              textTransform="uppercase"
              letterSpacing={0.5}
            >
              Token (optionnel)
            </SizableText>
            <Input
              value={token}
              onChangeText={setToken}
              placeholder="Token de connexion"
              placeholderTextColor={textPlaceholder as ColorTokens}
              secureTextEntry
              backgroundColor={bgInput}
              borderRadius={10}
              paddingHorizontal={14}
              paddingVertical={12}
              fontSize={15}
              color={textColor}
              borderWidth={1}
              borderColor={borderColor}
            />
            <SizableText
              fontSize={12}
              color={textPlaceholder}
              marginTop={8}
            >
              Si le serveur est protégé par un token (COMPANION_TOKEN)
            </SizableText>
          </YStack>

          {/* Save Button */}
          <Button
            onPress={handleSave}
            disabled={saving}
            backgroundColor={saving ? bgTertiary : '#10A37F'}
            borderRadius={14}
            height={50}
            alignItems="center"
            justifyContent="center"
            marginBottom={16}
            pressStyle={{ opacity: 0.8 }}
          >
            <SizableText
              fontSize={16}
              fontWeight="600"
              color="#fff"
            >
              {saving ? 'Sauvegarde...' : 'Sauvegarder'}
            </SizableText>
          </Button>

          {/* Saved Config */}
          {saved && (
            <YStack
              backgroundColor="rgba(46,213,115,0.08)"
              borderRadius={14}
              padding={16}
              marginBottom={16}
              borderWidth={1}
              borderColor="rgba(46,213,115,0.2)"
            >
              <SizableText
                fontSize={13}
                fontWeight="600"
                color={successColor}
                marginBottom={12}
                textTransform="uppercase"
                letterSpacing={0.5}
              >
                Configuration actuelle
              </SizableText>
              <XStack marginBottom={6}>
                <SizableText
                  fontSize={14}
                  fontWeight="600"
                  color={textSecondary}
                  width={60}
                >
                  URL :
                </SizableText>
                <SizableText
                  fontSize={14}
                  color={textColor}
                  flex={1}
                  numberOfLines={2}
                >
                  {saved.url}
                </SizableText>
              </XStack>
              <XStack>
                <SizableText
                  fontSize={14}
                  fontWeight="600"
                  color={textSecondary}
                  width={60}
                >
                  Token :
                </SizableText>
                <SizableText
                  fontSize={14}
                  color={textColor}
                >
                  {saved.token ? '••••••••' : '(aucun)'}
                </SizableText>
              </XStack>
            </YStack>
          )}

          {/* Reset Button */}
          <Button
            onPress={handleReset}
            backgroundColor="transparent"
            borderWidth={0}
            height={44}
            marginBottom={32}
            alignItems="center"
            justifyContent="center"
          >
            <SizableText
              fontSize={15}
              fontWeight="600"
              color={dangerColor}
            >
              Réinitialiser
            </SizableText>
          </Button>

          {/* Info Section */}
          <YStack
            backgroundColor={bgSecondary}
            borderRadius={14}
            padding={16}
            borderWidth={1}
            borderColor={borderColor}
          >
            <SizableText
              fontSize={17}
              fontWeight="700"
              color={textColor}
              marginBottom={14}
            >
              Comment connecter Arya
            </SizableText>
            <SizableText
              fontSize={14}
              color={textSecondary}
              lineHeight={22}
              marginBottom={8}
            >
              1. Démarre Arya avec les variables d'environnement :
            </SizableText>
            <YStack
              backgroundColor={bgInput}
              borderRadius={10}
              padding={12}
              marginBottom={12}
            >
              <SizableText
                fontSize={13}
                fontFamily="$body"
                color={textColor}
                lineHeight={22}
              >
                COMPANION_PORT=3001 \{'\n'}COMPANION_TOKEN=monsecret
              </SizableText>
            </YStack>
            <SizableText
              fontSize={14}
              color={textSecondary}
              lineHeight={22}
              marginBottom={8}
            >
              2. Note l'URL affichée dans la console
            </SizableText>
            <SizableText
              fontSize={14}
              color={textSecondary}
              lineHeight={22}
            >
              3. Colle-la dans le champ URL ci-dessus
            </SizableText>
          </YStack>
        </YStack>
      </ScrollView>
    </YStack>
  );
}
