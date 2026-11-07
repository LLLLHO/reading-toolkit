# 阅读工具箱

给「阅读」App 用的排版辅助工具集。**纯静态、单文件、零依赖**：没有 npm、没有构建、没有 CDN，每个工具都是一个自带 CSS/JS 的 HTML，双击就能用。

## 在线地址

https://llllho.github.io/reading-toolkit/

## 工具一览

| 工具 | 文件 | 用途 |
|---|---|---|
| 字体修改工具 | `font-tool.html` | 改字体、字号、字重等排版参数 |
| 对话高亮生成器 | `highlight.html` | 生成对话高亮规则 |
| 页面模板编辑器 | `template-editor.html` | 编辑 ARC 页面模板，预览首页/续页 |
| ARC 页面模板简易制作器 | `template-maker.html` | 可视化搭版，导出 readerTemplate.json，支持「✨ AI 搭版」 |
| 阅读相关网站 | `links.html` | 阅读相关工具与资源导航 |

## 文件名映射

源码目录里用的是中文文件名，本仓库统一改为 ASCII，避免网址出现 `%E5%AD%97%E4%BD%93...` 这类编码（转发时容易被截断）。

| 中文原名 | 本仓库 |
|---|---|
| 字体修改工具.html | font-tool.html |
| 对话高亮生成器.html | highlight.html |
| 页面模板编辑器.html | template-editor.html |
| ARC页面模板简易制作器.html | template-maker.html |
| 阅读相关网站.html | links.html |

旧的中文名都留有 `<meta refresh>` 跳转页，外链不会 404。

## 更新流程

源码在 `D:\ChromeDownloads\阅读ARC相关\阅读工具箱源码\`，本仓库只是它的英文名镜像，**不要直接在这里改**。

改完源码后，在 Git Bash 里运行：

```bash
bash "D:/ChromeDownloads/阅读ARC相关/同步到GitHub.sh"
```

脚本会复制 6 个 HTML（顺带把 index.html 里的中文链接换成英文名）、提交、推送。推送后 GitHub Actions 自动部署，1 分钟内生效。

## 说明

- **localStorage 按域名隔离**：换到 `llllho.github.io` 之后，之前在别的域名下存的模板、配置、AI Key 读不到，需要重新配置。
- 主站仍在 WorkBuddy 托管地址，本仓库是备份 / 开源镜像。
- `template-editor.html` 约 4.5MB，首次加载在移动端会慢一些（Pages 自带 CDN 和 gzip 压缩，能缓解）。

## 部署

`.github/workflows/deploy-pages.yml`：push 到 `main` 触发，`actions/upload-pages-artifact` 传整仓，`actions/deploy-pages` 发布。Pages 的 Source 已设为 **GitHub Actions**（`build_type=workflow`）。

## 本机环境备忘

这台机器上 git 走 GitHub 需要两处本地配置，已写进本仓库 `.git/config`，换机器要重设：

```bash
git config http.proxy http://127.0.0.1:7897      # Clash 代理，直连不通
git config http.sslBackend openssl                # schannel 吊销检查连不上 CRL
git config http.sslCAInfo "D:/WorkBuddy/resources/vendor/PortableGit/mingw64/etc/ssl/certs/ca-bundle.crt"
git config http.version HTTP/1.1                  # 否则 HTTP2 framing 报错
```

