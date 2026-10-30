import React from 'react';
import type { Theme } from '../../../../vendor/folia-complete/src/types';
import FluidBackground from '../../../../vendor/folia-complete/src/components/visualizer/backgrounds/common/FluidBackground';
import GeometricBackground from '../../../../vendor/folia-complete/src/components/visualizer/backgrounds/common/GeometricBackground';
import { resolveCommonOverlayOpacity } from '../rendererContracts';
import { getStableFoliaAudioSignals } from '../smartBeatRender';

const { audioPower, audioBands } = getStableFoliaAudioSignals('common');

type CommonTuning = {
  useCoverColorBg?: boolean;
  opacity?: number;
  disableGeometricBackground?: boolean;
  disableVignette?: boolean;
};

export interface FoliaBackgroundOptions {
  mode: 'legacy' | 'common';
  tuning?: CommonTuning;
  transparent?: boolean;
  opacity?: number;
}

interface CommonBackgroundProps {
  background: FoliaBackgroundOptions;
  theme: Theme;
  coverUrl: string;
  seed: string;
  paused: boolean;
  staticMode: boolean;
}

const CommonBackground: React.FC<CommonBackgroundProps> = ({
  background,
  theme,
  coverUrl,
  seed,
  paused,
  staticMode,
}) => {
  const tuning = background.tuning ?? {};
  const useCoverColorBg = tuning.useCoverColorBg ?? false;
  const sourceOpacity = resolveCommonOverlayOpacity(background);

  if (background.mode !== 'common') return null;

  return (
    <div className='folia-complete-common-background' aria-hidden='true'>
      {useCoverColorBg && coverUrl && (
        <div className='absolute inset-0 z-0'>
          <FluidBackground coverUrl={coverUrl} theme={theme} />
        </div>
      )}
      <div
        className='absolute inset-0 z-0 transition-all duration-1000'
        style={{
          backgroundColor: theme.backgroundColor,
          opacity: useCoverColorBg ? sourceOpacity : 1,
        }}
      />
      {!staticMode && (
        <div className='absolute inset-0 z-0'>
          <GeometricBackground
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            seed={seed}
            hideShapes={tuning.disableGeometricBackground ?? false}
            disableVignette={tuning.disableVignette ?? false}
            paused={paused}
          />
        </div>
      )}
    </div>
  );
};

export default CommonBackground;
