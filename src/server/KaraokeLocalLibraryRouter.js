import { promises as fs } from 'fs';

export function isKaraokeLocalLibraryRoute(route) {
  return route.startsWith('/ktv/local/');
}

export function createKaraokeLocalLibraryRouter(host) {
  return async function handleLocalRoute(request, response, route) {
    if (!host.localLibrary) {
      return host.json(response, 404, { error: 'LOCAL_LIBRARY_UNAVAILABLE' });
    }
    await host.localDirsReady;

    const audioMatch = route.match(
      /^\/ktv\/local\/audio\/(local-[a-f0-9]{16})$/i
    );
    if (audioMatch) {
      if (request.method !== 'GET')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      await host.localLibrary.ensureIndexed();
      const resolved = await host.localLibrary.resolve(audioMatch[1]);
      if (!resolved || !resolved.audioPath)
        return host.roomServer.notFound(response);
      return host.roomServer.sendLocalAudio(
        resolved.audioPath,
        request,
        response
      );
    }

    const coverMatch = route.match(
      /^\/ktv\/local\/cover\/(local-[a-f0-9]{16})$/i
    );
    if (coverMatch) {
      if (request.method !== 'GET')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      await host.localLibrary.ensureIndexed();
      const resolved = await host.localLibrary.resolve(coverMatch[1]);
      if (!resolved || !resolved.coverPath)
        return host.roomServer.notFound(response);
      return host.roomServer.sendLocalCover(resolved.coverPath, response);
    }

    const resolveMatch = route.match(
      /^\/ktv\/local\/resolve\/(local-[a-f0-9]{16})$/i
    );
    if (resolveMatch) {
      if (request.method !== 'GET')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      await host.localLibrary.ensureIndexed();
      const localId = resolveMatch[1];
      const resolved = await host.localLibrary.resolve(localId);
      if (!resolved)
        return host.json(response, 404, {
          ok: false,
          error: 'LOCAL_TRACK_NOT_FOUND',
        });
      return host.json(response, 200, {
        ok: true,
        localId: resolved.localId,
        name: resolved.name,
        artists: resolved.artists,
        lyrics: resolved.lyrics || [],
        audioPath: resolved.audioPath,
        audioUrl: host.getLocalAudioUrl(localId),
        coverUrl: resolved.coverPath ? host.getLocalCoverUrl(localId) : '',
      });
    }

    if (route === '/ktv/local/list') {
      if (request.method !== 'GET')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      const playlists = await host.getLocalPlaylists();
      return host.json(response, 200, {
        ok: true,
        directories: host.localLibrary.listDirectories(),
        playlists,
      });
    }

    if (route === '/ktv/local/scan') {
      if (request.method !== 'POST')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      const playlists = host.decorateLocalPlaylists(
        await host.localLibrary.scan()
      );
      return host.json(response, 200, {
        ok: true,
        directories: host.localLibrary.listDirectories(),
        playlists,
      });
    }

    if (route === '/ktv/local/add-directory') {
      if (request.method !== 'POST')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      try {
        const body = await host.readBody(request);
        const dir = String(body.directory || '').trim();
        if (!dir)
          return host.json(response, 400, {
            ok: false,
            error: '请输入有效的音乐目录路径',
          });
        try {
          const stat = await fs.stat(dir);
          if (!stat.isDirectory()) {
            return host.json(response, 400, {
              ok: false,
              error: `路径不是有效目录：${dir}`,
            });
          }
        } catch (_) {
          return host.json(response, 400, {
            ok: false,
            error: `服务器目录不存在或不可访问：${dir}`,
          });
        }
        host.localLibrary.addDirectories([dir]);
        await host.saveLocalDirectories();
        const playlists = host.decorateLocalPlaylists(
          await host.localLibrary.scan()
        );
        return host.json(response, 200, {
          ok: true,
          directories: host.localLibrary.listDirectories(),
          playlists,
        });
      } catch (error) {
        return host.json(response, 400, { ok: false, error: error.message });
      }
    }

    if (route === '/ktv/local/remove-directory') {
      if (request.method !== 'POST')
        return host.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      try {
        const body = await host.readBody(request);
        const dir = String(body.directory || '').trim();
        host.localLibrary.removeDirectory(dir);
        await host.saveLocalDirectories();
        const playlists = host.decorateLocalPlaylists(
          await host.localLibrary.scan()
        );
        return host.json(response, 200, {
          ok: true,
          directories: host.localLibrary.listDirectories(),
          playlists,
        });
      } catch (error) {
        return host.json(response, 400, { ok: false, error: error.message });
      }
    }

    return host.json(response, 404, { error: 'NOT_FOUND' });
  };
}
