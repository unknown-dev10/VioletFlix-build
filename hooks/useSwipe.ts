import { useRef } from 'react';
import { PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
}

export function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  threshold = 50
}: SwipeConfig) {
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderEnd: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const { dx, dy } = gestureState;
        
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > threshold && onSwipeRight) onSwipeRight();
          else if (dx < -threshold && onSwipeLeft) onSwipeLeft();
        } else {
          if (dy > threshold && onSwipeDown) onSwipeDown();
          else if (dy < -threshold && onSwipeUp) onSwipeUp();
        }
      }
    })
  ).current;

  return panResponder.panHandlers;
}
