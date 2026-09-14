# libarchive WASM

项目的标准归档导出后端。日常流程直接校验并使用 `prebuilt/` 中随 Git 提供的产物；不会在安装、测试或开发启动时重新编译 C 依赖。

## 日常使用

```sh
npm run libarchive:build
npm test
npm run build
```

`libarchive:build` 验证 `prebuilt/manifest.json` 的源代码摘要和文件 SHA-256，然后复制到 `src/generated/libarchive/`。后者是工作区派生文件，不加入 Git。

源码包使用 `npm run source:pack` 生成；它会显式把 `prebuilt/` 加入临时 tarball 并输出 SHA-256。临时 tarball 不是恢复工作区的来源。

## 重建

只有更新 libarchive 或依赖时运行：

```sh
npm run libarchive:rebuild
```

此命令在仓库外缓存中下载 `sources.json` 指定的固定 revision，运行 `build.sh`，检查 Emscripten 静态库能力，链接严格的 C wrapper，并更新 `prebuilt/`、manifest 和许可证汇总。构建目录必须位于仓库外；源码副本、日志和 SHA-256 清单都保留在外部目录。

## 当前后端

libarchive 覆盖 ZIP、7z、CPIO、XAR，以及 TAR 的 GNU/PAX/USTAR/V7 变体和 gzip、bzip2、xz、zstd、lz4、lzma、lzip、传统 `compress`（`tar.Z`）过滤器。

项目保留 MKAR 自定义格式、CAB、LZH、AR 和 Brotli 路径。AR 保留 Rust 实现，因为 libarchive writer 会去掉成员路径前缀，不符合当前行为。

XAR 依赖 libxml2 xmlWriter、zlib 和 mbedTLS 摘要实现；预构建产物已通过 WASM、`bsdtar` 和 `7z` 互操作测试。XAR writer 使用 Emscripten 虚拟文件系统中的临时文件，生产集成需按峰值内存和不可信归档安全限制评估。

## 更新与检查

修改 `sources.json`、`build.sh` 或 `writer.c` 后，运行 `npm run libarchive:rebuild`；脚本会拒绝使用旧 manifest。提交前运行：

```sh
git diff --check
npm run test:archive
npm test
npm run test:rust
npx tsc -b
npm run build
```

`prebuilt/libarchive.wasm` 是项目唯一纳入 Git 的生成 WASM，由明确授权保留；必须始终与 `prebuilt/manifest.json` 的 SHA-256 一致。不要加入 `src/generated/libarchive/`、`dist/` 或 Rust `target/`。

## 构建耦合说明

预构建路径不依赖调用者的 Emscripten、CMake、Ninja、Git 或网络环境；这些只在显式 `libarchive:rebuild` 时需要。重建路径仍然不是完全 hermetic：它依赖本机 emsdk 版本、宿主 Unix 工具、网络下载和固定源码 checkout，且当前没有 Dockerfile、容器 digest 或 CI 构建矩阵。`build.sh` 已固定源码 revision、bzip2 SHA-256、静态链接和严格 undefined-symbol 检查，但还应视为可复现脚本而不是可移植构建系统。

如果要进一步降低环境差异，下一步应提供固定 emsdk digest 的 Dockerfile，并让 rebuild 在容器内完成；CI 只需运行该容器、校验 `prebuilt/manifest.json`，而不是在每次普通测试时编译。
