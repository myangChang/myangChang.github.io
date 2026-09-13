---
title: 博客重构实录：从手写 HTML 到 Hexo + Fluid
date: 2026-09-13 12:20:00
categories:
  - 博客
tags:
  - Hexo
  - Fluid
  - GitHub Pages
  - Node.js
---

这篇记录一次完整的博客重构：换主题、升级环境，以及推送时踩到的坑。涉及的东西比较杂，按时间顺序写，方便以后翻回来查。

<!-- more -->

## 一、起点：一个半成品的手写站点

重构前的仓库里只有一个手写的 `index.html`，问题不少：

- 页面标题还停留在模板阶段的 “JavaScript Crash Course”；
- 正文是反复粘贴的 Lorem ipsum 占位文字，侧边栏是空的；
- 导航里的“科学研究 / 研究人员 / 联系我们”三个页面根本不存在，点进去就是 404；
- `index.js` 里是一段数组遍历的练习代码，和页面没有任何关系；
- 样式表是半成品，固定顶栏和正文还会重叠。

与其继续缝补，不如换成成熟的静态博客方案：写作用 Markdown，生成交给工具，样式交给主题。

## 二、选主题：为什么是 Fluid

几个热门主题对比下来：

| 主题 | 特点 | 是否合适 |
| --- | --- | --- |
| NexT | 老牌、生态最大，风格朴素，配置项偏多 | 稳，但观感偏“学院风” |
| Butterfly | 功能最全、国内用户多，卡片和动效密集 | 功能有余，简约不足 |
| **Fluid** | Material Design，留白干净，自带暗色模式和本地搜索 | ✅ 最终选择 |

Fluid 的中文文档完善、仍在活跃维护，整体观感是“简约大气”，符合这次的目标。

## 三、升级 Node：14.15 → 24 LTS

原来机器上是 Node 14（2020 年的版本），而最新版 Hexo 要求 Node ≥ 20，先升级环境。

### 1. 先摸清现状

```bash
node -v                 # v14.15.0
npm -v                  # 6.14.8
npm config get prefix   # D:\appFile\node\node_global
```

从目录结构看，Node 是绿色版解压安装（目录里有 `node.exe`、`npm.cmd`、`nodevars.bat`），所以直接替换 zip 内容即可，不用动 PATH。

### 2. 下载、校验、原地替换

```powershell
# 下载并校验（SHA256 必须和 SHASUMS256.txt 一致）
Invoke-WebRequest https://nodejs.org/dist/index.json -OutFile index.json
# …下载 node-v24.x.x-win-x64.zip，比对哈希后解压

# 备份旧版本，再放入新版本
Move-Item D:\appFile\node D:\appFile\node-v14.15.0-backup
Copy-Item .\extract\node-v24.x.x-win-x64\* D:\appFile\node -Recurse
```

因为安装目录没变，PATH、全局包目录（`node_global`）、npm 缓存都继续可用。

### 3. 踩到的坑：npm 版本还是旧的

换完之后 `node -v` 已经是 24，但 `npm -v` 却仍然输出 `6.14.8`。原因是新版 `npm.cmd` 的逻辑是：

```bat
FOR /F … IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO SET "NPM_PREFIX_NPM_CLI_JS=%%F\node_modules\npm\bin\npm-cli.js"
IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"
```

也就是说，它会优先使用**全局 prefix 目录下安装的 npm**。而 `node_global/node_modules/npm` 里还留着当年 `npm i -g npm` 装下的 6.14.8，于是 Node 换了、npm 没换。

处理办法很简单：把那个遗留的全局 npm 及其 shim 移出 `node_global`，让 npm 回落到 Node 自带的版本。

```bash
node -v   # v24.21.0
npm  -v   # 11.19.0
```

## 四、搭 Hexo 工程

### 1. 版本组合

```json
{
  "dependencies": {
    "hexo": "^8.1.2",
    "hexo-theme-fluid": "^1.9.9",
    "hexo-server": "^3.0.0",
    "hexo-renderer-marked": "^7.0.1",
    "hexo-renderer-stylus": "^3.0.1"
  }
}
```

### 2. 让 Pages 直接从 docs 目录发布

站点配置里指定生成目录：

```yaml
public_dir: docs
```

这样生成结果提交到仓库的 `docs/`，GitHub Pages 的发布源选 `master` + `/docs` 就能直接上线，源文件和生成结果放在同一个分支，日常维护最简单。

### 3. 主题配置的覆盖方式

主题自带一份 `_config.yml`，直接改它，升级主题时会被覆盖。正确做法是在站点根目录建 `_config.fluid.yml`：

```yaml
navbar:
  blog_title: ""
  menu:
    - { key: "home", link: "/", icon: "iconfont icon-home-fill" }
    - { key: "archive", link: "/archives/", icon: "iconfont icon-archive-fill" }
```

Hexo 会加载 `_config.<主题名>.yml`，再和主题默认配置深度合并，只有写到的字段被覆盖。

顺带一个发现：Fluid 1.9.9 自带搜索索引生成器（`scripts/generators/local-search.js`），所以不需要额外装 `hexo-generator-searchdb`，装了反而会多生成一份索引。

