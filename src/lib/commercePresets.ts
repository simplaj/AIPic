import type { TaskParams } from '../types'

/** AIPic 中文运行预设；上游原文、固定提交与适配说明见 docs/skills-sources.md。 */
export interface CommercePreset {
  id: string
  category: 'ecommerce' | 'xiaohongshu'
  group: string
  title: string
  scenario: string
  prompt: string
  params: Partial<TaskParams>
  composition: 'poster'
  examplePrompt: string
  exampleTitle: string
  previewStyle: 'product' | 'lifestyle' | 'redbook' | 'editorial'
  source: { name: string; url: string }
}

const singleImageParams: Partial<TaskParams> = {
  quality: 'high',
  n: 1,
  output_format: 'png',
}

const productFidelity = '商品依据：有参考图时，以用户指定的商品图为准；未指定时，第一张商品参考图确定主体，后续图片只补充同款商品的细节或用户明确指定的场景风格。保留真实商品的轮廓、比例、颜色、材质、结构、配件数量、商标位置和包装图案，不混合不同款式，不替换成相似商品，不为展示新角度补造看不见的结构。能辨认的商品文字逐字保留，无法辨认的小字保留原有视觉，不猜写。除用户明确要求修改的部分外，仅调整商品周围的背景、光线和版面。没有参考图时，仅依据用户提供的文字设定生成概念商品；不把示例品牌或示例文案带入实际任务。'

const exactCopy = '文案依据：用户明确提供的标题、副标题、品牌、卖点、价格、数字、单位和标点，均按原文完整呈现；只调整换行、字号与位置，不翻译、不改写、不增删、不用省略号代替内容。只把用户指定为上画文案的文字排进图片，不把产品描述、排版指令或示例说明印出来。商品原有标签与新增广告文案分别处理，不把广告语写到商品包装上。没有提供上画文案时保留干净留白，不自拟功效、参数、折扣、认证、排名、亲测结论或用户评价。'

const outputRules = '成品要求：只生成一张完整平面成品图，画幅服从实际选择的输出尺寸；改成横幅或方幅时重新排版，不拉伸商品。文字清楚、对比充分、笔画完整，关键主体和文案不贴边、不相互遮挡。不附带解释文字、手机界面、展框、样机、平台标志或额外水印。'

const productHeroPrompt = [
  '制作一张纯净、真实、可清楚识别商品细节的电商商品主图。',
  productFidelity,
  '使用纯白色无缝背景，背景颜色为纯白 RGB（255，255，255）；只有商品接触表面的位置保留很轻的自然接触阴影。沿用参考图中最清楚的完整视角，让商品居中、端正，最长方向约占画面八成至九成，四周留出均匀空白。商品完整入镜，不裁掉盖子、提手、包装边角或配件；只有用户明确列为售卖内容的物品才能同框，不添加装饰道具。',
  '使用左前方柔和棚拍光，保持真实材质、原始配色和清晰轮廓。边缘无白边、毛刺和重影，透明材质仍透明，金属不过曝；背景没有渐变、纹理、桌面拼缝或室内倒影。',
  exactCopy,
  '默认不新增标题、价格牌或贴纸。用户明确给出需要上画的广告文案时，改为带文案的商品展示图：适度缩小商品，将全部原文排入独立留白区，商品完整与文案完整优先于默认占比。用户要求纯商品无字图时，只保留商品本身原有的文字。',
  outputRules,
].join('\n\n')

const lifestyleAdPrompt = [
  '制作一张以真实商品为视觉中心的生活场景广告，让人一眼看懂商品在什么环境中使用。',
  productFidelity,
  '优先采用用户指定的使用场景；未指定时根据商品类别选择一种合理场景，例如杯子放在窗边书桌、护肤品放在干净洗漱台、食品放在厨房台面、台灯放在阅读桌。只出现一个连贯空间，商品清晰锐利、视觉体量约占画面四成至六成，背景轻度虚化。最多使用两三件与场景相符的陪衬，陪衬不得看起来像随商品附赠的配件。默认不加入人物或手部。',
  '用一个明确的主光方向连接商品和环境，接触阴影、投影、反射、透视与物体尺度一致；商品真实落在承托表面上，不悬浮、不穿模。场景色彩烘托主体，不能借氛围光改掉商品本色。画面有生活气息，但桌面有序，避免满屏道具。',
  exactCopy,
  '有广告文案时，在上方或侧方预留约三分之一画面作为安静的文字区：主标题最大，副标题其次，用户提供的补充信息最小；让文字与商品形成清楚的阅读顺序。无广告文案时，用自然光和留白完成构图，不添加虚构口号。',
  outputRules,
].join('\n\n')

