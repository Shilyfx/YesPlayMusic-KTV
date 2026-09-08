export default class KaraokeLanLifecycle {
  constructor(karaokeServer) {
    this.karaokeServer = karaokeServer;
    this.sessionActive = false;
  }

  async setSessionActive(active) {
    this.sessionActive = Boolean(active);
    if (!this.sessionActive) await this.karaokeServer.stopRoom();
    return this.status();
  }

  async startRoom(options) {
    if (!this.sessionActive) {
      throw new Error('请先开始本机 KTV，再开启局域网房间');
    }
    return this.karaokeServer.startRoom(options);
  }

  async stopRoom() {
    return this.karaokeServer.stopRoom();
  }

  async status() {
    return {
      sessionActive: this.sessionActive,
      room: await this.karaokeServer.describeRoom(),
    };
  }
}