### 4. 必须加的 .nojekyll

这是最容易忽略、后果最严重的一个点。

GitHub Pages 用“分支 + 目录”发布时，默认会先跑一遍 Jekyll。而 Fluid 的搜索模板 `source/xml/local-search.xml` 会被原样复制到产物里，里面是 Nunjucks 语法：

```xml
{% for post in posts.toArray() %}
<link href="{{ [url, post.path] | urlJoin | uriencode }}"/>
{% endfor %}
```

Jekyll 会把它当 Liquid 模板解析，`urlJoin`、`noControlChars` 这些过滤器并不存在，构建就会失败。

解决办法是在产物根目录放一个 `.nojekyll` 文件，让 Pages 跳过 Jekyll。为了不被 `hexo clean` 清掉，用生成器自动产出：

```js
// scripts/nojekyll.js
hexo.extend.generator.register('nojekyll', () => ({
  path: '.nojekyll',
  data: ''
}));
```

## 五、推送踩的三个坑

### 坑 1：凭据失效

```text
remote: Invalid username or token. Password authentication is not supported for Git operations.
```

GitHub 早已不支持密码推送，本机的凭据管理器里也没有有效凭据。用 Git Credential Manager 重新登录即可：

```bash
git-credential-manager github login          # 浏览器授权
git-credential-manager github login --device # 或设备码方式
```

### 坑 2：github.com 的 443 连不上

授权完成后推送，卡在连接阶段：

```text
fatal: unable to access 'https://github.com/...': Failed to connect to github.com port 443
```

一步步排查：

```bash
nslookup github.com                                     # 解析正常
curl -o NUL -w "%{http_code}" https://api.github.com/   # 200
curl -o NUL -w "%{http_code}" https://raw.githubusercontent.com/  # 301
curl -o NUL -w "%{http_code}" https://github.com/       # 000（超时）
```

结论很明确：不是 DNS 问题，也不是凭据问题，而是**访问 github.com 这个域名的 443 端口恰好不通**，而同一台机器访问 GitHub 的其它域名、其它 IP 都正常。

临时绕过的思路：在本地起一个极小的 HTTP CONNECT 转发，把 git 发往 `github.com:443` 的连接转发到一个可用的 GitHub IP，然后让 git 走这个本地代理。

```js
// 思路示意：不转发域名，直接连一个已验证可达的 IP
const upstream = net.connect(443, '可用的 GitHub IP', () => {
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  client.pipe(upstream);
  upstream.pipe(client);
});
```

```bash
git -c http.proxy=http://127.0.0.1:8899 push origin master
```

推送成功后立刻停掉进程、删掉脚本。这只是一次性的救急手段，**不建议长期使用**：IP 会变，进程要常驻，也不是正经的代理。长期方案是改用 SSH（GitHub 的 22 / 443 端口都通），或者给 git 配上自己的代理。

### 坑 3：远端历史完全对不上

推送被拒：

```text
! [rejected] master -> master (fetch first)
```

`git fetch` 之后才发现问题所在：远端 `master` 上是 2022 年部署的另一个站点（Icarus 主题的 “CMY's Blog”），和本地历史**没有共同祖先**。本地这份拷贝是很久以前克隆的，远端早已被换成别的内容。

处理方式：

```bash
git branch backup/cmy-blog-2022 origin/master   # 旧内容先在本地留个分支
git push --force-with-lease origin master        # 用 --force-with-lease 而不是 --force
```

用 `--force-with-lease` 而不是 `--force`，可以在远端被他人更新时主动失败，避免误覆盖别人的提交。

## 六、Pages 构建与缓存

推送后站点没变，查了构建记录（`GET /repos/{owner}/{repo}/pages/builds/latest`）才看清过程：

- 第一次构建 `errored`；
- 紧接着的第二次构建 `built`（18 秒）；
- 但浏览器里看到的仍是旧页面。

前两条说明构建系统会自动重试，不用手动干预；最后一条是**CDN 缓存**——GitHub Pages 的 HTML 缓存大约 10 分钟，加个查询参数或强制刷新就能看到最新内容。

## 七、经验清单

- 换 Node 时用绿色版 zip 原地替换最省事，但记得检查 `node_global` 里有没有遗留的全局 npm 之类会“抢先”的包；
- 主题配置一律写在根目录的 `_config.<theme>.yml`，不要改 `node_modules` 里的文件；
- 用“分支 + 目录”发布 Pages 时，产物根目录一定要有 `.nojekyll`；
- 推送失败先分辨是**凭据问题**、**网络问题**还是**历史冲突**，三者的报错和解决方式完全不同；
- 覆盖远端前先 `fetch` 看清远端到底有什么，并用 `--force-with-lease` + 本地备份分支；
- 线上没更新不代表没部署成功，先看构建记录，再考虑缓存。

## 八、待办

- [ ] 配置 SSH 推送，摆脱对临时转发和 IP 的依赖；
- [ ] 把头像和关于页换成真实信息；
- [ ] 试试给文章加上评论（giscus）和访问统计。
