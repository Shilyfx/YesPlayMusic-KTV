import { KARAOKE_SESSION_STATUS } from './constants';

let sessionSequence = 0;

export default class KaraokeSession {
  constructor() {
    this.sessionId = null;
    this.status = KARAOKE_SESSION_STATUS.IDLE;
    this.createdAt = null;
    this.startedAt = null;
    this.endedAt = null;
  }

  start() {
    if (this.status === KARAOKE_SESSION_STATUS.ACTIVE) return this;
    const now = new Date().toISOString();
    sessionSequence += 1;
    this.sessionId = `local-ktv-${Date.now()}-${sessionSequence}`;
    this.status = KARAOKE_SESSION_STATUS.ACTIVE;
    this.createdAt = now;
    this.startedAt = now;
    this.endedAt = null;
    return this;
  }

  end() {
    if (this.status !== KARAOKE_SESSION_STATUS.ACTIVE) return this;
    this.status = KARAOKE_SESSION_STATUS.ENDED;
    this.endedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }
}
