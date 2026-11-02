const fs = require('fs');
const path = require('path');

const DIR = 'D:\\APP\\音乐\\周杰伦';

const SONG_HEADERS = {
  '周杰伦 - 一路向北.lrc': [
    '[00:00.00]一路向北 - 周杰伦 (Jay Chou)',
    '[00:05.00]词：方文山',
    '[00:10.00]曲：周杰伦',
    '[00:15.00]编曲：蔡科俊',
    '[00:20.00]制作人：周杰伦',
    '[00:25.00]电影《头文字D》插曲',
  ],
  '周杰伦 - 七里香.lrc': [
    '[00:00.00]七里香 - 周杰伦 (Jay Chou)',
    '[00:05.00]词：方文山',
    '[00:10.00]曲：周杰伦',
    '[00:15.00]编曲：钟兴民',
    '[00:20.00]制作人：周杰伦',
  ],
  '周杰伦 - 以父之名.lrc': [
    '[00:00.00]以父之名 - 周杰伦 (Jay Chou)',
    '[00:04.00]词：黄俊郎',
    '[00:08.00]曲：周杰伦',
    '[00:12.00]编曲：洪敬尧',
    '[00:16.00]制作人：周杰伦',
    '[00:20.00]Ave Maria, grazia ricevuta per la mia famiglia (万福玛利亚 为我的家庭获得恩典)',
    '[00:34.00]Con risentito con un\'amorevole divino amen (怀着感恩与神圣的爱 阿门)',
    '[00:46.00]Grazie chiedo a te o signore divino (神圣的主啊 我向您祈求恩典)',
    '[00:58.00]In questo giorno di grazia prego per te (在这充满恩典的日子里 我为您祈祷)',
    '[01:08.00]Ave Maria, piena di grazia (万福玛利亚 满溢圣宠)',
    '[01:17.00]Il signore e con te (主与您同在)',
  ],
  '周杰伦 - 反方向的钟.lrc': [
    '[00:00.00]反方向的钟 - 周杰伦 (Jay Chou)',
    '[00:05.00]词：方文山',
    '[00:10.00]曲：周杰伦',
    '[00:15.00]编曲：周杰伦',
    '[00:20.00]制作人：周杰伦',
    '[00:25.73]ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏ',
    '[00:30.15]ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐ',
    '[00:35.17]ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏ',
    '[00:40.12]ㄅㄆㄇㄈㄉㄊㄋㄌ',
  ],
  '周杰伦 - 听妈妈的话.lrc': [
    '[00:00.00]听妈妈的话 - 周杰伦 (Jay Chou)',
    '[00:01.00]词：周杰伦',
    '[00:02.00]曲：周杰伦',
    '[00:03.00]编曲：林迈可 / 洪敬尧',
    '[00:04.00]制作人：周杰伦',
  ],
  '周杰伦 - 夜曲.lrc': [
    '[00:00.00]夜曲 - 周杰伦 (Jay Chou)',
    '[00:04.50]词：方文山',
    '[00:09.00]曲：周杰伦',
    '[00:13.50]编曲：林迈可',
    '[00:18.00]制作人：周杰伦',
  ],
  '周杰伦 - 我是如此相信.lrc': [
    '[00:00.00]我是如此相信 - 周杰伦 (Jay Chou)',
    '[00:05.00]词：方文山',
    '[00:10.00]曲：周杰伦',
    '[00:15.00]编曲：黄雨勋',
    '[00:20.00]制作人：周杰伦',
    '[00:25.00]电影《天火》主题曲',
  ],
  '周杰伦 - 明明就.lrc': [
    '[00:00.00]明明就 - 周杰伦 (Jay Chou)',
    '[00:03.50]词：方文山',
    '[00:07.00]曲：周杰伦',
    '[00:10.50]编曲：黄雨勋',
    '[00:14.00]制作人：周杰伦',
  ],
  '周杰伦 - 晴天.lrc': [
    '[00:00.00]晴天 - 周杰伦 (Jay Chou)',
    '[00:04.50]词：周杰伦',
    '[00:09.00]曲：周杰伦',
    '[00:13.50]编曲：周杰伦',
    '[00:18.00]制作人：周杰伦',
    '[00:22.50]吉他：蔡科俊',
  ],
  '周杰伦 - 稻香.lrc': [
    '[00:00.00]稻香 - 周杰伦 (Jay Chou)',
    '[00:05.00]词：周杰伦',
    '[00:10.00]曲：周杰伦',
    '[00:15.00]编曲：黄雨勋',
    '[00:20.00]制作人：周杰伦',
  ],
  '周杰伦 - 简单爱.lrc': [
    '[00:00.00]简单爱 - 周杰伦 (Jay Chou)',
    '[00:05.00]词：徐若瑄',
    '[00:10.00]曲：周杰伦',
    '[00:15.00]编曲：林迈可',
    '[00:20.00]制作人：周杰伦',
  ],
  '周杰伦 - 给我一首歌的时间.lrc': [
    '[00:00.00]给我一首歌的时间 - 周杰伦 (Jay Chou)',
    '[00:03.50]词：周杰伦',
    '[00:07.00]曲：周杰伦',
    '[00:10.50]编曲：林迈可',
    '[00:14.00]制作人：周杰伦',
  ],
  '周杰伦 - 说好的幸福呢.lrc': [
    '[00:00.00]说好的幸福呢 - 周杰伦 (Jay Chou)',
    '[00:04.50]词：方文山',
    '[00:09.00]曲：周杰伦',
    '[00:13.50]编曲：钟兴民',
    '[00:18.00]制作人：周杰伦',
  ],
};

function cleanAndPatchLrc(fileName) {
  const filePath = path.join(DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  // Remove existing header credits if already present (e.g. in 简单爱), watermarks, and empty lines at start
  const cleanedBody = [];
  let reachedLyrics = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      if (reachedLyrics) cleanedBody.push(line);
      continue;
    }

    // Skip watermarks
    if (trimmed.includes('无左无右') || /246115905/.test(trimmed)) {
      continue;
    }

    // Check if this line is an old credit line (for 简单爱 or previous runs)
    if (!reachedLyrics) {
      if (/\[\d{2}:\d{2}[.:]\d{2,3}\]\s*(词[：:]|曲[：:]|编曲[：:]|制作人[：:]|作词[：:]|作曲[：:]|吉他[：:]|.*-[^\[\]]+)/.test(trimmed)) {
        continue;
      }
      // Check if it's Italian monologue or bopomofo from earlier run
      if (/\[\d{2}:\d{2}[.:]\d{2,3}\]\s*(Ave Maria|Con risentito|Grazie chiedo|In questo giorno|Il signore|ㄅㄆㄇㄈ)/.test(trimmed)) {
        continue;
      }
      reachedLyrics = true;
    }

    cleanedBody.push(line);
  }

  const headers = SONG_HEADERS[fileName] || [];
  const newContent = [...headers, ...cleanedBody].join('\r\n') + '\r\n';

  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log(`Successfully updated: ${fileName} (${headers.length} header lines prepended)`);
}

console.log('Starting Jay Chou LRC patch process...');
Object.keys(SONG_HEADERS).forEach(fileName => {
  cleanAndPatchLrc(fileName);
});
console.log('All 13 LRC files processed.');
