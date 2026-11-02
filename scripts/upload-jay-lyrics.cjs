const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LOCAL_DIR = 'D:\\APP\\音乐\\周杰伦';
const REMOTE_DIR = '/mnt/mmc1-4/lumasing/local-music/周杰伦';

const files = fs.readdirSync(LOCAL_DIR).filter(f => f.endsWith('.lrc'));

console.log(`Found ${files.length} LRC files to upload.`);

for (const file of files) {
  const localPath = path.join(LOCAL_DIR, file);
  const content = fs.readFileSync(localPath);
  const remotePath = `${REMOTE_DIR}/${file}`;
  
  const res = spawnSync('ssh', ['root@192.168.100.1', `cat > "${remotePath}"`], {
    input: content,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (res.error || res.status !== 0) {
    console.error(`Failed to upload ${file}:`, res.error || (res.stderr && res.stderr.toString()));
    process.exit(1);
  }
  console.log(`Uploaded: ${file} (${content.length} bytes)`);
}

console.log('All 13 LRC files uploaded successfully via stdin pipe.');
