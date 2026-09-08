export default class KaraokePlayerAdapter {
  constructor(player) {
    this.player = player;
  }

  playTrack(trackId) {
    return this.player.playTrackByID(trackId, {
      fallback: 'none',
      owner: 'karaoke',
    });
  }

  replay() {
    this.player.seek(0);
    this.player.play();
  }

  playOrPause() {
    this.player.playOrPause();
  }

  stop() {
    return this.player.stopKaraokePlayback();
  }

  onEnded(listener) {
    return this.player.onPlaybackEnded(listener);
  }

  onError(listener) {
    return this.player.onPlaybackError(listener);
  }

  setCommandHandlers(handlers) {
    this.player.setKaraokeCommandHandlers(handlers);
  }
}
