import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { useUnistyles } from '@/theme/ThemeContext';
import { parseCodeBlocks } from '@/utils/parseCodeBlocks';
import CodeBlock from './CodeBlock';
import InlineMarkdown from './InlineMarkdown';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  text: string;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  animate?: boolean;
}

function MessageContent({ text, textColor }: { text: string; textColor: string }) {
  const segments = parseCodeBlocks(text);

  if (segments.length === 1 && segments[0].type === 'text') {
    return <InlineMarkdown text={text} color={textColor} />;
  }

  return (
    <View style={{ marginHorizontal: -8 }}>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} code={seg.content} language={seg.language} />
        ) : (
          <View key={i} style={{ paddingHorizontal: 8 }}>
            <InlineMarkdown text={seg.content} color={textColor} />
          </View>
        ),
      )}
    </View>
  );
}

export default function ChatMessage({
  role,
  text,
  isFirstInGroup = true,
  isLastInGroup = true,
  animate = true,
}: ChatMessageProps) {
  const isUser = role === 'user';
  const { theme } = useUnistyles();
  const [copied, setCopied] = useState(false);

  const textColor = theme.colors.text;
  const bgTertiary = theme.colors.backgroundTertiary;

  const entering = animate
    ? isUser
      ? FadeInRight.duration(300).springify()
      : FadeInLeft.duration(300).springify()
    : undefined;

  const handleLongPress = useCallback(() => {
    Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 800);
  }, [text]);

  // Grouping: adjust spacing & radii
  const verticalPad = isFirstInGroup ? 4 : 1;
  const showAvatar = !isUser && isFirstInGroup;

  if (isUser) {
    return (
      <Animated.View entering={entering}>
        <View
          style={{
            alignItems: 'flex-end',
            paddingHorizontal: 16,
            paddingTop: verticalPad,
            paddingBottom: isLastInGroup ? 4 : 1,
          }}
        >
          <Pressable onLongPress={handleLongPress}>
            <View
              style={{
                maxWidth: '85%',
                backgroundColor: bgTertiary,
                borderRadius: 20,
                borderBottomRightRadius: isLastInGroup ? 6 : 16,
                borderTopRightRadius: isFirstInGroup ? 20 : 16,
                paddingHorizontal: 16,
                paddingVertical: 10,
                opacity: copied ? 0.6 : 1,
              }}
            >
              <MessageContent text={text} textColor={textColor} />
            </View>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  // Assistant: left-aligned bubble with icon
  return (
    <Animated.View entering={entering}>
      <View
        style={{
          alignItems: 'flex-start',
          paddingHorizontal: 16,
          paddingTop: verticalPad,
          paddingBottom: isLastInGroup ? 4 : 1,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            alignItems: 'flex-end',
            maxWidth: '85%',
          }}
        >
          {showAvatar ? (
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#FFFFFF',
                justifyContent: 'center',
                alignItems: 'center',
                flexShrink: 0,
                marginBottom: 2,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A1A' }}>A</Text>
            </View>
          ) : (
            <View style={{ width: 24, flexShrink: 0 }} />
          )}
          <Pressable onLongPress={handleLongPress} style={{ flex: 1 }}>
            <View
              style={{
                backgroundColor: bgTertiary,
                borderRadius: 20,
                borderBottomLeftRadius: isLastInGroup ? 6 : 16,
                borderTopLeftRadius: isFirstInGroup ? 20 : 16,
                paddingHorizontal: 16,
                paddingVertical: 10,
                opacity: copied ? 0.6 : 1,
              }}
            >
              <MessageContent text={text} textColor={textColor} />
            </View>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