const xiaohongshuCoverPrompt = [
  '制作一张适合小红书商品介绍笔记的大字封面：一个清楚的商品主体、一组醒目的中文标题、少量视觉强调。',
  productFidelity,
  '采用自然明亮的商品摄影质感，搭配浅奶油色或用户指定的背景色。商品放在中下部或一侧，轮廓完整、标识可辨；标题区域与主体区域分开。场景保持轻巧，只用一两件相关道具或简洁色块建立氛围，不把真实商品改成卡通，也不让贴纸遮住商品细节。',
  exactCopy,
  '用户提供的主标题放在上部，以粗而清晰的中文字体分两三行排出，在缩略图中也能辨认；只通过换行强调关键词，不改变原文。副标题较小，标签只使用用户明确提供的标签原文。标题较长时增加行数并调整字级，保留全部文字。可用一道浅色荧光笔下划线或一枚无字箭头强化视觉焦点，避免装饰堆积。没有标题时保留干净的标题留白，不擅自添加种草结论。',
  '默认竖向设计；在二比三画幅中，顶部和底部各约百分之八、左右各约百分之八不放关键文字或商品细节，使中心内容能适应后续三比四裁切。当前只按实际输出尺寸生成完整图片，不画裁切线。',
  outputRules,
].join('\n\n')

const xiaohongshuInfoPrompt = [
  '制作一张可快速阅读、可收藏的小红书商品信息海报，以清楚的内容层级呈现用户提供的信息。',
  productFidelity,
  exactCopy,
  '采用简洁纸面笔记风：近白色背景、深灰正文、浅蓝或浅黄色强调区，保留充足留白。上部排主标题，中部用真实商品图建立主题，周围或下方用对齐的清单卡片承载信息。通常安排三到四块内容；用户只提供一两条就保留实际条数，更多条目则调整为两列网格，不能为凑版式编造或删减内容。',
  '每块内容按照用户给出的分组保留小标题与正文，层级为主标题、分组标题、说明。使用清晰的中文正文字体，手绘感只用于轻微起伏的细线、简单图标、圆角分隔和少量下划线。图标只能解释已提供的信息，不凭空暗示检测结果、认证或未确认的商品功能；不画推测性的内部结构。真实商品区域保持摄影质感，纸纹和装饰不覆盖商标及标签。',
  '主标题与正文有明确对比，正文行距宽松，每块信息都能单独读懂。用户提供价格或行动文案时，在独立的小区域完整排入原文；未提供则不补写。没有上画文案时，仅保留商品与有秩序的空白版面，不生成伪文字或示意占位字。关键内容远离画面边缘，竖幅底部约百分之十只留背景与非关键装饰。',
  outputRules,
].join('\n\n')

