# 电商商品图与小红书推广预设来源

核验日期：2026-11-06。运行预设：`src/lib/commercePresets.ts`。原文参考目录：`templates/skills/`。

这次交付包括四个 AIPic 中文运行预设、每项一个完整的纯文字演示提示词，以及两份 MIT 授权仓库中的十三份原文文件。原文是参考数据；AIPic 提示词是针对现有图片接口所做的适配，不是上游逐字原文，也不把演示商品归为上游案例。

## 检索与选择

实际使用 GitHub CLI 搜索公开仓库：

```sh
gh search repos 'baoyu-skills' --limit 8 --json fullName,description,url
gh search repos 'ecommerce image skill' --limit 12 --json fullName,description,url
gh search repos 'product photography skill' --limit 12 --json fullName,description,url
```

随后通过 GitHub API 读取仓库元信息、默认分支的提交、该固定提交的完整文件树，以及具体源文件和许可证的内容。选用依据是实际文件中的方法和许可，未仅凭仓库描述认定可复用。

| 候选仓库 | 核验提交 | 许可与决定 |
| --- | --- | --- |
| [xianyu110/ecommerce-image-skills](https://github.com/xianyu110/ecommerce-image-skills) | `f4566fdc812584425728862ad8e08c90883d81ee` | 实际 `LICENSE` 为 MIT。白底商品、生活场景和小红书封面三份 skill 都有独立提示词模板、商品身份约束和明确构图方法，直接匹配三项功能，选用。 |
| [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) | `5792c7dc8d09a28d6969e8970166c5eb090ce6ad` | 实际根目录 `LICENSE` 为 MIT。`baoyu-xhs-images` 有内容密度、纸面笔记风、字体层级和画布布局参考，适合信息海报，选用。 |
| [beatra-ai/ai-product-photography-skill](https://github.com/beatra-ai/ai-product-photography-skill) | `f06f3d7b37a29ef2e0b9ef5bae45302f34eb1535` | 已读取 `LICENSE`、`product-photo-studio/SKILL.md` 与 `scene-craft.md`，实际许可为 MIT-0。其主要工作流绑定 Beatra MCP、上传、付费任务和结果追踪；本次已有更直接的独立电商提示词来源，因此未复制。 |
| [Hongggggggg/ecommerce-image-skill](https://github.com/Hongggggggg/ecommerce-image-skill) | `50a5a5d395b65cffb4ec9d3e9290a93c0d88353e` | GitHub 许可元数据为空，所检索文件树未发现 `LICENSE` 命名的许可文件；未取得明确可复用许可，未复制。 |
| [y4h2/ecommerce-image-skill](https://github.com/y4h2/ecommerce-image-skill) | `599f8ac91e7cc9749fcf5623f14d7b49c6746d3b` | GitHub 许可元数据为空，所检索文件树未发现 `LICENSE` 命名的许可文件；未取得明确可复用许可，未复制。 |

电商专用 skill 已找到并核验，因此没有使用泛化生图 skill 冒充电商来源。

## 固定版本、原文与归属

| 本地仓库目录 | 上游版本 | 原许可证与署名 |
| --- | --- | --- |
| `templates/skills/xianyu110-ecommerce-image-skills/` | [固定提交](https://github.com/xianyu110/ecommerce-image-skills/tree/f4566fdc812584425728862ad8e08c90883d81ee)，提交时间 `2026-10-08T11:38:18Z` | [MIT LICENSE 原文](https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/LICENSE)，`Copyright (c) 2026 xianyu110` |
| `templates/skills/baoyu-skills/` | [固定提交](https://github.com/JimLiu/baoyu-skills/tree/5792c7dc8d09a28d6969e8970166c5eb090ce6ad)，提交时间 `2026-11-02T19:25:27Z` | [MIT LICENSE 原文](https://github.com/JimLiu/baoyu-skills/blob/5792c7dc8d09a28d6969e8970166c5eb090ce6ad/LICENSE)，`Copyright (c) 2026 Jim Liu` |

两个根目录的许可证均原样保存，包含完整版权行、许可条件和原文声明。复制范围内未发现另行覆盖这些 skill 文本的局部许可证；baoyu 仓库其他软件包的许可证不用于本次 skill 文本。MIT 的版权和许可声明随副本一同保留。AIPic 适配代码没有改写或替代这些上游许可。

原文文件的复制清单如下；表中路径相对于对应的本地仓库目录，目录结构与上游一致。

| 仓库 | 原样复制路径 | 本次用途 |
| --- | --- | --- |
| xianyu110 | `LICENSE` | 完整许可和署名 |
| xianyu110 | `skills/amazon-white-background/SKILL.md` | 商品身份、纯白背景、主体占比、完整视角与接触阴影 |
| xianyu110 | `skills/lifestyle-scene/SKILL.md` | 真实尺度、使用场景、主光一致、有限陪衬 |
| xianyu110 | `skills/xiaohongshu-cover/SKILL.md` | 中文大标题、摄影主体、轻量装饰与封面层级 |
| baoyu | `LICENSE` | 完整许可和署名 |
| baoyu | `skills/baoyu-xhs-images/SKILL.md` | 风格与信息密度的组合、内容卡片结构 |
| baoyu | `skills/baoyu-xhs-images/references/presets/notion.md` | 黑灰文字、近白纸面、少量浅色强调与简洁线条 |
| baoyu | `skills/baoyu-xhs-images/references/elements/canvas.md` | 留白、内容密度、清单网格与安全区域 |
| baoyu | `skills/baoyu-xhs-images/references/elements/typography.md` | 标题、分组标题、正文的字级和中文排版 |
| baoyu | `skills/baoyu-xhs-images/references/elements/decorations.md` | 下划线、简单图标、圆角与分隔线 |
| baoyu | `skills/baoyu-xhs-images/references/elements/image-effects.md` | 清晰抠图边缘、轻量描边、纸纹与主体的区分 |
| baoyu | `skills/baoyu-xhs-images/references/style-layout-matrix.md` | 核对 notion 与 balanced、list 等布局的适配 |
| baoyu | `skills/baoyu-xhs-images/references/workflows/prompt-assembly.md` | 把画布、风格、布局与用户内容组织成完整提示词 |

原文合计 **13 个文件、72,265 字节**。复制时把 Contents API 解码后的字节与固定提交的 Git tree blob 核对；写入后再次计算 Git blob SHA-1 和 SHA-256。每个文件的实际校验值、字节数、上游路径、本地路径和固定提交链接记录在 `templates/skills/manifest.json` 中。没有对原文翻译、删节、换行归一化或插入 AIPic 注释。

这是选定功能所需的文本子集，不是完整安装包。仅复制四份 `SKILL.md`、七份小型提示词参考和两份许可证；原文指向其他配置、脚本或参考的链接原样保留，需要完整上下文时通过清单中的固定提交访问上游。没有复制或执行上游脚本、安装流程、工具选择、外部服务调用和发布操作。

## 运行预设与上游的对应关系

全部导出项遵循 `CommercePreset` 接口，`params` 使用本项目 `TaskParams` 的字段。统一为 `composition: 'poster'`、`quality: 'high'`、`n: 1`、`output_format: 'png'`。

| ID | category / group | 标题与场景 | previewStyle | 默认尺寸 | 主来源 |
| --- | --- | --- | --- | --- | --- |
| `commerce-product-hero` | `ecommerce` / 电商商品图 | 纯净商品主图：保真商品与纯白背景 | `product` | `1024x1024` | [amazon-white-background 原文](https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/skills/amazon-white-background/SKILL.md) |
| `commerce-lifestyle-ad` | `ecommerce` / 电商商品图 | 生活场景广告：可信使用环境与原文广告 | `lifestyle` | `1024x1536` | [lifestyle-scene 原文](https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/skills/lifestyle-scene/SKILL.md) |
| `xiaohongshu-product-cover` | `xiaohongshu` / 小红书推广 | 大字种草封面：中文大标题与商品摄影 | `redbook` | `1024x1536` | [xiaohongshu-cover 原文](https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/skills/xiaohongshu-cover/SKILL.md) |
| `xiaohongshu-info-poster` | `xiaohongshu` / 小红书推广 | 清单信息海报：纸面笔记与信息卡片 | `editorial` | `1024x1536` | [baoyu-xhs-images 原文](https://github.com/JimLiu/baoyu-skills/blob/5792c7dc8d09a28d6969e8970166c5eb090ce6ad/skills/baoyu-xhs-images/SKILL.md) |

四个 `source.url` 都指向已复制文件的完整提交版本，避免默认分支后续变化造成错配。

具体适配由 AIPic 编写：

- **纯净商品主图**沿用原文的商品身份约束、纯白背景与棚拍方法。默认不新增文字；用户明确给出上画文案时，改成有独立文案区的商品展示图。后者不是原 skill 的严格 Amazon 无字主图形式，因此预设没有声称通过平台审核，也没有把未执行的背景像素检测描述为已通过。
- **生活场景广告**沿用场景、尺度、光影与陪衬控制。原文模板默认不加文字；AIPic 为广告需求增加可选文案区，且只呈现用户原文。默认不加入人物或手部，优先清楚展示商品。
- **大字种草封面**沿用摄影商品、大字标题、视觉焦点和有限贴纸的方法。上游建议多版生成；AIPic 固定一张。上游主推三比四；运行默认使用现有接口支持的 `1024x1536` 二比三尺寸并留出裁切余量，没有实现或声称已执行三比四裁切。
- **清单信息海报**采用 baoyu 的 notion 风格、balanced/list 信息组织和字体层级。上游通用组装提示词要求手绘插画及手绘文字；AIPic 为真实商品展示改为“商品保持摄影质感、图标与分隔线保留轻手绘感、中文正文清晰”，并把多页系列压缩成单张信息卡。这是明确的本地适配，不是上游完整渲染约束的逐字应用。
- **共同约束**要求根据真实参考图保留商品轮廓、配色、商标、结构和配件，不混款或补造不可见细节；用户指定的上画文案逐字保留，包含数字、单位、价格和标点。没有文案时保留留白，不自动写卖点或评价。没有参考图时依照用户文字进行概念生成。

上游原文中的特定模型名、推广链接、服务路由、图片生成脚本、确认流程和多步 agent 指令均未加入运行提示词。预设只提供提示词与现有参数，不引入新的服务、依赖或 skill 执行器。

## 可直接运行的演示

每项 `examplePrompt` 已包含该项完整基础提示词和明确的虚构商品描述，可以不上传图片直接提交给现有图片生成通路。它不依赖用户另填品牌、商品结构或文案，也不需要再拼接 `prompt`。这些演示产品、品牌和文案均由 AIPic 为本次功能编写；“虚构”用于描述示例设定，不作为要印在图上的文字。

| ID | exampleTitle | 明确的虚构商品与上画文案 |
| --- | --- | --- |
| `commerce-product-hero` | 晴屿随行杯 · 白底主图 | 浅鼠尾草绿五百毫升随行杯；杯身仅印“晴屿”“500毫升”，不额外加广告文案。 |
| `commerce-lifestyle-ad` | 暮野蘑菇台灯 · 阅读时光 | 奶油白蘑菇台灯与阅读桌；主标题“把夜晚调成暖光”，副标题“暮野蘑菇台灯”，小字“给书桌一点温柔”。 |
| `xiaohongshu-product-cover` | 青芽手账本 · 春日桌面封面 | 浅草绿布纹手账本；主标题“把春天写进日常”，副标题“青芽纸间｜春日手账本”，标签“桌面灵感”。 |
| `xiaohongshu-info-poster` | 方寸小岛收纳盘 · 桌面归位清单 | 雾蓝长盘、米白方盘、淡黄圆盘；主标题“桌面归位小清单”，副标题“方寸小岛｜三件收纳盘”，卡片“长盘放文具”“方盘放钥匙”“圆盘放线材”，页脚“按用途分区，拿取更顺手”。 |

真实商品任务使用 `prompt` 加用户的商品描述和原文文案，并把实际参考图按正常输入通路传入。示例任务直接使用 `examplePrompt`，输入图片列表为空。参数与已有默认参数合并即可；用户后来选择的尺寸等显式覆盖项优先。`exampleTitle` 是示例入口的显示名称，不应自动追加为画面文案。

预设已通过 `src/lib/retouchPresets.ts` 接入左侧「电商 · 小红书」入口及库内的分类筛选。选用模板会写入创作栏，「填入示例」会选择文生图模式并加载完整示例；是否生成由用户点击按钮决定。运行时不读取或执行 `templates/skills/` 的上游指令。

## 验证记录

- 新增模块的严格 TypeScript 检查通过，解析了现有 `src/types.ts` 中的 `TaskParams`，没有新增依赖或输出编译文件。实际执行命令：

  ```sh
  node node_modules/typescript/bin/tsc --noEmit --target ES2020 --lib ES2020,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --strict --skipLibCheck --verbatimModuleSyntax --noUncheckedSideEffectImports src/lib/commercePresets.ts
  ```

- 内存载入导出数据的检查通过：四个 ID 唯一，每类两项，接口字段齐全，单张高质量 PNG 参数有效，尺寸受现有接口支持；四个示例包含完整基础提示词、明确虚构设定和无参考图说明，运行文本不含待填模板字段；全部 `source.url` 对应清单中的真实原文文件。
- 十三份上游副本的字节数、Git blob SHA-1 和 SHA-256 均与下载时核实的固定提交内容一致，原版权声明已保留。

界面集成的浏览器检查使用本地响应夹具，复现模板选择、示例填入、生成、保存与下载；不据此宣称真实模型已经生成了示例成品。项目可通过 `npm run test:ui` 重跑检查。
