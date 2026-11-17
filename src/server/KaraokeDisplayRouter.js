export function isKaraokeDisplayRoute(route) {
  return (
    route === '/ktv/display' ||
    route === '/ktv/display/appearance' ||
    route === '/ktv/display/analysis' ||
    route === '/ktv/display/lyrics' ||
    route.startsWith('/ktv/display/visual-assets/')
  );
}

export function createKaraokeDisplayRouter(host) {
  return async function handleKaraokeDisplayRoute(
    request,
    response,
    url,
    route
  ) {
    if (route.startsWith('/ktv/display/visual-assets/')) {
      if (request.method !== 'GET') {
        host.json(response, 405, { error: 'READ_ONLY' });
        return true;
      }
      const match = route.match(
        /^\/ktv\/display\/visual-assets\/([a-f0-9]{64})$/
      );
      if (!match) {
        host.json(response, 404, { error: 'NOT_FOUND' });
        return true;
      }
      await host.handleVisualAssetRead(request, response, match[1]);
      return true;
    }

    if (route === '/ktv/display') {
      if (request.method !== 'GET') {
        host.json(response, 405, { error: 'READ_ONLY' });
        return true;
      }
      const owner = host.owner;
      host.json(
        response,
        200,
        owner
          ? {
              active: true,
              generation: host.generation,
              hostName: owner.name,
              stale:
                !owner.presentation || host.now() - owner.presentedAt > 5000,
              updatedAt: owner.presentedAt,
              serverTime: host.now(),
              presentation: owner.presentation,
              smartBeatRevision: owner.smartBeatRevision || 0,
              smartBeatTrackKey: owner.presentation?.smartBeat?.trackKey || '',
              appearanceRevision: owner.appearanceRevision,
              pvLyricsRevision: owner.pvLyrics?.revision ?? null,
              pvLyricsItemId: owner.pvLyrics?.itemId ?? null,
              joinUrl: host.guestJoinUrl(request),
              nextTrack: host.nextDisplayTrack(),
              reactions: host.recentReactions(),
              reactionEpoch: host.reactionEpoch,
              ...(owner.uiRevision ? { hostUiRevision: owner.uiRevision } : {}),
            }
          : { active: false }
      );
      return true;
    }

    if (route === '/ktv/display/appearance') {
      if (request.method !== 'GET') {
        host.json(response, 405, { error: 'READ_ONLY' });
        return true;
      }
      const owner = host.owner;
      if (
        !owner ||
        url.searchParams.get('generation') !== String(host.generation) ||
        url.searchParams.get('revision') !== String(owner.appearanceRevision)
      ) {
        host.json(response, 409, { error: 'STALE_DISPLAY_APPEARANCE' });
        return true;
      }
      host.json(response, 200, {
        generation: host.generation,
        revision: owner.appearanceRevision,
        config: owner.appearance,
      });
      return true;
    }

    if (route === '/ktv/display/analysis') {
      if (request.method !== 'GET') {
        host.json(response, 405, { error: 'READ_ONLY' });
        return true;
      }
      const owner = host.owner;
      if (
        !owner ||
        url.searchParams.get('generation') !== String(host.generation) ||
        url.searchParams.get('revision') !== String(owner.smartBeatRevision)
      ) {
        host.json(response, 409, { error: 'STALE_SMART_BEAT_ANALYSIS' });
        return true;
      }
      host.json(response, 200, {
        generation: host.generation,
        revision: owner.smartBeatRevision,
        timeline: owner.smartBeatTimeline,
      });
      return true;
    }

    // Same public, read-only capability as /ktv/display; never accept host writes.
    if (route === '/ktv/display/lyrics') {
      if (request.method !== 'GET') {
        host.json(response, 405, { error: 'READ_ONLY' });
        return true;
      }
      const document = host.owner?.pvLyrics;
      if (
        !document ||
        url.searchParams.get('generation') !== String(host.generation) ||
        url.searchParams.get('revision') !== String(document.revision)
      ) {
        host.json(response, 409, { error: 'STALE_PV_LYRICS' });
        return true;
      }
      host.json(response, 200, document);
      return true;
    }

    return false;
  };
}