/** examplePrompt 已包含完整预设，可直接用于无参考图的虚构商品演示。 */
export const commercePresets: CommercePreset[] = [
  {
    id: 'commerce-product-hero',
    category: 'ecommerce',
    group: '电商商品图',
    title: '纯净商品主图',
    scenario: '保留真实商品外观与标签，制作纯白背景的清晰主图',
    prompt: productHeroPrompt,
    params: { ...singleImageParams, size: '1024x1024' },
    composition: 'poster',
    exampleTitle: '晴屿随行杯 · 白底主图',
    examplePrompt: [
      productHeroPrompt,
      '本次为纯文字概念演示，没有参考图；品牌“晴屿”和这款商品均为虚构设定。生成一只容量为五百毫升的浅鼠尾草绿色随行杯：细长圆柱杯身、圆润肩部、同色旋拧杯盖、盖顶一条浅灰色短提环，表面为细腻哑光。杯身正面居中印两行白色文字，上行为“晴屿”，下行为“500毫升”；文字按引号内原文呈现，引号不印出。只出现这一只完整杯子，正面略带侧面的视角，无包装盒、无其他配件。成图为一千零二十四像素正方形，纯白背景、柔和棚拍光、轻微接触阴影。图中仅有杯身“晴屿”“500毫升”两行印字，不另加标题、价格或广告文案，不印出演示说明。',
    ].join('\n\n'),
    previewStyle: 'product',
    source: {
      name: 'xianyu110 / amazon-white-background',
      url: 'https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/skills/amazon-white-background/SKILL.md',
    },
  },
  {
    id: 'commerce-lifestyle-ad',
    category: 'ecommerce',
    group: '电商商品图',
    title: '生活场景广告',
    scenario: '把商品放入可信的使用场景，搭配用户原文广告',
    prompt: lifestyleAdPrompt,
    params: { ...singleImageParams, size: '1024x1536' },
    composition: 'poster',
    exampleTitle: '暮野蘑菇台灯 · 阅读时光',
    examplePrompt: [
      lifestyleAdPrompt,
      '本次为纯文字概念演示，没有参考图；虚构品牌为“暮野”，虚构商品是一盏奶油白蘑菇形阅读台灯：半球形磨砂灯罩、短圆柱灯杆、扁圆底座，底座正面有小巧的深灰色“暮野”字样。台灯放在浅橡木阅读桌右侧，温暖灯光照亮桌面；左下方只放一本封面无字的合拢书，远处有柔和的米色窗帘，没有人物。输出一千零二十四乘一千五百三十六像素竖图，上部保留奶油色文字区。新增上画文案严格为：主标题“把夜晚调成暖光”，副标题“暮野蘑菇台灯”，底部小字“给书桌一点温柔”。按引号内原文排版，引号不印出，不增加功率、价格、认证或其他文字，不印出演示说明。',
    ].join('\n\n'),
    previewStyle: 'lifestyle',
    source: {
      name: 'xianyu110 / lifestyle-scene',
      url: 'https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/skills/lifestyle-scene/SKILL.md',
    },
  },
  {
    id: 'xiaohongshu-product-cover',
    category: 'xiaohongshu',
    group: '小红书推广',
    title: '大字种草封面',
    scenario: '醒目中文大标题与商品摄影，适合笔记首图和新品介绍',
    prompt: xiaohongshuCoverPrompt,
    params: { ...singleImageParams, size: '1024x1536' },
    composition: 'poster',
    exampleTitle: '青芽手账本 · 春日桌面封面',
    examplePrompt: [
      xiaohongshuCoverPrompt,
      '本次为纯文字概念演示，没有参考图；虚构品牌为“青芽纸间”，虚构商品为“春日手账本”：一本浅草绿色布纹硬壳笔记本，圆角、米白书页、同色竖向松紧带，封面只有居中的小号深绿文字“青芽纸间”。将合拢的手账本放在奶油色桌面中下部，旁边只放一支无字米白笔，窗边柔光照入。输出一千零二十四乘一千五百三十六像素竖图，上部用深绿色大字准确排主标题“把春天写进日常”，副标题“青芽纸间｜春日手账本”，唯一标签为“桌面灵感”。按引号内原文呈现，引号不印出。主标题分两行，配一道淡黄色手绘下划线；没有评分、价格、销量、亲测标记、平台界面或其他文字，不印出演示说明。',
    ].join('\n\n'),
    previewStyle: 'redbook',
    source: {
      name: 'xianyu110 / xiaohongshu-cover',
      url: 'https://github.com/xianyu110/ecommerce-image-skills/blob/f4566fdc812584425728862ad8e08c90883d81ee/skills/xiaohongshu-cover/SKILL.md',
    },
  },
  {
    id: 'xiaohongshu-info-poster',
    category: 'xiaohongshu',
    group: '小红书推广',
    title: '清单信息海报',
    scenario: '以纸面笔记、清单卡片和清晰层级整理商品信息',
    prompt: xiaohongshuInfoPrompt,
    params: { ...singleImageParams, size: '1024x1536' },
    composition: 'poster',
    exampleTitle: '方寸小岛收纳盘 · 桌面归位清单',
    examplePrompt: [
      xiaohongshuInfoPrompt,
      '本次为纯文字概念演示，没有参考图；虚构品牌为“方寸小岛”，虚构商品是由三个独立浅托盘组成的桌面收纳套装：一个雾蓝色长方托盘、一个米白色方形托盘、一个淡黄色圆托盘，均为哑光表面与圆润边缘，托盘上没有印字。三个托盘真实摄影质感，在画面中部整齐摆放，分别放一支无字笔、一把钥匙和一条扎好的数据线，这些物品只用于展示收纳用途。输出一千零二十四乘一千五百三十六像素竖图，近白纸面、深灰文字、浅蓝和淡黄色分区。主标题严格为“桌面归位小清单”，副标题严格为“方寸小岛｜三件收纳盘”。下方三张清单卡片的全部文案依次为：“长盘放文具”“方盘放钥匙”“圆盘放线材”；页脚原文为“按用途分区，拿取更顺手”。引号不印出。仅绘制笔、钥匙、线材的简单线条图标，不增加容量、材质认证、价格或其他文字，不印出演示说明。',
    ].join('\n\n'),
    previewStyle: 'editorial',
    source: {
      name: 'JimLiu / baoyu-xhs-images',
      url: 'https://github.com/JimLiu/baoyu-skills/blob/5792c7dc8d09a28d6969e8970166c5eb090ce6ad/skills/baoyu-xhs-images/SKILL.md',
    },
  },
]
