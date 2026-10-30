import { useMotionValue, type MotionValue } from 'framer-motion';

// The Vue stage has no Folia player bottom bar. Preserve the source subtitle overlay
// and its MotionValue contract with a small, host-local bottom inset.
export const usePlayerSubtitleBottomPx = (_isPlayerChromeHidden: boolean): MotionValue<number> =>
    useMotionValue(24);
