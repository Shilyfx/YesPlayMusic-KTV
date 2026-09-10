# 打包与启动诊断

## 本地命令

```powershell
$env:NODE_OPTIONS='--openssl-legacy-provider'
npm.cmd run build
npm.cmd run electron:build-win
```

`electron:build-win` 当前生成：

- `dist_electron/YesPlayMusic 0.4.10.exe`
- `dist_electron/YesPlayMusic Setup 0.4.10.exe`

打包后的 `app.asar` 应包含：

- `remote/index.html`
- `remote/js/remote.*.js`
- `remote/css/remote.*.css`

Remote 目录只允许引用自身的相对 JS/CSS 资源，不能回退到根目录桌面 bundle。

## 启动诊断

- 桌面本地服务：`http://127.0.0.1:27232`
- 健康检查：`GET /__health`
- 关键状态：`desktopServer`、`renderer`、`neteaseApi`、`stage`
- 主进程日志：Electron 日志目录，可从启动超时遮罩点击“打开日志目录”。

常见状态：

- `DESKTOP_HTTP_ERROR`：27232 被占用或监听失败。
- `NCM_API_ERROR`：内置网易云 API 启动失败；页面 API 请求会返回 503。
- `DID_FAIL_LOAD`：renderer URL/资源加载失败。
- `RENDER_PROCESS_GONE`：renderer 崩溃；KTV 房间会被停止以清理旧会话。

## CI

`.github/workflows/packaging-validation.yml` 在 Windows 与 macOS runner 上执行
冻结依赖安装、对应 Electron 打包和产物存在性检查；该工作流不发布安装包、不修改防火墙。
