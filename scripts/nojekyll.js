/* global hexo */

'use strict';

// 生成 .nojekyll，让 GitHub Pages 跳过 Jekyll 处理
// 否则 pages 会把站点里的 xml / 模板文件当成 Liquid 模板解析，可能导致构建失败
hexo.extend.generator.register('nojekyll', () => ({
  path: '.nojekyll',
  data: ''
}));
