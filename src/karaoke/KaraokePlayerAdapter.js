export default class KaraokePlayerAdapter {
  constructor(player) {
    this.player = player;
  }

  playTrack(trackId) {
    return this.player.playTrackByID(trackId);
  }

  replay() {
    this.player.seek(0);
    this.player.play();
  }

  playOrPause() {
    this.player.playOrPause();
  }
}
