import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { XStack, YStack, SizableText, useTheme } from 'tamagui';
import { parseCodeBlocks } from '@/src/utils/parseCodeBlocks';
import CodeBlock from './CodeBlock';
import InlineMarkdown from './InlineMarkdown';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  text: string;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  animate?: boolean;
}

const getThemeColor = (theme: any, key: string): string => {
  const val = theme[key];
  if (val && typeof val.get === 'function') return val.get();
  return typeof val === 'string' ? val : '';
};

function MessageContent({ text, textColor }: { text: string; textColor: string }) {
  const segments = parseCodeBlocks(text);

  if (segments.length === 1 && segments[0].type === 'text') {
    return <InlineMarkdown text={text} color={textColor} />;
  }

  return (
    <YStack marginHorizontal={-8}>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} code={seg.content} language={seg.language} />
        ) : (
          <YStack key={i} paddingHorizontal={8}>
            <InlineMarkdown text={seg.content} color={textColor} />
          </YStack>
        ),
      )}
    </YStack>
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
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const textColor = getThemeColor(theme, 'text');
  const bgTertiary = getThemeColor(theme, 'backgroundTertiary');

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
        <YStack
          alignItems="flex-end"
          paddingHorizontal={16}
          paddingTop={verticalPad}
          paddingBottom={isLastInGroup ? 4 : 1}
        >
          <Pressable onLongPress={handleLongPress}>
            <YStack
              maxWidth="85%"
              backgroundColor={bgTertiary}
              borderRadius={20}
              borderBottomRightRadius={isLastInGroup ? 6 : 16}
              borderTopRightRadius={isFirstInGroup ? 20 : 16}
              paddingHorizontal={16}
              paddingVertical={10}
              opacity={copied ? 0.6 : 1}
            >
              <MessageContent text={text} textColor={textColor} />
            </YStack>
          </Pressable>
        </YStack>
      </Animated.View>
    );
  }

  // Assistant: left-aligned bubble with icon
  return (
    <Animated.View entering={entering}>
      <YStack
        alignItems="flex-start"
        paddingHorizontal={16}
        paddingTop={verticalPad}
        paddingBottom={isLastInGroup ? 4 : 1}
      >
        <XStack gap={8} alignItems="flex-end" maxWidth="85%">
          {showAvatar ? (
            <YStack
              width={24}
              height={24}
              borderRadius={12}
              backgroundColor="#FFFFFF"
              justifyContent="center"
              alignItems="center"
              flexShrink={0}
              marginBottom={2}
            >
              <SizableText fontSize={13} fontWeight="700" color="#1A1A1A">
                A
              </SizableText>
            </YStack>
          ) : (
            <YStack width={24} flexShrink={0} />
          )}
          <Pressable onLongPress={handleLongPress} style={{ flex: 1 }}>
            <YStack
              backgroundColor={bgTertiary}
              borderRadius={20}
              borderBottomLeftRadius={isLastInGroup ? 6 : 16}
              borderTopLeftRadius={isFirstInGroup ? 20 : 16}
              paddingHorizontal={16}
              paddingVertical={10}
              opacity={copied ? 0.6 : 1}
            >
              <MessageContent text={text} textColor={textColor} />
            </YStack>
          </Pressable>
        </XStack>
      </YStack>
    </Animated.View>
  );
}
