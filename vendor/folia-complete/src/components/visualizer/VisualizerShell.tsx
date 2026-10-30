import React, { forwardRef } from 'react';
import type { MotionValue } from 'framer-motion';
import type { AudioBands, Theme } from '../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../utils/fontStacks';

interface VisualizerShellProps {
    theme: Theme;
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
    sharedProps?: unknown;
    visualizerOpacity?: number;
    renderBackground?: boolean;
    children: React.ReactNode;
    className?: string;
}

// LumaSing owns the outer stage and its independently rendered background. Keep only
// Folia's font and full-host layout seam; omit player, mod, and overlay reservations.
const VisualizerShell = forwardRef<HTMLDivElement, VisualizerShellProps>(({
    theme,
    visualizerOpacity = 1,
    children,
    className = '',
}, ref) => (
    <div
        ref={ref}
        className={`folia-complete-lyric-shell ${className}`.trim()}
        style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            backgroundColor: 'transparent',
            fontFamily: resolveThemeFontStack(theme),
            fontWeight: resolveThemeFontWeight(theme, 400),
            opacity: visualizerOpacity,
        }}
    >
        {children}
    </div>
));

VisualizerShell.displayName = 'FoliaCompleteStageShell';

export default VisualizerShell;
