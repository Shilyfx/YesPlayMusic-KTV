<template>
  <div class="newAlbum">
    <h1>{{ $t('home.newAlbum') }}</h1>
    <div class="playlist-row">
      <div class="playlists">
        <div v-if="error" class="load-state"> 新专辑加载失败，请稍后重试 </div>
        <div v-else-if="show && !albums.length" class="load-state">
          暂无可显示的新专辑
        </div>
        <CoverRow
          v-else
          type="album"
          :items="albums"
          sub-text="artist"
          :show-play-button="true"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { newAlbums } from '@/api/album';
import NProgress from 'nprogress';

import CoverRow from '@/components/CoverRow.vue';

export default {
  components: {
    CoverRow,
  },
  data() {
    return {
      albums: [],
      show: false,
      error: false,
    };
  },
  created() {
    newAlbums({
      area: 'EA',
      limit: 100,
    })
      .then(data => {
        this.albums = data?.albums || [];
        this.show = true;
        NProgress.done();
      })
      .catch(error => {
        this.show = true;
        this.error = true;
        NProgress.done();
        console.warn('[new-album] loading failed', error);
      });
  },
};
</script>

<style lang="scss" scoped>
h1 {
  color: var(--color-text);
  font-size: 56px;
}
.load-state {
  padding: 56px 0;
  color: var(--color-secondary);
  text-align: center;
}
</style>
