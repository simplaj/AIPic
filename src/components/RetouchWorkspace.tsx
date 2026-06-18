import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { addImageFromFile, createInputImageFromFile, ensureImageCached, submitTask, useStore } from '../store'
import type { InputImage, TaskParams, TaskRecord } from '../types'
import { getActiveApiProfile, validateApiProfile } from '../lib/apiProfiles'
import { calculateImageSize, normalizeImageSize, type SizeTier } from '../lib/size'
import { CloseIcon, EditIcon, HistoryIcon, PhotoIcon, RefreshIcon, SettingsIcon, WrenchIcon } from './icons'

type RetouchCategoryId =
  | 'aiColor'
  | 'tone'
  | 'local'
  | 'portrait'
  | 'image'
  | 'clothes'
  | 'postColor'
  | 'crop'
  | 'aiNative'
  | 'body'
  | 'slim'
  | 'skin'
  | 'background'
  | 'global'
  | 'portraitColor'
  | 'graduateScene'
type RetouchTemplateId = string
type RetouchStrengthId = 'light' | 'standard' | 'strong' | 'max'
type RetouchTargetId = 'auto' | 'female' | 'male' | 'child' | 'product'
type RetouchPreviewMode = 'empty' | 'current' | 'history'
type RetouchOutputSizeId = 'auto' | SizeTier
type RetouchGenerationMode = 'text' | 'edit'
type FilmSceneId = `film-scene-${number}` | `custom-film-scene-${string}`
type GraduateBackgroundId = 'original' | 'uploaded' | 'scene'

type RetouchTemplate = {
  id: RetouchTemplateId
  category: RetouchCategoryId
  group?: string
  title: string
  scenario: string
  prompt: string
  params: Partial<TaskParams>
}

type FilmSceneAsset = {
  id: FilmSceneId
  label: string
  src: string
  prompt: string
  source: 'built-in' | 'custom'
  inputImage?: InputImage
}

const highParams: Partial<TaskParams> = { n: 1, quality: 'high', output_format: 'png' }
const reviewParams: Partial<TaskParams> = { n: 4, quality: 'medium', output_format: 'png' }
const previewZoomMin = 1
const previewZoomMax = 4
const outputSizeTiers: SizeTier[] = ['1K', '2K', '4K']
const outputSizeHints: Record<RetouchOutputSizeId, string> = {
  auto: '模型判断',
  '1K': '快速',
  '2K': '交付',
  '4K': '精修',
}
const commonOutputRatios = [
  { label: '1:1', value: 1 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '21:9', value: 21 / 9 },
]
const qualityOptions: Array<{ label: string; value: TaskParams['quality']; hint: string }> = [
  { label: '快速', value: 'low', hint: '测试构图' },
  { label: '标准', value: 'medium', hint: '客户审片' },
  { label: '精修', value: 'high', hint: '最终交付' },
]
const formatOptions: Array<{ label: string; value: TaskParams['output_format'] }> = [
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'JPEG', value: 'jpeg' },
]
const publicAssetBase = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
const getPublicAssetUrl = (path: string) => `${publicAssetBase}/${path.replace(/^\/+/, '')}`

const filmSceneAssets: FilmSceneAsset[] = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1
  return {
    id: `film-scene-${number}` as FilmSceneId,
    label: `名场面 ${String(number).padStart(2, '0')}`,
    src: getPublicAssetUrl(`film-scenes/${number}.png`),
    prompt: `参考内置影视作品名场面素材 ${number} 的动作关系、群像站位、镜头构图、画面节奏、光线和整体画风。`,
    source: 'built-in',
  }
})
const defaultFilmSceneId: FilmSceneId | null = filmSceneAssets[0]?.id ?? null

const retouchCategories: Array<{ id: RetouchCategoryId; title: string; shortTitle: string; summary: string; icon: typeof PhotoIcon; badge?: string }> = [
  { id: 'graduateScene', title: '毕业仿拍', shortTitle: '毕业', summary: '毕业照 / 名场面 / 群像', icon: PhotoIcon, badge: '新' },
  { id: 'aiColor', title: 'AI色彩', shortTitle: '色彩', summary: 'AI追色 / 样片 / 套图', icon: RefreshIcon },
  { id: 'tone', title: '调色', shortTitle: '调色', summary: '白平衡 / 全局 / 黑白场', icon: SettingsIcon },
  { id: 'local', title: '局部', shortTitle: '局部', summary: '面部 / 背景 / 区域色彩', icon: EditIcon },
  { id: 'portrait', title: '人像', shortTitle: '人像', summary: '丰体 / 瘦身 / 皮肤', icon: PhotoIcon },
  { id: 'image', title: '图像', shortTitle: '图像', summary: '消除 / 背景 / 产品', icon: WrenchIcon },
  { id: 'clothes', title: '衣物', shortTitle: '衣物', summary: '褶皱 / 污渍 / 领口', icon: EditIcon },
  { id: 'postColor', title: '后调色', shortTitle: '后期', summary: '质感肌 / 婚纱 / 儿童', icon: HistoryIcon },
  { id: 'crop', title: '裁剪', shortTitle: '裁剪', summary: '旋转 / 透视 / 补边', icon: SettingsIcon },
  { id: 'aiNative', title: 'AI Native', shortTitle: 'AI', summary: '改稿 / 审片 / 一致性', icon: RefreshIcon },
]

const categoryTemplateAliases: Partial<Record<RetouchCategoryId, RetouchCategoryId[]>> = {
  portrait: ['portrait', 'body', 'slim', 'skin'],
  image: ['image', 'background'],
  tone: ['tone', 'global'],
  postColor: ['postColor', 'portraitColor'],
}

const strengthOptions: Array<{ id: RetouchStrengthId; label: string; prompt: string }> = [
  { id: 'light', label: '轻微', prompt: '处理强度为轻微，只做肉眼可感知但非常自然的调整。' },
  { id: 'standard', label: '标准', prompt: '处理强度为标准，达到专业交付效果，同时保持自然真实。' },
  { id: 'strong', label: '明显', prompt: '处理强度为明显，效果要清楚可见，但不能破坏身份、结构、边缘和真实光影。' },
  { id: 'max', label: '强烈', prompt: '处理强度为强烈，优先满足客户可见变化，但必须避免夸张变形和 AI 痕迹。' },
]

const targetOptions: Array<{ id: RetouchTargetId; label: string; prompt: string }> = [
  { id: 'auto', label: '自动', prompt: '性别/对象自动判断，按画面主体选择最合适的修图尺度。' },
  { id: 'female', label: '女性', prompt: '按女性人像审美处理，保持柔和、干净、自然的体态和肤色。' },
  { id: 'male', label: '男性', prompt: '按男性人像审美处理，保留骨相、皮肤质感和自然面部结构，避免过度柔化。' },
  { id: 'child', label: '儿童', prompt: '按儿童或宝宝人像处理，保留真实稚嫩肤质、表情和安全自然的比例。' },
  { id: 'product', label: '产品/物体', prompt: '按产品或非人像主体处理，重点保护结构、材质、文字、边缘和真实透视。' },
]

const graduateBackgroundOptions: Array<{ id: GraduateBackgroundId; label: string; hint: string; prompt: string }> = [
  {
    id: 'original',
    label: '保留原背景',
    hint: '默认',
    prompt: '背景策略：尽量保留第一张毕业照中的原始背景、场地、建筑、教室、操场、横幅、树木、天空和环境结构；只做动作、队形、镜头和氛围适配，不要整体替换背景。',
  },
  {
    id: 'uploaded',
    label: '新上传背景',
    hint: '第三张参考图',
    prompt: '背景策略：使用用户新上传的背景参考作为最终场景来源。第三张参考图只用于学习背景、空间、光线和环境结构，人物身份、人数、服装和动作来源仍然必须分别来自毕业照和名场面参考。',
  },
  {
    id: 'scene',
    label: '名场面背景',
    hint: '电影场景',
    prompt: '背景策略：允许使用第二张名场面参考图中的背景、空间、光线和影视氛围，但不能复制参考图人物、服装或无关 NPC；最终人物仍全部来自毕业照。',
  },
]

const retouchTemplates: RetouchTemplate[] = [
  {
    id: 'body-bust',
    category: 'portrait',
    group: '丰体',
    title: '丰胸',
    scenario: '自然提升胸型，保留衣褶',
    params: highParams,
    prompt: '对输入人像做专业自然丰胸修图：轻微提升胸部体积和线条，保持衣物纹理、肩颈结构、姿态、身份和光影不变，避免夸张变形、边缘扭曲和塑料感。',
  },
  {
    id: 'body-lips',
    category: 'portrait',
    group: '丰体',
    title: '丰唇',
    scenario: '唇形饱满，口红边缘干净',
    params: highParams,
    prompt: '对输入人像做自然丰唇：让唇部更饱满、轮廓更干净，修正唇妆边缘和干纹，保留原本表情、牙齿、肤色、妆容风格和人物身份。',
  },
  {
    id: 'body-hip',
    category: 'portrait',
    group: '丰体',
    title: '丰臀',
    scenario: '臀线更饱满，腿型不漂移',
    params: highParams,
    prompt: '对输入全身或半身人像做自然丰臀：优化臀部曲线和裤装轮廓，保持腿部比例、衣物纹理、背景直线和人物姿态稳定，不要产生液化痕迹。',
  },
  {
    id: 'slim-waist',
    category: 'portrait',
    group: '瘦身',
    title: '瘦腰',
    scenario: '腰线收紧，服装自然',
    params: highParams,
    prompt: '对输入人像做自然瘦腰：轻微收紧腰线和衣物轮廓，保持肩胯比例、手臂位置、背景直线和衣服纹理不变，避免过度液化。',
  },
  {
    id: 'slim-belly',
    category: 'portrait',
    group: '瘦身',
    title: '瘦小肚子',
    scenario: '腹部平整，保留坐姿/站姿',
    params: highParams,
    prompt: '对输入人像轻微收紧小腹：让腹部和衣物前襟更平整自然，保留真实姿态、衣褶、裤腰和光影，不改变人物身份与背景结构。',
  },
  {
    id: 'slim-arm',
    category: 'portrait',
    group: '瘦身',
    title: '瘦手臂',
    scenario: '上臂线条清爽',
    params: highParams,
    prompt: '对输入人像做自然瘦手臂：优化上臂和前臂线条，保持手肘、手腕、衣袖边缘、皮肤质感和背景不变，避免边缘拉扯。',
  },
  {
    id: 'slim-finger',
    category: 'portrait',
    group: '瘦身',
    title: '瘦手指',
    scenario: '手指修长，关节真实',
    params: highParams,
    prompt: '对输入图片中的手部做精细瘦手指：让手指更修长、指节更干净，保留指甲、戒指、皮肤纹理和真实关节结构，不要生成多余手指。',
  },
  {
    id: 'skin-tone',
    category: 'portrait',
    group: '肤色瑕疵',
    title: '肤色矫正',
    scenario: '去黄去灰，肤色统一',
    params: highParams,
    prompt: '对输入人像做肤色矫正：统一面部和身体肤色，校正偏黄、偏灰、偏红问题，保留真实肤质、妆容、光源方向和五官结构。',
  },
  {
    id: 'skin-blemish',
    category: 'portrait',
    group: '肤色瑕疵',
    title: '面部去瑕疵',
    scenario: '痘印斑点清理，肤质保留',
    params: highParams,
    prompt: '对输入人像做面部去瑕疵：清理临时痘痘、痘印、斑点、杂乱发丝和小红血丝，保留毛孔纹理、五官结构、妆容和人物身份。',
  },
  {
    id: 'skin-body-whiten',
    category: 'portrait',
    group: '身体皮肤',
    title: '全身美白',
    scenario: '身体肤色提亮不失真',
    params: highParams,
    prompt: '对输入人像做全身自然美白：整体提亮肤色并压住脏色，保持肤色层次、身体体积、服装颜色和环境光真实，不要过曝。',
  },
  {
    id: 'skin-body-smooth',
    category: 'portrait',
    group: '身体皮肤',
    title: '全身磨皮',
    scenario: '身体皮肤干净但有纹理',
    params: highParams,
    prompt: '对输入人像做全身自然磨皮：弱化皮肤小瑕疵和粗糙颗粒，保留身体结构、真实纹理、光影转折和边缘细节，避免蜡像感。',
  },
  {
    id: 'skin-dodge-burn-smooth',
    category: 'portrait',
    group: '中性灰',
    title: '面部中性灰磨皮',
    scenario: '高端磨皮，保留毛孔',
    params: highParams,
    prompt: '按专业中性灰思路处理面部皮肤：柔和明暗不均和细小瑕疵，保留毛孔、皮肤纹理、五官结构和真实光影，不要改变脸型。',
  },
  {
    id: 'skin-dodge-burn-volume',
    category: 'portrait',
    group: '中性灰',
    title: '面部中性灰立体',
    scenario: '增强面部体积和骨相',
    params: highParams,
    prompt: '按专业中性灰修图增强面部立体感：优化额头、鼻梁、颧骨、下巴和面颊的明暗层次，保留真实肤质、身份和原始光源方向。',
  },
  {
    id: 'skin-forehead-lines',
    category: 'portrait',
    group: '纹路',
    title: '去抬头纹',
    scenario: '额头纹路自然减淡',
    params: highParams,
    prompt: '自然减淡输入人像的抬头纹：保留额头体积、肤质细节、表情和光影层次，不要把皮肤磨成一片。',
  },
  {
    id: 'skin-eye-lines',
    category: 'portrait',
    group: '眼周',
    title: '去眼周纹',
    scenario: '眼周年轻但不假',
    params: highParams,
    prompt: '自然减淡眼周细纹和干纹：保留眼神、卧蚕、睫毛、妆容和皮肤纹理，不改变眼睛形状和人物身份。',
  },
  {
    id: 'skin-dark-circle',
    category: 'portrait',
    group: '眼周',
    title: '去黑眼圈',
    scenario: '眼下干净，保留卧蚕',
    params: highParams,
    prompt: '对输入人像去黑眼圈：均匀眼下暗沉和色偏，保留卧蚕、眼袋自然结构、眼神高光、妆容和真实肤质。',
  },
  {
    id: 'skin-eye-bag',
    category: 'portrait',
    group: '眼周',
    title: '去眼袋',
    scenario: '眼袋减弱，眼神不变',
    params: highParams,
    prompt: '自然减弱眼袋和泪沟阴影：保持眼部结构、年龄特征、眼神和原始光源方向，不要抹平到失真。',
  },
  {
    id: 'skin-nasolabial',
    category: 'portrait',
    group: '纹路',
    title: '去法令纹',
    scenario: '法令纹减淡，表情保留',
    params: highParams,
    prompt: '自然减淡法令纹：保留笑容、面部体积、鼻翼和嘴角结构，避免脸部变形或表情僵硬。',
  },
  {
    id: 'skin-lip-lines',
    category: 'portrait',
    group: '纹路',
    title: '唇纹修正',
    scenario: '唇部更干净，唇形不变',
    params: highParams,
    prompt: '修正唇纹和唇部干裂：让唇部更平滑饱满，保留唇形、口红质感、高光和真实表情。',
  },
  {
    id: 'skin-neck-lines',
    category: 'portrait',
    group: '纹路',
    title: '去颈纹',
    scenario: '颈部纹路自然减淡',
    params: highParams,
    prompt: '自然减淡颈纹和颈部暗沉：保留颈部体积、锁骨、衣领边缘和真实光影，不要破坏身体结构。',
  },
  {
    id: 'skin-even-face',
    category: 'portrait',
    group: '肤色瑕疵',
    title: '面部均肤',
    scenario: '面部色块统一',
    params: highParams,
    prompt: '对输入人像做面部均肤：统一脸颊、额头、鼻翼和下巴的色块与明暗，保留毛孔纹理、妆容边界和五官立体感。',
  },
  {
    id: 'background-passersby',
    category: 'image',
    group: '背景修复',
    title: '消除路人',
    scenario: '移除路人并补全背景',
    params: highParams,
    prompt: '保留主体人物或产品不变，移除背景中的路人和干扰人物，并自然补全被遮挡的背景纹理、透视、光影和地面阴影。',
  },
  {
    id: 'background-clutter',
    category: 'image',
    group: '背景修复',
    title: '消除杂物',
    scenario: '清理杂乱物体',
    params: highParams,
    prompt: '保留主体不变，清理画面中的杂物、垃圾、线缆、污点和无关小物件，按原场景透视和光线自然补齐背景。',
  },
  {
    id: 'background-smart-remove',
    category: 'image',
    group: '工具',
    title: '智能消除',
    scenario: '像素蛋糕同类工具，AI补纹理',
    params: highParams,
    prompt: '对输入图片执行智能消除：删除明显干扰物并生成一致的背景纹理，主体边缘、阴影、空间透视和画面真实感必须保持稳定。',
  },
  {
    id: 'background-studio',
    category: 'image',
    group: '背景修复',
    title: '棚拍背景修复',
    scenario: '修脏背景和褶皱',
    params: highParams,
    prompt: '修复摄影棚或纯色背景：清理背景污点、褶皱、色带和阴影断层，保留主体轮廓、发丝边缘和真实落影。',
  },
  {
    id: 'global-rotate',
    category: 'crop',
    group: '校正',
    title: '旋转矫正',
    scenario: '地平线和垂直线校正',
    params: highParams,
    prompt: '对输入图片做旋转和透视矫正：校正倾斜的地平线、墙角、门框、镜子或产品边缘，保持完整构图并自然补齐边缘空白。',
  },
  {
    id: 'global-color',
    category: 'tone',
    group: '全局美化',
    title: '全局调色',
    scenario: '整体商业质感',
    params: highParams,
    prompt: '对输入图片做全局商业调色：优化对比度、层次、饱和度和色彩关系，让画面干净高级，主体颜色准确，不改变形状和身份。',
  },
  {
    id: 'global-white-balance',
    category: 'tone',
    group: '全局美化',
    title: '白平衡矫正',
    scenario: '去偏黄/偏绿/偏蓝',
    params: highParams,
    prompt: '校正输入图片白平衡：去除偏黄、偏绿、偏蓝或混合光脏色，保持肤色、白色衣物、产品颜色和背景中性自然。',
  },
  {
    id: 'global-face-exposure',
    category: 'local',
    group: '局部曝光',
    title: '面部曝光平衡',
    scenario: '脸部亮度和身体统一',
    params: highParams,
    prompt: '平衡人像面部曝光：让面部、颈部和身体亮度协调，修正局部过暗或过亮，保留真实体积、妆容和环境光方向。',
  },
  {
    id: 'global-solid-color',
    category: 'tone',
    group: '全局美化',
    title: '纯色矫正',
    scenario: '白底/灰底/证件底干净',
    params: highParams,
    prompt: '对纯色背景或纯色产品区域做矫正：统一色面、清理色带和脏点，保留主体边缘、纹理和真实阴影。',
  },
  {
    id: 'portrait-texture',
    category: 'postColor',
    group: '肤色风格',
    title: '质感肌',
    scenario: '清晰皮肤和微对比',
    params: highParams,
    prompt: '按质感肌风格处理输入人像：增强皮肤微对比和真实质地，控制高光和暗部层次，肤色干净但不磨平。',
  },
  {
    id: 'portrait-cream',
    category: 'postColor',
    group: '肤色风格',
    title: '奶油肌',
    scenario: '柔和通透，适合写真',
    params: highParams,
    prompt: '按奶油肌风格处理输入人像：肤色柔和通透，暗部干净，整体低对比但保留五官立体和皮肤纹理。',
  },
  {
    id: 'portrait-native',
    category: 'postColor',
    group: '肤色风格',
    title: '原生肌',
    scenario: '自然真实不过度',
    params: highParams,
    prompt: '按原生肌风格处理输入人像：只清理临时瑕疵和明显脏色，最大程度保留真实肤质、年龄特征、妆容和身份。',
  },
  {
    id: 'portrait-neutral',
    category: 'postColor',
    group: '肤色风格',
    title: '肤色-中性',
    scenario: '肤色准确，商业通用',
    params: highParams,
    prompt: '将输入人像肤色调整为中性自然：校正偏色，保持肤色准确、白平衡稳定、妆容真实，适合商业交付。',
  },
  {
    id: 'portrait-cool',
    category: 'postColor',
    group: '肤色风格',
    title: '肤色-清冷',
    scenario: '清冷干净，不发灰',
    params: highParams,
    prompt: '将输入人像调成清冷干净风格：略降暖色和脏黄，保留肤色生命力、黑白灰层次和真实环境光，不要发灰。',
  },
  {
    id: 'portrait-wedding-light',
    category: 'postColor',
    group: '场景预设',
    title: '婚纱浅色内景',
    scenario: '白纱干净，高光可控',
    params: highParams,
    prompt: '按婚纱浅色内景风格调色：白纱干净有层次，肤色柔和，背景明亮通透，高光不过曝，保留礼服纹理。',
  },
  {
    id: 'portrait-wedding-report',
    category: 'postColor',
    group: '场景预设',
    title: '婚礼跟拍',
    scenario: '现场感和肤色稳定',
    params: highParams,
    prompt: '按婚礼跟拍风格处理输入图片：校正混合光和肤色，保留现场氛围、人物关系和纪实感，让画面干净可交付。',
  },
  {
    id: 'portrait-child-bright',
    category: 'postColor',
    group: '场景预设',
    title: '儿童亮调纯净',
    scenario: '明亮通透，肤色干净',
    params: highParams,
    prompt: '按儿童亮调纯净风格处理输入图片：整体明亮柔和，肤色干净自然，保留儿童真实表情、发丝和衣物颜色。',
  },
  {
    id: 'portrait-maternity',
    category: 'postColor',
    group: '场景预设',
    title: '孕妇自然通用',
    scenario: '柔和肤色和体态',
    params: highParams,
    prompt: '按孕妇写真自然通用风格处理输入图片：肤色柔和，体态自然，服装和背景干净，保留温柔光影和人物身份。',
  },
  {
    id: 'portrait-newborn',
    category: 'postColor',
    group: '场景预设',
    title: '新生儿爱婴',
    scenario: '柔软肤色和干净背景',
    params: highParams,
    prompt: '按新生儿柔和风格处理输入图片：肤色温和自然，背景干净，弱化红疹和脏色，保留宝宝真实轮廓和柔软质感。',
  },
  {
    id: 'ai-color-match',
    category: 'aiColor',
    group: 'AI追色',
    title: 'AI追色',
    scenario: '参考样片统一色彩',
    params: highParams,
    prompt: '把输入图片调成参考样片式的色彩逻辑：匹配整体色温、对比、肤色倾向和氛围，但保留当前图片的主体结构、身份、背景空间和真实光影。',
  },
  {
    id: 'ai-series-match',
    category: 'aiColor',
    group: 'AI追色',
    title: '套图色彩统一',
    scenario: '多图同一交付风格',
    params: highParams,
    prompt: '将输入图片统一为同一套图交付风格：白平衡、肤色、对比、黑白场和背景干净度保持一致，主体身份和构图不变。',
  },
  {
    id: 'ai-sample-import-match',
    category: 'aiColor',
    group: 'AI追色',
    title: '导入样片追色',
    scenario: '按参考图复制色彩逻辑',
    params: highParams,
    prompt: '把输入图片向参考样片追色：学习参考图的色温、肤色、黑白场、对比、饱和度和氛围，但不复制参考图内容，当前主体身份、构图和空间不变。',
  },
  {
    id: 'ai-result-as-sample',
    category: 'aiColor',
    group: 'AI追色',
    title: '结果创建样片',
    scenario: '把当前效果延展成系列风格',
    params: highParams,
    prompt: '把当前修图效果视作样片风格，并将输入图片统一到同一审美：肤色、白平衡、对比、背景干净度和整体质感保持系列一致。',
  },
  {
    id: 'style-light-wood-film',
    category: 'aiColor',
    group: '色彩风格',
    title: '轻木胶片',
    scenario: '浅暖胶片，干净柔和',
    params: highParams,
    prompt: '按轻木胶片风格调色：浅暖、柔和、低脏色、肤色干净，保留胶片式轻微层次和真实高光。',
  },
  {
    id: 'style-manor-birthday',
    category: 'aiColor',
    group: '色彩风格',
    title: '庄园生日',
    scenario: '暖调仪式感',
    params: highParams,
    prompt: '按庄园生日风格调色：暖调、通透、带轻微复古仪式感，突出人物和环境层次，避免过黄和过饱和。',
  },
  {
    id: 'style-moment',
    category: 'aiColor',
    group: '色彩风格',
    title: '时刻',
    scenario: '纪实自然，现场感',
    params: highParams,
    prompt: '按纪实时刻风格调色：保留现场真实氛围，肤色自然，暗部有细节，整体干净但不过度商业化。',
  },
  {
    id: 'style-milk-bear',
    category: 'aiColor',
    group: '色彩风格',
    title: '奶白小熊',
    scenario: '奶白柔和，儿童友好',
    params: highParams,
    prompt: '按奶白小熊风格调色：奶白、柔和、低对比、肤色可爱干净，适合儿童或柔和写真，保留真实纹理。',
  },
  {
    id: 'style-birthday-balloon',
    category: 'aiColor',
    group: '色彩风格',
    title: '生日气球',
    scenario: '明亮欢乐，颜色不脏',
    params: highParams,
    prompt: '按生日气球风格调色：明亮、轻快、色彩鲜活但不刺眼，保持肤色干净和背景装饰颜色准确。',
  },
  {
    id: 'style-retro-nanyang',
    category: 'aiColor',
    group: '色彩风格',
    title: '复古南洋',
    scenario: '复古暖绿，电影感',
    params: highParams,
    prompt: '按复古南洋风格调色：暖绿复古、暗部有电影感，肤色保持健康，不要脏绿或过度偏色。',
  },
  {
    id: 'style-modern-moon',
    category: 'aiColor',
    group: '色彩风格',
    title: '摩登月影',
    scenario: '冷暖对比，高级暗调',
    params: highParams,
    prompt: '按摩登月影风格调色：冷暖对比明确，暗调高级，肤色和主体边缘保持清晰，避免死黑。',
  },
  {
    id: 'style-cream-cake',
    category: 'aiColor',
    group: '色彩风格',
    title: '奶油蛋糕',
    scenario: '奶油通透，甜美干净',
    params: highParams,
    prompt: '按奶油蛋糕风格调色：柔和、甜美、通透，肤色干净，背景和高光呈奶油质感但不过曝。',
  },
  {
    id: 'ai-client-revision',
    category: 'aiNative',
    title: '客户意见改稿',
    scenario: '按文字意见精准修改',
    params: highParams,
    prompt: '根据当前修图要求做客户改稿：只修改明确要求的区域，保留已完成的主体、肤色、构图和整体风格，避免引入新的无关变化。',
  },
  {
    id: 'ai-review-versions',
    category: 'aiNative',
    title: '4版审片',
    scenario: '同主体多版本可选',
    params: reviewParams,
    prompt: '基于输入图片生成 4 个可交付审片版本：主体、身份、透视和裁切保持一致，只变化调色强度、背景干净度、阴影层次和整体氛围，方便客户选择。',
  },
  {
    id: 'ai-clothes',
    category: 'clothes',
    group: '衣物美化',
    title: '衣物美化',
    scenario: '褶皱、污点、领口修正',
    params: highParams,
    prompt: '对输入图片做衣物美化：整理明显褶皱、污点、领口不平和线头，保留面料纹理、花纹、品牌文字、身体结构和自然阴影。',
  },
  {
    id: 'ai-local-color',
    category: 'local',
    group: '局部调色',
    title: '局部调色',
    scenario: '只改指定区域色彩',
    params: highParams,
    prompt: '对输入图片做局部调色：只调整需要优化的区域色彩和明暗，保持人物身份、肤色关系、背景和未指定区域不变，过渡要自然。',
  },
  {
    id: 'tool-liquify',
    category: 'portrait',
    group: '工具',
    title: '液化',
    scenario: '形体线条微调',
    params: highParams,
    prompt: '使用专业液化思路微调人物形体和面部线条：只做自然比例优化，保护背景直线、衣物纹理、五官身份和真实光影，避免任何拉扯痕迹。',
  },
  {
    id: 'tool-spot-heal',
    category: 'portrait',
    group: '工具',
    title: '污点修复',
    scenario: '点状瑕疵清理',
    params: highParams,
    prompt: '对输入图片执行污点修复：清理皮肤、背景或产品上的点状瑕疵、灰尘、小污点和临时痕迹，保留周围纹理连续自然。',
  },
  {
    id: 'tool-patch',
    category: 'image',
    group: '工具',
    title: '修补',
    scenario: '局部纹理补全',
    params: highParams,
    prompt: '对输入图片执行修补：将破损、缺失或杂乱区域自然补齐，匹配周围纹理、透视、明暗和噪声颗粒，主体结构不变。',
  },
  {
    id: 'tool-clone',
    category: 'image',
    group: '工具',
    title: '仿制图章',
    scenario: '复制纹理补背景',
    params: highParams,
    prompt: '按仿制图章思路修复输入图片：用画面内一致纹理补全脏点、断层和缺失区域，保持边缘、颗粒、透视和光影一致。',
  },
  {
    id: 'tool-reference-line',
    category: 'crop',
    group: '校正',
    title: '参考线校正',
    scenario: '按垂直水平线矫正',
    params: highParams,
    prompt: '按参考线进行画面校正：让墙线、门框、镜子、地平线或产品边缘恢复水平/垂直，保留完整主体并自然补齐边缘。',
  },
  {
    id: 'crop-fit',
    category: 'crop',
    group: '校正',
    title: '合适画幅',
    scenario: '完整显示主体并补边',
    params: highParams,
    prompt: '调整输入图片画幅让主体完整居中显示：必要时自然扩展或补齐边缘背景，保持主体比例、透视和构图稳定。',
  },
  {
    id: 'tone-black-white',
    category: 'tone',
    group: '全局美化',
    title: '黑白场校正',
    scenario: '压脏灰，提层次',
    params: highParams,
    prompt: '校正输入图片黑白场：压住脏灰和雾感，提升明暗层次与通透度，保留高光细节、暗部信息和真实色彩关系。',
  },
  {
    id: 'tone-noise',
    category: 'tone',
    group: '全局美化',
    title: '降噪锐化',
    scenario: '干净清晰不过锐',
    params: highParams,
    prompt: '对输入图片做专业降噪和适度锐化：减少噪点、压缩痕迹和脏颗粒，同时保留皮肤、衣物、产品材质与边缘细节。',
  },
  {
    id: 'local-face-bright',
    category: 'local',
    group: '局部曝光',
    title: '面部提亮',
    scenario: '脸部亮度更稳定',
    params: highParams,
    prompt: '只对面部做自然提亮和曝光平衡：保持肤色、五官结构、妆容、背景和身体曝光关系稳定，不要整体漂白。',
  },
  {
    id: 'local-background-dark',
    category: 'local',
    group: '局部调色',
    title: '背景压暗',
    scenario: '突出主体',
    params: highParams,
    prompt: '只压暗和整理背景，让主体更突出；主体肤色、产品颜色、衣物和边缘光保持不变，背景过渡要自然。',
  },
  {
    id: 'clothes-wrinkle',
    category: 'clothes',
    group: '衣物美化',
    title: '去衣物褶皱',
    scenario: '衣面平整，纹理保留',
    params: highParams,
    prompt: '去除衣物明显褶皱和不平整区域：保持面料纹理、缝线、图案、身体结构和自然阴影，避免衣服变成一片平面。',
  },
  {
    id: 'clothes-stain',
    category: 'clothes',
    group: '衣物美化',
    title: '去衣物污渍',
    scenario: '污点清理，颜色一致',
    params: highParams,
    prompt: '清理衣物上的污渍、灰尘、线头和局部脏色，匹配原有面料颜色、纹理和光影，不改变衣服款式。',
  },
  {
    id: 'clothes-neckline',
    category: 'clothes',
    group: '衣物美化',
    title: '领口修正',
    scenario: '领口对称，边缘自然',
    params: highParams,
    prompt: '修正衣物领口、袖口或裤腰的不平整和轻微歪斜：保持人体结构、服装款式、纹理和自然阴影。',
  },
  {
    id: 'post-wedding-deep',
    category: 'postColor',
    group: '场景预设',
    title: '婚纱深色内景',
    scenario: '深色背景，高级质感',
    params: highParams,
    prompt: '按婚纱深色内景风格调色：压住背景杂色，提升肤色和白纱层次，保持暗部质感、高光细节和高级氛围。',
  },
  {
    id: 'post-child-dark',
    category: 'postColor',
    group: '场景预设',
    title: '儿童暗调质感',
    scenario: '暗调干净，有故事感',
    params: highParams,
    prompt: '按儿童暗调质感风格调色：降低杂色和背景干扰，保留儿童真实肤色、表情和画面故事感，暗部不能死黑。',
  },
  {
    id: 'ai-smart-filter',
    category: 'aiNative',
    group: 'AI工作流',
    title: '智能筛片建议',
    scenario: '指出保留/重修方向',
    params: highParams,
    prompt: '基于输入图片生成一版可交付修图，并在画面处理上优先解决影响成片率的问题：主体清晰度、表情、肤色、构图、背景干净度和交付一致性。',
  },
  {
    id: 'ai-keep-identity',
    category: 'aiNative',
    group: 'AI工作流',
    title: '身份锁定精修',
    scenario: '强约束五官和主体',
    params: highParams,
    prompt: '对输入图片进行身份锁定精修：所有修图都必须保留人物身份、五官比例、发型、服装、主体结构和背景空间，只改善瑕疵、色彩和光影。',
  },
]

function formatStatus(status?: string) {
  if (status === 'running') return '生成中'
  if (status === 'done') return '已完成'
  if (status === 'error') return '失败'
  return '待提交'
}

function formatElapsed(elapsed: number | null) {
  if (elapsed == null) return ''
  if (elapsed < 1000) return `${elapsed} ms`
  return `${(elapsed / 1000).toFixed(1)} s`
}

function truncateMiddle(value: string, max = 46) {
  const text = value.trim()
  if (text.length <= max) return text
  const head = Math.max(12, Math.floor((max - 3) * 0.58))
  const tail = Math.max(8, max - 3 - head)
  return `${text.slice(0, head)}...${text.slice(-tail)}`
}

function sameImageIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function getNearestOutputRatio(aspectRatio: number | null) {
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return '1:1'

  return commonOutputRatios
    .map((ratio) => ({
      label: ratio.label,
      delta: Math.abs(aspectRatio - ratio.value) / ratio.value,
    }))
    .sort((a, b) => a.delta - b.delta)[0]?.label ?? '1:1'
}

function getOutputSizeIdFromSize(size: string): RetouchOutputSizeId {
  const normalizedSize = normalizeImageSize(size)
  if (normalizedSize === 'auto') return 'auto'

  for (const tier of outputSizeTiers) {
    for (const ratio of commonOutputRatios) {
      if (calculateImageSize(tier, ratio.label) === normalizedSize) return tier
    }
  }

  return 'auto'
}

function buildRetouchPrompt(template: RetouchTemplate, strengthId: RetouchStrengthId, targetId: RetouchTargetId) {
  const strength = strengthOptions.find((option) => option.id === strengthId) ?? strengthOptions[1]
  const target = targetOptions.find((option) => option.id === targetId) ?? targetOptions[0]
  return `${template.prompt}\n\n执行设置：${strength.prompt}${target.prompt} 保持专业修图逻辑：只修改当前功能相关区域，不要改动无关主体、身份、文字、构图和真实光影。`
}

function buildStackedRetouchPrompt(templates: RetouchTemplate[], strengthId: RetouchStrengthId, targetId: RetouchTargetId) {
  if (templates.length === 0) return ''
  if (templates.length === 1) return buildRetouchPrompt(templates[0], strengthId, targetId)

  const strength = strengthOptions.find((option) => option.id === strengthId) ?? strengthOptions[1]
  const target = targetOptions.find((option) => option.id === targetId) ?? targetOptions[0]
  const steps = templates
    .map((template, index) => `${index + 1}. ${template.title}：${template.prompt}`)
    .join('\n')

  return `对输入图片执行以下专业修图组合，按顺序叠加处理，不互相覆盖：\n${steps}\n\n执行设置：${strength.prompt}${target.prompt} 保持专业修图逻辑：只修改已选择功能相关区域，不要改动无关主体、身份、文字、构图和真实光影。`
}

function buildGraduateScenePrompt(scene: FilmSceneAsset, backgroundId: GraduateBackgroundId) {
  const background = graduateBackgroundOptions.find((option) => option.id === backgroundId) ?? graduateBackgroundOptions[0]
  const backgroundInstruction = background.id === 'original'
    ? '- 尽量保留原毕业照中的背景、场地、建筑、教室、操场、横幅、树木、天空和环境结构；在原毕业照背景下完成同一名场面的动作和站位仿拍。\n- 只有当动作重排确实需要时，才允许对原背景做少量透视、光影和氛围适配，不要把背景整体替换成名场面素材的背景。'
    : background.id === 'uploaded'
      ? '- 背景以第三张新上传背景参考图为准，替换或重构最终场景时只学习新背景的空间、光线、环境结构和氛围；不要从新背景图中复制人物或无关物体。'
      : '- 背景可以使用第二张名场面参考图中的空间、光线、环境结构和影视氛围；只能迁移背景和画风，不能复制名场面参考图中的人物、服装或无关 NPC。'

  return `把用户上传的毕业照改造成「${scene.label}」式影视作品名场面仿拍。

输入图规则：
1. 第一张参考图或前面的毕业照参考图是用户毕业照，是唯一的人物身份和服装来源。
2. 第二张参考图是我们提供的影视作品名场面素材，只用于学习动作、站位、构图、镜头、光线、色彩和画风。
${background.id === 'uploaded' ? '3. 第三张参考图是用户新上传背景，只用于学习背景、空间、光线和环境结构。' : ''}

必须严格保留：
- 毕业照里的每一个人物都不能变：脸、五官、发型、肤色、表情识别特征、身高体型关系和人物数量都必须保留。
- 毕业照里的衣服绝对不能变：款式、颜色、领口、袖口、校服/学位服/班服结构、徽章、Logo、文字、图案和褶皱质感都必须保留。
- 不允许换脸、不允许换衣服、不允许增删人物、不允许把参考素材里的人物脸或服装复制到毕业照人物身上。

允许修改：
- 根据名场面素材调整毕业照人物的动作、姿态、队形、站位、镜头透视、画面氛围和影视画风。
- 人数不一致时，必须以毕业照人数为准，只保留原毕业照里真实存在的人物；名场面参考图里多出来的人物、群众演员、路人、NPC 都不能出现在最终结果中。
${backgroundInstruction}

${scene.prompt}
执行设置：${background.prompt} 最终结果要像真实毕业照团队仿拍影视名场面，人物身份和服装必须一眼可确认没有改变。`
}

function mergeTemplateParams(templates: RetouchTemplate[]) {
  return templates.reduce<Partial<TaskParams>>((merged, template) => ({ ...merged, ...template.params }), {})
}

function useCachedImageSource(imageId?: string | null, fallbackSrc?: string | null) {
  const normalizedImageId = imageId ?? null
  const fallback = fallbackSrc ?? null
  const [loadedImage, setLoadedImage] = useState<{ imageId: string; src: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!normalizedImageId) {
      setLoadedImage(null)
      return () => {
        cancelled = true
      }
    }

    setLoadedImage((current) => current?.imageId === normalizedImageId ? current : null)
    ensureImageCached(normalizedImageId).then((url) => {
      if (!cancelled) setLoadedImage({ imageId: normalizedImageId, src: url ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [normalizedImageId])

  if (!normalizedImageId) return fallback
  if (loadedImage?.imageId !== normalizedImageId) return fallback
  return loadedImage.src ?? fallback
}

function getApiDisplayLabel(value: string) {
  if (!value || value === '未填写 API 地址') return value
  try {
    const url = new URL(value)
    return url.host
  } catch {
    return truncateMiddle(value)
  }
}

function OutputImage({
  imageId,
  imageList,
  label,
}: {
  imageId: string
  imageList: string[]
  label: string
}) {
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const src = useCachedImageSource(imageId)

  return (
    <button
      type="button"
      className="retouch-result-thumb"
      onClick={() => setLightboxImageId(imageId, imageList)}
      aria-label={`查看${label}`}
    >
      {src ? <img src={src} alt={label} /> : <span>读取中</span>}
    </button>
  )
}

function HistoryThumb({ task }: { task: { outputImages: string[]; inputImageIds: string[] } }) {
  const thumbId = task.outputImages[0] ?? task.inputImageIds[0] ?? null
  const src = useCachedImageSource(thumbId)

  return (
    <span className="retouch-history-thumb">
      {src ? <img src={src} alt="" /> : <PhotoIcon className="h-4 w-4" />}
    </span>
  )
}

function RetouchPreviewEmpty({
  hasHistorySelection,
  generationMode,
  onUpload,
}: {
  hasHistorySelection: boolean
  generationMode: RetouchGenerationMode
  onUpload: () => void
}) {
  const title = hasHistorySelection
    ? '历史记录缺少可预览图片'
    : generationMode === 'text'
      ? '输入画面描述开始生成'
      : '上传参考图开始修图'
  const description = hasHistorySelection
    ? '请选择另一条历史，或重新上传参考图。'
    : generationMode === 'text'
      ? '文生图模式不会引用参考图，适合从空白画布创建新图。'
      : '清空参考图后不会继续显示上一次修图结果。'

  return (
    <button type="button" className="retouch-preview-empty" onClick={onUpload}>
      <PhotoIcon className="h-6 w-6" />
      <strong>{title}</strong>
      <span>{description}</span>
      <span className="retouch-preview-upload-cta">
        {generationMode === 'text' ? '上传参考图并修图' : '上传参考图'}
      </span>
    </button>
  )
}

function RetouchPreviewImage({
  src,
  alt,
  fitStyle,
  imageStyle,
  onImageMeasure,
}: {
  src: string
  alt: string
  fitStyle?: CSSProperties
  imageStyle?: CSSProperties
  onImageMeasure: (aspectRatio: number) => void
}) {
  const [orientation, setOrientation] = useState<'wide' | 'tall' | 'square'>('square')

  return (
    <div className={`retouch-image-plane is-${orientation}`}>
      <div className="retouch-image-fit-box" style={fitStyle}>
        <img
          className="retouch-preview-image"
          src={src}
          alt={alt}
          style={imageStyle}
          onLoad={(event) => {
            const image = event.currentTarget
            const ratio = image.naturalWidth / Math.max(image.naturalHeight, 1)
            setOrientation(ratio > 1.08 ? 'wide' : ratio < 0.92 ? 'tall' : 'square')
            onImageMeasure(ratio)
          }}
        />
      </div>
    </div>
  )
}

async function loadFiles(files: FileList | File[]) {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
  for (const file of imageFiles) {
    await addImageFromFile(file)
  }
  return imageFiles.length
}

function isFilmSceneReferenceImage(image: InputImage) {
  return image.meta?.source === 'built-in-film-scene' || image.meta?.source === 'custom-film-scene'
}

function isGraduateBackgroundReferenceImage(image: InputImage) {
  return image.meta?.source === 'graduate-background'
}

function isGraduateAuxiliaryReferenceImage(image: InputImage) {
  return isFilmSceneReferenceImage(image) || isGraduateBackgroundReferenceImage(image)
}

function orderGraduateReferenceImages(images: InputImage[]) {
  const graduatePhotos = images.filter((image) => !isGraduateAuxiliaryReferenceImage(image))
  const filmSceneReferences = images.filter(isFilmSceneReferenceImage)
  const backgroundReferences = images.filter(isGraduateBackgroundReferenceImage)
  return [...graduatePhotos, ...filmSceneReferences, ...backgroundReferences]
}

export default function RetouchWorkspace() {
  const settings = useStore((s) => s.settings)
  const tasks = useStore((s) => s.tasks)
  const inputImages = useStore((s) => s.inputImages)
  const prompt = useStore((s) => s.prompt)
  const params = useStore((s) => s.params)
  const setPrompt = useStore((s) => s.setPrompt)
  const setParams = useStore((s) => s.setParams)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const setInputImages = useStore((s) => s.setInputImages)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const maskDraft = useStore((s) => s.maskDraft)
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)

  const previewStageRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filmSceneInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewImageAspect, setPreviewImageAspect] = useState<number | null>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [previewPanDragging, setPreviewPanDragging] = useState(false)
  const previewPanStartRef = useRef({ pointerId: 0, clientX: 0, clientY: 0, x: 0, y: 0 })
  const [isDraggingUpload, setIsDraggingUpload] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<RetouchCategoryId>('graduateScene')
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<RetouchTemplateId[]>([])
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>('影视作品名场面')
  const [selectedStrengthId, setSelectedStrengthId] = useState<RetouchStrengthId>('standard')
  const [selectedTargetId, setSelectedTargetId] = useState<RetouchTargetId>('auto')
  const [selectedFilmSceneId, setSelectedFilmSceneId] = useState<FilmSceneId | null>(defaultFilmSceneId)
  const [selectedGraduateBackgroundId, setSelectedGraduateBackgroundId] = useState<GraduateBackgroundId>('original')
  const [generationMode, setGenerationMode] = useState<RetouchGenerationMode>('edit')
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null)
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [comparePosition, setComparePosition] = useState(50)
  const [compareDragging, setCompareDragging] = useState(false)
  const [inputSessionStartedAt, setInputSessionStartedAt] = useState(0)
  const [textSessionStartedAt, setTextSessionStartedAt] = useState(0)
  const [customFilmScenes, setCustomFilmScenes] = useState<FilmSceneAsset[]>([])
  const inputSignatureRef = useRef<string | null>(null)
  const generatedPromptRef = useRef<string | null>(null)
  const promptManuallyEditedRef = useRef(false)
  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const apiIssue = validateApiProfile(activeProfile)
  const retouchTasks = useMemo(
    () => tasks.filter((task) => task.sourceMode !== 'agent' && !task.agentConversationId && !task.agentRoundId),
    [tasks],
  )
  const currentInputIds = useMemo(() => inputImages.map((image) => image.id), [inputImages])
  const currentInputSignature = currentInputIds.join('|')
  const hasCurrentInput = currentInputIds.length > 0
  const isTextToImageMode = generationMode === 'text'
  const isImageEditMode = generationMode === 'edit'
  const latestTaskForCurrentInput = hasCurrentInput
    ? retouchTasks.find((task) =>
      task.createdAt >= inputSessionStartedAt &&
      sameImageIds(task.inputImageIds, currentInputIds),
    ) ?? null
    : null
  const latestTaskWithOutputForCurrentInput = latestTaskForCurrentInput?.outputImages.length
    ? latestTaskForCurrentInput
    : hasCurrentInput
      ? retouchTasks.find((task) =>
        task.createdAt >= inputSessionStartedAt &&
        task.outputImages.length > 0 &&
        sameImageIds(task.inputImageIds, currentInputIds),
      ) ?? null
      : null
  const latestTextTask = isTextToImageMode
    ? retouchTasks.find((task) => task.createdAt >= textSessionStartedAt && task.inputImageIds.length === 0) ?? null
    : null
  const latestTextTaskWithOutput = latestTextTask?.outputImages.length
    ? latestTextTask
    : isTextToImageMode
      ? retouchTasks.find((task) =>
        task.createdAt >= textSessionStartedAt &&
        task.inputImageIds.length === 0 &&
        task.outputImages.length > 0,
      ) ?? null
      : null
  const selectedHistoryTask = selectedHistoryTaskId ? retouchTasks.find((task) => task.id === selectedHistoryTaskId) ?? null : null
  const previewMode: RetouchPreviewMode = selectedHistoryTask
    ? 'history'
    : isTextToImageMode
      ? latestTextTask || latestTextTaskWithOutput ? 'current' : 'empty'
      : hasCurrentInput
        ? 'current'
        : 'empty'
  const visibleTask: TaskRecord | null = previewMode === 'history'
    ? selectedHistoryTask
    : previewMode === 'current'
      ? isTextToImageMode
        ? latestTextTaskWithOutput ?? latestTextTask
        : latestTaskWithOutputForCurrentInput ?? latestTaskForCurrentInput
      : null
  const visibleOutputTask: TaskRecord | null = visibleTask?.outputImages.length ? visibleTask : null
  const inputPreview = previewMode === 'current' && isImageEditMode ? inputImages[0]?.dataUrl ?? null : null
  const beforeImageId = visibleOutputTask?.inputImageIds[0] ?? (previewMode === 'current' && isImageEditMode ? currentInputIds[0] : null)
  const outputImageId = visibleOutputTask?.outputImages[0] ?? null
  const beforeImageSrc = useCachedImageSource(beforeImageId, inputPreview)
  const outputImageSrc = useCachedImageSource(outputImageId)
  const outputSizeRatio = useMemo(() => getNearestOutputRatio(previewImageAspect), [previewImageAspect])
  const outputSizeOptions = useMemo(
    () => [
      { id: 'auto' as const, label: '自动', hint: outputSizeHints.auto, value: 'auto' },
      ...outputSizeTiers.map((tier) => ({
        id: tier,
        label: tier,
        hint: outputSizeHints[tier],
        value: calculateImageSize(tier, outputSizeRatio) ?? 'auto',
      })),
    ],
    [outputSizeRatio],
  )
  const activeOutputSizeId = getOutputSizeIdFromSize(params.size)
  const hasPreviewImage = Boolean(outputImageSrc || beforeImageSrc)
  const canCompare = Boolean(visibleOutputTask?.inputImageIds[0] && visibleOutputTask?.outputImages[0] && beforeImageSrc && outputImageSrc)
  const canUsePreviewZoom = hasPreviewImage && !(compareEnabled && canCompare)
  const previewTitle = outputImageSrc
    ? previewMode === 'history' ? '历史结果' : isTextToImageMode ? '生成结果' : '修图结果'
    : previewMode === 'history' ? '历史原图' : previewMode === 'current' ? isTextToImageMode ? '生成中' : '输入参考' : '空白画布'
  const previewEmptyHasHistorySelection = previewMode === 'history'
  const currentStatusTask = previewMode === 'current' ? isTextToImageMode ? latestTextTask : latestTaskForCurrentInput : null
  const runningCount = retouchTasks.filter((task) => task.status === 'running').length
  const doneCount = retouchTasks.filter((task) => task.status === 'done').length
  const selectedTemplates = selectedTemplateIds
    .map((id) => retouchTemplates.find((template) => template.id === id))
    .filter((template): template is RetouchTemplate => Boolean(template))
  const filmSceneOptions = useMemo<FilmSceneAsset[]>(() => [...customFilmScenes, ...filmSceneAssets], [customFilmScenes])
  const selectedFilmScene = selectedFilmSceneId
    ? filmSceneOptions.find((scene) => scene.id === selectedFilmSceneId) ?? null
    : null
  const isGraduateSceneWorkflow = selectedCategoryId === 'graduateScene'
  const selectedConfigCount = selectedTemplates.length + (isGraduateSceneWorkflow && selectedFilmScene ? 1 : 0)
  const selectedTemplateSummary = selectedTemplates.length
    ? selectedTemplates.map((template) => template.title).join(' + ')
    : isGraduateSceneWorkflow && selectedFilmScene
      ? `毕业仿拍 · ${selectedFilmScene.label}`
      : '自定义修图'
  const currentWorkSummary = isTextToImageMode ? '文生图创作' : selectedTemplateSummary
  const selectedCategory = retouchCategories.find((category) => category.id === selectedCategoryId) ?? retouchCategories[0]
  const selectedStrength = strengthOptions.find((option) => option.id === selectedStrengthId) ?? strengthOptions[1]
  const selectedTarget = targetOptions.find((option) => option.id === selectedTargetId) ?? targetOptions[0]
  const selectedGraduateBackground = graduateBackgroundOptions.find((option) => option.id === selectedGraduateBackgroundId) ?? graduateBackgroundOptions[0]
  const categoryIds = categoryTemplateAliases[selectedCategoryId] ?? [selectedCategoryId]
  const categoryTemplates = retouchTemplates.filter((template) => categoryIds.includes(template.category))
  const groupedCategoryTemplates = categoryTemplates.reduce<Array<{ group: string; templates: RetouchTemplate[] }>>((groups, template) => {
    const group = template.group ?? selectedCategory.title
    const current = groups.find((item) => item.group === group)
    if (current) {
      current.templates.push(template)
    } else {
      groups.push({ group, templates: [template] })
    }
    return groups
  }, [])
  const activeGroupName = selectedGroupName && groupedCategoryTemplates.some((group) => group.group === selectedGroupName)
    ? selectedGroupName
    : groupedCategoryTemplates[0]?.group ?? null
  const activeGroupTemplates = groupedCategoryTemplates.find((group) => group.group === activeGroupName)?.templates ?? []
  const getCategorySelectionCount = (categoryId: RetouchCategoryId) => {
    if (categoryId === 'graduateScene') return selectedFilmScene ? 1 : 0
    const ids = categoryTemplateAliases[categoryId] ?? [categoryId]
    return selectedTemplates.filter((template) => ids.includes(template.category)).length
  }
  const getGroupSelectionCount = (templates: RetouchTemplate[]) => (
    templates.filter((template) => selectedTemplateIds.includes(template.id)).length
  )
  const setGeneratedPrompt = (nextPrompt: string) => {
    generatedPromptRef.current = nextPrompt
    promptManuallyEditedRef.current = false
    if (useStore.getState().prompt !== nextPrompt) setPrompt(nextPrompt)
  }
  const canReplaceWithGeneratedPrompt = (nextPrompt: string) => {
    const currentPrompt = useStore.getState().prompt
    if (promptManuallyEditedRef.current) return false
    if (!currentPrompt.trim()) return true
    if (generatedPromptRef.current !== null) return currentPrompt === generatedPromptRef.current
    return currentPrompt === nextPrompt
  }
  const historyTasks = retouchTasks
  const maskTargetInput = maskDraft ? inputImages.find((image) => image.id === maskDraft.targetImageId) ?? null : null
  const referenceImages = maskTargetInput ? inputImages.filter((image) => image.id !== maskTargetInput.id) : inputImages
  const graduatePhotoImages = inputImages.filter((image) => !isGraduateAuxiliaryReferenceImage(image))
  const uploadedBackgroundImage = inputImages.find(isGraduateBackgroundReferenceImage) ?? null
  const activeBaseUrl = activeProfile.baseUrl.trim()
  const requestBaseUrl = activeBaseUrl
    ? `${activeBaseUrl.replace(/\/+$/, '')}${activeBaseUrl.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'}`
    : '未填写 API 地址'
  const previewImageFitStyle = useMemo<CSSProperties | undefined>(() => {
    if (!previewImageAspect || previewImageAspect <= 0 || !previewStageSize.width || !previewStageSize.height) return undefined
    const stageAspect = previewStageSize.width / previewStageSize.height
    const fitWidth = stageAspect > previewImageAspect
      ? previewStageSize.height * previewImageAspect
      : previewStageSize.width
    const fitHeight = stageAspect > previewImageAspect
      ? previewStageSize.height
      : previewStageSize.width / previewImageAspect

    return {
      width: `${Math.max(1, Math.floor(fitWidth))}px`,
      height: `${Math.max(1, Math.floor(fitHeight))}px`,
    }
  }, [previewImageAspect, previewStageSize.height, previewStageSize.width])
  const previewImageTransformStyle = useMemo<CSSProperties | undefined>(() => {
    if (previewZoom <= 1 && previewPan.x === 0 && previewPan.y === 0) return undefined
    return {
      transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
      cursor: previewZoom > 1 ? (previewPanDragging ? 'grabbing' : 'grab') : undefined,
    }
  }, [previewPan.x, previewPan.y, previewPanDragging, previewZoom])
  const handlePreviewImageMeasure = (aspectRatio: number) => {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return
    setPreviewImageAspect((current) => (
      current != null && Math.abs(current - aspectRatio) < 0.001 ? current : aspectRatio
    ))
  }

  useEffect(() => {
    const node = previewStageRef.current
    if (!node) return

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      const width = Math.max(0, Math.floor(rect.width))
      const height = Math.max(0, Math.floor(rect.height))
      setPreviewStageSize((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ))
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPreviewImageAspect(null)
    setPreviewZoom(1)
    setPreviewPan({ x: 0, y: 0 })
  }, [beforeImageId, outputImageId, previewMode])

  useEffect(() => {
    if (selectedHistoryTaskId && !retouchTasks.some((task) => task.id === selectedHistoryTaskId)) {
      setSelectedHistoryTaskId(null)
    }
  }, [retouchTasks, selectedHistoryTaskId])

  useEffect(() => {
    if (selectedCategoryId !== 'graduateScene' || !selectedFilmScene || selectedTemplateIds.length) return
    const nextPrompt = buildGraduateScenePrompt(selectedFilmScene, selectedGraduateBackgroundId)
    if (!canReplaceWithGeneratedPrompt(nextPrompt)) return
    setGeneratedPrompt(nextPrompt)
  }, [prompt, selectedCategoryId, selectedFilmScene, selectedGraduateBackgroundId, selectedTemplateIds.length, setPrompt])

  useEffect(() => {
    if (inputSignatureRef.current == null) {
      inputSignatureRef.current = currentInputSignature
      return
    }
    if (inputSignatureRef.current === currentInputSignature) return
    inputSignatureRef.current = currentInputSignature
    setInputSessionStartedAt(Date.now())
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
  }, [currentInputSignature])

  useEffect(() => {
    if (!hasCurrentInput && !selectedHistoryTaskId && inputSessionStartedAt !== 0) {
      setInputSessionStartedAt(0)
    }
  }, [hasCurrentInput, inputSessionStartedAt, selectedHistoryTaskId])

  useEffect(() => {
    if (!canCompare && compareEnabled) setCompareEnabled(false)
  }, [canCompare, compareEnabled])

  useEffect(() => {
    if (!canUsePreviewZoom && previewZoom !== 1) {
      setPreviewZoom(1)
      setPreviewPan({ x: 0, y: 0 })
    }
  }, [canUsePreviewZoom, previewZoom])

  useEffect(() => {
    if (activeOutputSizeId === 'auto') return
    const selectedOption = outputSizeOptions.find((option) => option.id === activeOutputSizeId)
    if (!selectedOption || selectedOption.value === params.size) return
    setParams({ size: selectedOption.value })
  }, [activeOutputSizeId, outputSizeOptions, params.size, setParams])

  useEffect(() => {
    if (groupedCategoryTemplates.length && !groupedCategoryTemplates.some((group) => group.group === selectedGroupName)) {
      setSelectedGroupName(groupedCategoryTemplates[0].group)
    }
  }, [groupedCategoryTemplates, selectedGroupName])

  const removeFilmSceneReference = () => {
    const currentImages = useStore.getState().inputImages
    if (currentImages.some(isFilmSceneReferenceImage)) {
      setInputImages(currentImages.filter((image) => !isFilmSceneReferenceImage(image)))
    }
  }

  const removeGraduateBackgroundReference = () => {
    const currentImages = useStore.getState().inputImages
    if (currentImages.some(isGraduateBackgroundReferenceImage)) {
      setInputImages(currentImages.filter((image) => !isGraduateBackgroundReferenceImage(image)))
    }
  }

  const clearFilmSceneSelection = () => {
    setSelectedFilmSceneId(null)
    removeFilmSceneReference()
  }

  const ensureFilmSceneReference = async (scene: FilmSceneAsset) => {
    let image: InputImage | null = scene.inputImage ?? null
    if (!image) {
      const response = await fetch(scene.src)
      if (!response.ok) throw new Error(`素材读取失败：HTTP ${response.status}`)
      const blob = await response.blob()
      const file = new File([blob], `${scene.id}.png`, { type: blob.type || 'image/png' })
      image = await createInputImageFromFile(file)
    }
    if (!image) throw new Error('素材不是有效图片')

    const currentImages = useStore.getState().inputImages
    const nextImages = [
      ...currentImages.filter((item) => !isFilmSceneReferenceImage(item)),
      {
        ...image,
        meta: {
          source: scene.source === 'custom' ? 'custom-film-scene' as const : 'built-in-film-scene' as const,
          sceneId: scene.id,
          label: scene.label,
        },
      },
    ]
    setInputImages(orderGraduateReferenceImages(nextImages))
  }

  const applyFilmScene = async (scene: FilmSceneAsset) => {
    setGenerationMode('edit')
    setSelectedCategoryId('graduateScene')
    setSelectedGroupName('影视作品名场面')
    setSelectedTemplateIds([])
    setSelectedFilmSceneId(scene.id)
    setGeneratedPrompt(buildGraduateScenePrompt(scene, selectedGraduateBackgroundId))
    setParams({ ...highParams, n: 1 })
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)

    if (!useStore.getState().inputImages.some((image) => !isGraduateAuxiliaryReferenceImage(image))) {
      removeFilmSceneReference()
      showToast(`已选择「${scene.label}」，请先上传毕业照原图`, 'info')
      return
    }

    try {
      await ensureFilmSceneReference(scene)
      showToast(`已选择「${scene.label}」，素材已加入参考图`, 'success')
    } catch (error) {
      showToast(`名场面素材加入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleRemoveInputImage = (index: number) => {
    const removed = inputImages[index]
    removeInputImage(index)
    if (removed && isFilmSceneReferenceImage(removed)) {
      setSelectedFilmSceneId(null)
      showToast('已移除名场面素材', 'success')
    } else if (removed && isGraduateBackgroundReferenceImage(removed)) {
      setSelectedGraduateBackgroundId('original')
      showToast('已移除新上传背景', 'success')
    }
  }

  const handleClearInputImages = () => {
    clearInputImages()
    setSelectedFilmSceneId(null)
    setSelectedGraduateBackgroundId('original')
  }

  const toggleTemplate = (template: RetouchTemplate) => {
    if (selectedFilmSceneId) {
      clearFilmSceneSelection()
    }
    const nextTemplateIds = selectedTemplateIds.includes(template.id)
      ? selectedTemplateIds.filter((id) => id !== template.id)
      : [...selectedTemplateIds, template.id]
    const nextTemplates = nextTemplateIds
      .map((id) => retouchTemplates.find((item) => item.id === id))
      .filter((item): item is RetouchTemplate => Boolean(item))

    setSelectedCategoryId(template.category)
    setSelectedGroupName(template.group ?? template.category)
    setSelectedTemplateIds(nextTemplateIds)
    setGeneratedPrompt(buildStackedRetouchPrompt(nextTemplates, selectedStrengthId, selectedTargetId))
    if (nextTemplates.length) setParams(mergeTemplateParams(nextTemplates))
    showToast(
      selectedTemplateIds.includes(template.id)
        ? `已移除「${template.title}」`
        : `已叠加「${template.title}」`,
      'success',
    )
  }

  const applyStrength = (strengthId: RetouchStrengthId) => {
    setSelectedStrengthId(strengthId)
    if (selectedTemplates.length) {
      const nextPrompt = buildStackedRetouchPrompt(selectedTemplates, strengthId, selectedTargetId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    if (isGraduateSceneWorkflow && selectedFilmScene) {
      const nextPrompt = buildGraduateScenePrompt(selectedFilmScene, selectedGraduateBackgroundId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    showToast(`强度已设为「${strengthOptions.find((option) => option.id === strengthId)?.label ?? '标准'}」`, 'success')
  }

  const applyTarget = (targetId: RetouchTargetId) => {
    setSelectedTargetId(targetId)
    if (selectedTemplates.length) {
      const nextPrompt = buildStackedRetouchPrompt(selectedTemplates, selectedStrengthId, targetId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    if (isGraduateSceneWorkflow && selectedFilmScene) {
      const nextPrompt = buildGraduateScenePrompt(selectedFilmScene, selectedGraduateBackgroundId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    showToast(`对象已设为「${targetOptions.find((option) => option.id === targetId)?.label ?? '自动'}」`, 'success')
  }

  const applyGraduateBackground = (backgroundId: GraduateBackgroundId) => {
    setSelectedGraduateBackgroundId(backgroundId)
    if (backgroundId !== 'uploaded') removeGraduateBackgroundReference()
    if (selectedFilmScene) {
      const nextPrompt = buildGraduateScenePrompt(selectedFilmScene, backgroundId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    if (backgroundId === 'uploaded' && !useStore.getState().inputImages.some(isGraduateBackgroundReferenceImage)) {
      showToast('请选择一张新背景参考图', 'info')
      backgroundInputRef.current?.click()
      return
    }
    const label = graduateBackgroundOptions.find((option) => option.id === backgroundId)?.label ?? '保留原背景'
    showToast(`背景已设为「${label}」`, 'success')
  }

  const updateComparePosition = (clientX: number) => {
    const rect = previewStageRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = ((clientX - rect.left) / rect.width) * 100
    setComparePosition(Math.max(4, Math.min(96, next)))
  }

  const handleCompareToggle = () => {
    if (!canCompare) {
      showToast('需要先上传参考图并完成一次修图，才能开启前后对比', 'info')
      return
    }
    setCompareEnabled((current) => !current)
  }

  const handleComparePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canCompare) return
    setCompareEnabled(true)
    setCompareDragging(true)
    updateComparePosition(event.clientX)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleComparePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (compareDragging) updateComparePosition(event.clientX)
  }

  const handleComparePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    setCompareDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const applyPreviewZoom = (zoom: number) => {
    if (!hasPreviewImage) {
      showToast('先上传参考图或选择历史结果后再放大查看', 'info')
      return
    }
    if (compareEnabled && canCompare) {
      showToast('前后对比模式下暂不支持放大，请先关闭对比', 'info')
      return
    }
    const next = Math.max(previewZoomMin, Math.min(previewZoomMax, zoom))
    setPreviewZoom(next)
    if (next === 1) setPreviewPan({ x: 0, y: 0 })
  }

  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!canUsePreviewZoom) return
    event.preventDefault()
    const next = previewZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)
    applyPreviewZoom(Math.round(Math.max(previewZoomMin, Math.min(previewZoomMax, next)) * 100) / 100)
  }

  const handlePreviewPanPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canUsePreviewZoom || previewZoom <= 1 || event.button !== 0) return
    setPreviewPanDragging(true)
    previewPanStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: previewPan.x,
      y: previewPan.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePreviewPanPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!previewPanDragging || previewPanStartRef.current.pointerId !== event.pointerId) return
    setPreviewPan({
      x: previewPanStartRef.current.x + event.clientX - previewPanStartRef.current.clientX,
      y: previewPanStartRef.current.y + event.clientY - previewPanStartRef.current.clientY,
    })
  }

  const handlePreviewPanPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (previewPanStartRef.current.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPreviewPanDragging(false)
  }

  const switchGenerationMode = (mode: RetouchGenerationMode) => {
    if (mode === generationMode) return
    setGenerationMode(mode)
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
    if (mode === 'text') {
      setTextSessionStartedAt(Date.now())
      showToast(inputImages.length ? '已切换为文生图，提交时不会引用参考图' : '已切换为文生图', 'success')
    } else {
      showToast('已切换为图生图修图', 'success')
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const count = await loadFiles(files)
      if (count > 0) {
        setGenerationMode('edit')
        setSelectedHistoryTaskId(null)
        setCompareEnabled(false)
        if (selectedFilmScene) {
          try {
            await ensureFilmSceneReference(selectedFilmScene)
          } catch (error) {
            showToast(`名场面素材加入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
            return
          }
        }
        setInputImages(orderGraduateReferenceImages(useStore.getState().inputImages))
        showToast(`已添加 ${count} 张毕业照参考图，已切换为图生图修图`, 'success')
      }
    } catch (error) {
      showToast(`上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleBackgroundFiles = async (files: FileList | File[]) => {
    const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
    if (!imageFile) {
      showToast('请上传图片格式的新背景参考', 'info')
      return
    }

    try {
      const image = await createInputImageFromFile(imageFile)
      if (!image) {
        showToast('新背景上传失败：图片无效', 'error')
        return
      }
      const currentImages = useStore.getState().inputImages
      const nextImages = [
        ...currentImages.filter((item) => !isGraduateBackgroundReferenceImage(item)),
        {
          ...image,
          meta: {
            source: 'graduate-background' as const,
            label: '新上传背景',
          },
        },
      ]
      setSelectedGraduateBackgroundId('uploaded')
      setInputImages(orderGraduateReferenceImages(nextImages))
      if (selectedFilmScene) {
        const nextPrompt = buildGraduateScenePrompt(selectedFilmScene, 'uploaded')
        if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
      }
      showToast('已上传新背景参考', 'success')
    } catch (error) {
      showToast(`新背景上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleFilmSceneFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) {
      showToast('请上传图片格式的名场面参考', 'info')
      return
    }

    try {
      const nextScenes: FilmSceneAsset[] = []
      for (const file of imageFiles) {
        const image = await createInputImageFromFile(file)
        if (!image) continue
        const labelIndex = customFilmScenes.length + nextScenes.length + 1
        nextScenes.push({
          id: `custom-film-scene-${image.id}` as FilmSceneId,
          label: `自定义名场面 ${String(labelIndex).padStart(2, '0')}`,
          src: image.dataUrl,
          prompt: '参考用户上传的自定义影视作品名场面：只学习动作关系、群像站位、镜头构图、光线节奏、色彩氛围和整体画风。',
          source: 'custom',
          inputImage: image,
        })
      }
      if (!nextScenes.length) {
        showToast('名场面参考上传失败：图片无效', 'error')
        return
      }

      setCustomFilmScenes((current) => [...nextScenes, ...current])
      await applyFilmScene(nextScenes[0])
      showToast(`已上传 ${nextScenes.length} 张名场面参考，请在左侧选择使用`, 'success')
    } catch (error) {
      showToast(`名场面参考上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleSubmit = async () => {
    if (apiIssue) {
      showToast(`请先配置 API：${apiIssue}`, 'error')
      setShowSettings(true, 'api')
      return
    }
    if (isImageEditMode && isGraduateSceneWorkflow) {
      const scene = selectedFilmScene
      const currentImages = useStore.getState().inputImages
      if (!currentImages.some((image) => !isGraduateAuxiliaryReferenceImage(image))) {
        showToast('毕业仿拍需要先上传用户毕业照原图', 'info')
        return
      }
      if (!scene) {
        showToast('请先选择一个影视作品名场面素材', 'info')
        return
      }
      if (!currentImages.some(isFilmSceneReferenceImage)) {
        try {
          await ensureFilmSceneReference(scene)
        } catch (error) {
          showToast(`名场面素材加入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
          return
        }
      }
      if (selectedGraduateBackgroundId === 'uploaded' && !useStore.getState().inputImages.some(isGraduateBackgroundReferenceImage)) {
        showToast('已选择新上传背景，请先上传背景参考图', 'info')
        backgroundInputRef.current?.click()
        return
      }
      setInputImages(orderGraduateReferenceImages(useStore.getState().inputImages))
    }
    if (isImageEditMode && inputImages.length === 0) {
      showToast('图生图修图需要先上传参考图，或切换到文生图', 'info')
      return
    }
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
    if (isTextToImageMode && textSessionStartedAt === 0) setTextSessionStartedAt(Date.now())
    void submitTask({ textToImage: isTextToImageMode })
  }

  const handleMaskEdit = () => {
    if (isTextToImageMode) {
      showToast('文生图不需要遮罩；切换到图生图修图后再涂抹区域', 'info')
      return
    }
    const targetId = maskDraft?.targetImageId ?? inputImages[0]?.id
    if (!targetId) {
      showToast('请先上传一张参考图，再涂抹指定区域', 'info')
      return
    }
    setMaskEditorImageId(targetId)
  }

  const openVisibleOutput = () => {
    if (!visibleTask?.outputImages.length) {
      showToast('当前还没有可查看的输出图', 'info')
      return
    }
    setLightboxImageId(visibleTask.outputImages[0], visibleTask.outputImages)
  }

  const promptFieldLabel = isTextToImageMode ? '画面描述' : '修图要求'
  const promptPlaceholder = isTextToImageMode
    ? '直接描述要生成的画面、主体、风格、镜头、光线、构图和比例。例：商业棚拍质感的护肤品海报，白色背景，柔和侧光，干净高级。'
    : isGraduateSceneWorkflow
      ? '可补充仿拍要求。默认会严格保留毕业照中每个人的身份和衣服，只参考名场面的动作、站位、构图和画风。'
      : '直接描述要修哪里、强度、必须保留什么。例：保留人物身份和镜框结构，去掉皮肤瑕疵，肤色更干净自然。'
  const submitLabel = apiIssue ? '配置 API' : isTextToImageMode ? '提交生成' : isGraduateSceneWorkflow ? '提交毕业仿拍' : maskDraft ? '提交局部修图' : '提交修图'
  const historyTitle = isTextToImageMode ? '生成历史' : '修图历史'
  const currentPromptFallback = isTextToImageMode
    ? '写清楚主体、场景、风格、构图、色彩、比例和不想出现的内容。'
    : '先选择一个修图预设，或者在右侧输入框直接写修图要求。'

  return (
    <section data-no-drag-select className="retouch-workspace safe-area-x">
      <div className="retouch-studio-shell">
        <header className="retouch-studio-header">
          <div className="retouch-studio-title">
            <h2>AI 专业修图工作台</h2>
            <div className="retouch-studio-status-row">
              <span className={apiIssue ? 'is-warning' : 'is-ready'}>{apiIssue ? `API 未完成：${apiIssue}` : 'API 已就绪'}</span>
              <span>{activeProfile.model || '未设置模型'}</span>
              <span>{isTextToImageMode ? '文生图模式' : `${inputImages.length} 张输入图`}</span>
              <span>{runningCount ? `${runningCount} 个任务生成中` : `${doneCount} 个结果`}</span>
            </div>
          </div>
          <div className="retouch-studio-hint">{isTextToImageMode ? '输入画面描述后直接生成' : '选择预设后在右侧确认要求并提交'}</div>
        </header>

        <div className="retouch-studio-body">
          <aside className="retouch-workflow-panel">
            <div className="retouch-api-card">
              <div>
                <span>当前请求地址</span>
                <strong className="retouch-api-url" title={requestBaseUrl}>{getApiDisplayLabel(requestBaseUrl)}</strong>
                {requestBaseUrl !== '未填写 API 地址' && <small>/v1 接口</small>}
              </div>
            </div>

            <div className="retouch-left-body">
              <nav className="retouch-primary-menu" aria-label="一级功能菜单">
                <div className="retouch-primary-title">
                  <span>工具</span>
                  <strong>{selectedConfigCount ? `${selectedConfigCount} 项` : '未选择'}</strong>
                </div>
                <div className="retouch-category-grid">
                  {retouchCategories.map((category) => {
                    const Icon = category.icon
                    const active = selectedCategoryId === category.id
                    const selectedCount = getCategorySelectionCount(category.id)
                    return (
                      <button
                        key={category.id}
                        type="button"
                        className={`retouch-category-button ${category.badge ? 'is-featured' : ''} ${active ? 'is-active' : ''}`}
                        aria-label={`${category.title}${selectedCount ? `，已选 ${selectedCount} 项` : ''}`}
                        onClick={() => {
                          setSelectedCategoryId(category.id)
                          if (category.id === 'graduateScene') {
                            setSelectedGroupName('影视作品名场面')
                            setSelectedTemplateIds([])
                            const nextPrompt = selectedFilmScene ? buildGraduateScenePrompt(selectedFilmScene, selectedGraduateBackgroundId) : ''
                            if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
                            return
                          }
                          const ids = categoryTemplateAliases[category.id] ?? [category.id]
                          const firstTemplate = retouchTemplates.find((template) => ids.includes(template.category))
                          setSelectedGroupName(firstTemplate?.group ?? null)
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="retouch-category-copy">
                          <span className="retouch-category-title">
                            <span className="retouch-category-name">{category.shortTitle}</span>
                            {category.badge && <span className="retouch-category-badge">{category.badge}</span>}
                          </span>
                          <small className="retouch-category-summary">{category.summary}</small>
                        </span>
                        {selectedCount > 0 && <span className="retouch-category-count">{selectedCount}</span>}
                      </button>
                    )
                  })}
                </div>
              </nav>

              <div className="retouch-secondary-menu">
                <div className="retouch-secondary-head">
                  <div>
                    <span>当前功能</span>
                    <strong>{selectedCategory.title}</strong>
                  </div>
                  <small>{selectedCategory.summary}</small>
                </div>

                <div className="retouch-template-list">
                  {selectedCategoryId === 'graduateScene' ? (
                    <div className="retouch-film-scene-panel">
                      <div className="retouch-film-scene-guide">
                        <strong>毕业照名场面仿拍</strong>
                        <span>右侧上传毕业照，左侧上传或选择名场面参考。系统只借用动作、站位、构图和画风，人物身份与衣服必须保持不变。</span>
                      </div>
                      <div className="retouch-film-scene-status">
                        <span className={graduatePhotoImages.length ? 'is-ready' : ''}>
                          毕业照 {graduatePhotoImages.length ? `${graduatePhotoImages.length} 张` : '未上传'}
                        </span>
                        <span className={selectedFilmScene ? 'is-ready' : ''}>
                          名场面 {selectedFilmScene?.label ?? '未选择'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="retouch-film-scene-upload"
                        onClick={() => filmSceneInputRef.current?.click()}
                      >
                        <PhotoIcon className="h-4 w-4" />
                        <span>
                          <strong>上传名场面参考</strong>
                          <small>影视截图 / 剧照 / 自定义动作参考</small>
                        </span>
                      </button>
                      <div className="retouch-film-scene-grid" aria-label="影视作品名场面素材">
                        {filmSceneOptions.map((scene) => {
                          const isSelected = selectedFilmSceneId === scene.id
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              className={`retouch-film-scene-card ${scene.source === 'custom' ? 'is-custom' : ''} ${isSelected ? 'is-active' : ''}`}
                              onClick={() => void applyFilmScene(scene)}
                              aria-pressed={isSelected}
                            >
                              <img src={scene.src} alt={scene.label} />
                              <span>
                                <strong>{scene.label}</strong>
                                <small>{isSelected ? '已选' : scene.source === 'custom' ? '自定义参考' : '点击仿拍'}</small>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <input
                        ref={filmSceneInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = event.target.files
                          if (files) void handleFilmSceneFiles(files)
                          event.target.value = ''
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="retouch-group-tabs" aria-label="小功能分组">
                        {groupedCategoryTemplates.map((group) => {
                          const groupSelectedCount = getGroupSelectionCount(group.templates)
                          return (
                            <button
                              key={group.group}
                              type="button"
                              className={activeGroupName === group.group ? 'is-active' : ''}
                              onClick={() => setSelectedGroupName(group.group)}
                            >
                              <span>{group.group}</span>
                              {groupSelectedCount > 0 && <strong>{groupSelectedCount}</strong>}
                            </button>
                          )
                        })}
                      </div>
                      <div className="retouch-template-group">
                        <div className="retouch-template-group-title">{activeGroupName}</div>
                        <div className="retouch-template-chip-grid">
                          {activeGroupTemplates.map((template) => {
                            const isSelected = selectedTemplateIds.includes(template.id)
                            return (
                              <button
                                key={template.id}
                                type="button"
                                className={`retouch-template-card ${isSelected ? 'is-active' : ''}`}
                                onClick={() => toggleTemplate(template)}
                                title={template.scenario}
                                aria-pressed={isSelected}
                              >
                                <span className="retouch-template-card-title">
                                  <strong>{template.title}</strong>
                                  {isSelected && <span className="retouch-selected-mark">已选</span>}
                                </span>
                                <small>{template.scenario}</small>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="retouch-section-heading">
                  <span>执行设置</span>
                  <strong>{selectedCategoryId === 'graduateScene' ? selectedGraduateBackground.label : `${selectedStrength.label} · ${selectedTarget.label}`}</strong>
                </div>
                {selectedCategoryId === 'graduateScene' ? (
                  <div className="retouch-option-panel retouch-graduate-background-panel">
                    <div className="retouch-option-row">
                      <span>背景</span>
                      <div>
                        {graduateBackgroundOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={selectedGraduateBackgroundId === option.id ? 'is-active' : ''}
                            onClick={() => applyGraduateBackground(option.id)}
                          >
                            <strong>{option.label}</strong>
                            <small>{option.id === 'uploaded' && uploadedBackgroundImage ? '已上传' : option.hint}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                    {selectedGraduateBackgroundId === 'uploaded' && (
                      <button
                        type="button"
                        className="retouch-background-upload"
                        onClick={() => backgroundInputRef.current?.click()}
                      >
                        <PhotoIcon className="h-4 w-4" />
                        <span>
                          <strong>{uploadedBackgroundImage ? '更换新背景' : '上传新背景'}</strong>
                          <small>{uploadedBackgroundImage ? '已作为第三张参考图' : '校园 / 室内 / 城市 / 场景参考'}</small>
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="retouch-option-panel">
                    <div className="retouch-option-row">
                      <span>强度</span>
                      <div>
                        {strengthOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={selectedStrengthId === option.id ? 'is-active' : ''}
                            onClick={() => applyStrength(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="retouch-option-row">
                      <span>对象</span>
                      <div>
                        {targetOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={selectedTargetId === option.id ? 'is-active' : ''}
                            onClick={() => applyTarget(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>

          <main className="retouch-preview-panel">
            <div className="retouch-preview-toolbar">
              <div>
                <span>画面预览</span>
                <strong>{previewTitle}</strong>
              </div>
              <div className="retouch-preview-actions">
                <div className="retouch-zoom-control" aria-label="预览缩放">
                  <button
                    type="button"
                    className={Math.abs(previewZoom - 1) < 0.01 ? 'is-active' : ''}
                    onClick={() => applyPreviewZoom(1)}
                    disabled={!canUsePreviewZoom}
                  >
                    适应
                  </button>
                  <input
                    type="range"
                    min={previewZoomMin}
                    max={previewZoomMax}
                    step={0.01}
                    value={previewZoom}
                    onChange={(event) => applyPreviewZoom(Number(event.target.value))}
                    disabled={!canUsePreviewZoom}
                    aria-label="无级缩放"
                  />
                  <span>{previewZoom > 1 ? `${Math.round(previewZoom * 100)}%` : '100%'}</span>
                </div>
                <button
                  type="button"
                  className={`retouch-tool-button ${compareEnabled && canCompare ? 'is-active' : ''}`}
                  onClick={handleCompareToggle}
                >
                  {compareEnabled && canCompare ? '关闭对比' : '前后对比'}
                </button>
                <button type="button" className="retouch-tool-button" onClick={handleMaskEdit}>
                  涂抹遮罩
                </button>
                <button type="button" className="retouch-tool-button" onClick={openVisibleOutput} disabled={!visibleTask?.outputImages.length}>
                  查看大图
                </button>
              </div>
            </div>

            <div
              className={`retouch-preview-frame ${isDraggingUpload ? 'is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDraggingUpload(true)
              }}
              onDragLeave={() => setIsDraggingUpload(false)}
              onDrop={(event) => {
                event.preventDefault()
                setIsDraggingUpload(false)
                void handleFiles(event.dataTransfer.files)
              }}
            >
              <div ref={previewStageRef} className={`retouch-preview-stage ${compareEnabled && canCompare ? 'is-comparing' : ''}`}>
                {compareEnabled && canCompare && outputImageSrc && beforeImageSrc ? (
                  <div className="retouch-compare-plane">
                    <div className="retouch-image-plane">
                      <div className="retouch-image-fit-box" style={previewImageFitStyle}>
                        <img
                          className="retouch-preview-image"
                          src={outputImageSrc}
                          alt="修图后"
                          style={undefined}
                          onLoad={(event) => {
                            const image = event.currentTarget
                            handlePreviewImageMeasure(image.naturalWidth / Math.max(image.naturalHeight, 1))
                          }}
                        />
                      </div>
                    </div>
                    <div className="retouch-compare-before" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                      <div className="retouch-image-plane">
                        <div className="retouch-image-fit-box" style={previewImageFitStyle}>
                          <img
                            className="retouch-preview-image"
                            src={beforeImageSrc}
                            alt="修图前"
                            style={undefined}
                            onLoad={(event) => {
                              const image = event.currentTarget
                              handlePreviewImageMeasure(image.naturalWidth / Math.max(image.naturalHeight, 1))
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <span className="retouch-compare-label is-before">原图</span>
                    <span className="retouch-compare-label is-after">修图后</span>
                    <button
                      type="button"
                      className="retouch-compare-handle"
                      style={{ left: `${comparePosition}%` }}
                      aria-label="拖动对比线"
                      onPointerDown={handleComparePointerDown}
                      onPointerMove={handleComparePointerMove}
                      onPointerUp={handleComparePointerEnd}
                      onPointerCancel={handleComparePointerEnd}
                    >
                      <span />
                    </button>
                  </div>
                ) : outputImageSrc ? (
                  <div
                    className="retouch-preview-pan-layer"
                    onWheel={handlePreviewWheel}
                    onPointerDown={handlePreviewPanPointerDown}
                    onPointerMove={handlePreviewPanPointerMove}
                    onPointerUp={handlePreviewPanPointerEnd}
                    onPointerCancel={handlePreviewPanPointerEnd}
                  >
                    <RetouchPreviewImage
                      src={outputImageSrc}
                      alt="修图结果"
                      fitStyle={previewImageFitStyle}
                      imageStyle={previewImageTransformStyle}
                      onImageMeasure={handlePreviewImageMeasure}
                    />
                  </div>
                ) : beforeImageSrc ? (
                  <div
                    className="retouch-preview-pan-layer"
                    onWheel={handlePreviewWheel}
                    onPointerDown={handlePreviewPanPointerDown}
                    onPointerMove={handlePreviewPanPointerMove}
                    onPointerUp={handlePreviewPanPointerEnd}
                    onPointerCancel={handlePreviewPanPointerEnd}
                  >
                    <RetouchPreviewImage
                      src={beforeImageSrc}
                      alt="修图预览"
                      fitStyle={previewImageFitStyle}
                      imageStyle={previewImageTransformStyle}
                      onImageMeasure={handlePreviewImageMeasure}
                    />
                  </div>
                ) : (
                  <RetouchPreviewEmpty
                    hasHistorySelection={previewEmptyHasHistorySelection}
                    generationMode={generationMode}
                    onUpload={() => fileInputRef.current?.click()}
                  />
                )}
              </div>
              {currentStatusTask?.status === 'running' && <div className="retouch-running-badge">生成中</div>}
              {visibleTask?.status === 'error' && <div className="retouch-error-badge">生成失败</div>}
              {hasPreviewImage && <div className="retouch-fit-badge">{previewZoom > 1 ? `${Math.round(previewZoom * 100)}%` : '完整显示'}</div>}
              {hasPreviewImage && (
                <button
                  type="button"
                  className="retouch-preview-upload-float"
                  onClick={() => fileInputRef.current?.click()}
                >
                  上传参考图
                </button>
              )}
            </div>
          </main>

          <aside
            className={`retouch-control-panel ${isDraggingUpload ? 'is-dragging' : ''} ${showSettings ? 'is-muted' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDraggingUpload(true)
            }}
            onDragLeave={() => setIsDraggingUpload(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDraggingUpload(false)
              void handleFiles(event.dataTransfer.files)
            }}
          >
            <div className="retouch-section-heading">
              <span>主交互区</span>
              <strong>{isTextToImageMode ? '文生图' : maskDraft ? '遮罩编辑' : params.n > 1 ? `${params.n} 张输出` : '单张输出'}</strong>
            </div>
            <div className="retouch-side-submit">
              <div className="retouch-segment-group retouch-mode-switch" aria-label="生成模式">
                <span>模式</span>
                <button
                  type="button"
                  className={isTextToImageMode ? 'is-active' : ''}
                  onClick={() => switchGenerationMode('text')}
                >
                  <strong>文生图</strong>
                  <small>纯文字</small>
                </button>
                <button
                  type="button"
                  className={isImageEditMode ? 'is-active' : ''}
                  onClick={() => switchGenerationMode('edit')}
                >
                  <strong>图生图</strong>
                  <small>参考图修图</small>
                </button>
              </div>
              <button type="button" className="retouch-upload-button" onClick={() => fileInputRef.current?.click()}>
                <PhotoIcon className="h-4 w-4" />
                <span>{inputImages.length ? `${inputImages.length} 张参考图` : isTextToImageMode ? '上传参考图并修图' : '上传参考图'}</span>
              </button>
              {isTextToImageMode && inputImages.length > 0 && (
                <div className="retouch-mode-note">当前为文生图，提交时不会引用这些参考图。</div>
              )}
              {inputImages.length > 0 && (
                <div className="retouch-thumb-row">
                  {inputImages.slice(0, 5).map((image, index) => (
                    (() => {
                      const isFilmScene = isFilmSceneReferenceImage(image)
                      const isBackground = isGraduateBackgroundReferenceImage(image)
                      const label = isFilmScene ? '名场面' : isBackground ? '背景' : ''
                      const title = isFilmScene
                        ? `${image.meta?.label ?? '名场面素材'}：动作/画风参考`
                        : isBackground
                          ? `${image.meta?.label ?? '新上传背景'}：背景参考`
                          : `毕业照/参考图 ${index + 1}`
                      return (
                        <div
                          key={image.id}
                          className={`retouch-input-thumb ${image.id === maskDraft?.targetImageId ? 'is-mask-target' : ''} ${isFilmScene ? 'is-film-scene' : ''} ${isBackground ? 'is-background' : ''}`}
                          title={title}
                        >
                          <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                          {label && <span className="retouch-input-thumb-label">{label}</span>}
                          <button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => handleRemoveInputImage(index)}>
                            <CloseIcon className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })()
                  ))}
                  {inputImages.length > 5 && <span className="retouch-thumb-more">+{inputImages.length - 5}</span>}
                  <button type="button" className="retouch-clear-images" onClick={handleClearInputImages}>清空</button>
                </div>
              )}
              {maskDraft && (
                <div className="retouch-mask-status">
                  <span>{maskTargetInput ? '已生成局部遮罩' : '遮罩主图缺失'}</span>
                  <strong>{maskTargetInput ? `${referenceImages.length} 张额外参考图` : '请重新涂抹'}</strong>
                  <button type="button" onClick={clearMaskDraft}>移除遮罩</button>
                </div>
              )}
              <button type="button" className="retouch-mask-button" onClick={handleMaskEdit}>
                <EditIcon className="h-4 w-4" />
                <span>{isTextToImageMode ? '文生图无需 mask' : maskDraft ? '继续涂抹遮罩' : '涂抹指定区域生成 mask'}</span>
              </button>
              <label className="retouch-prompt-field">
                <span>{promptFieldLabel}</span>
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    promptManuallyEditedRef.current = true
                    setPrompt(event.target.value)
                  }}
                  placeholder={promptPlaceholder}
                  rows={5}
                />
              </label>
              <div className="retouch-submit-controls">
                <div className="retouch-segment-group" aria-label="输出数量">
                  <span>数量</span>
                  {[1, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={params.n === count ? 'is-active' : ''}
                      onClick={() => setParams({ n: count })}
                    >
                      {count === 1 ? '1 张' : '4 版'}
                    </button>
                  ))}
                </div>

                <div className="retouch-segment-group" aria-label="输出尺寸">
                  <span>尺寸</span>
                  {outputSizeOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.value === 'auto' ? '由模型自动判断输出尺寸' : `${option.label} · ${option.value}`}
                      className={activeOutputSizeId === option.id ? 'is-active' : ''}
                      onClick={() => {
                        setParams({ size: option.value })
                        showToast(
                          option.id === 'auto'
                            ? '输出尺寸已设为自动'
                            : `输出尺寸已设为 ${option.label}（${option.value}）`,
                          'success',
                        )
                      }}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </button>
                  ))}
                </div>

                <div className="retouch-segment-group" aria-label="修图质量">
                  <span>质量</span>
                  {qualityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      title={option.hint}
                      className={params.quality === option.value ? 'is-active' : ''}
                      onClick={() => setParams({ quality: option.value })}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </button>
                  ))}
                </div>

                <div className="retouch-segment-group" aria-label="交付格式">
                  <span>格式</span>
                  {formatOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={params.output_format === option.value ? 'is-active' : ''}
                      onClick={() => setParams({ output_format: option.value })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <button type="button" className="retouch-submit-button" onClick={handleSubmit}>
                  {submitLabel}
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = event.target.files
                if (files) void handleFiles(files)
                event.target.value = ''
              }}
            />
            <input
              ref={backgroundInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const files = event.target.files
                if (files) void handleBackgroundFiles(files)
                event.target.value = ''
              }}
            />
          </aside>

          <aside className="retouch-output-panel">
            <div className="retouch-section-heading">
              <span>{historyTitle}</span>
              <strong>{retouchTasks.length ? `${retouchTasks.length} 条` : '暂无'}</strong>
            </div>
            <div className="retouch-history-list">
              {historyTasks.length ? (
                historyTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`retouch-history-card ${selectedHistoryTaskId === task.id ? 'is-active' : ''}`}
                    onClick={() => {
                      setCompareEnabled(false)
                      setSelectedHistoryTaskId(task.id)
                      showToast(`已切换到 ${new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 的${task.inputImageIds.length ? '修图' : '生成'}记录`, 'success')
                    }}
                  >
                    <HistoryThumb task={task} />
                    <span>
                      <strong>{formatStatus(task.status)} · {task.outputImages.length || task.params.n} 张</strong>
                      <small>{truncateMiddle(task.prompt, 30)}</small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="retouch-empty-history">{isTextToImageMode ? '提交生成后自动记录历史' : '提交修图后自动记录历史'}</div>
              )}
            </div>

            <div className="retouch-section-heading">
              <span>当前指令</span>
              <strong>{params.n > 1 ? `${params.n} 张输出` : '单张输出'}</strong>
            </div>
            <div className="retouch-current-brief">
              <strong>{currentWorkSummary}</strong>
              <p>{prompt || currentPromptFallback}</p>
            </div>

            <div className="retouch-section-heading">
              <span>任务状态</span>
              <strong>{formatStatus(visibleTask?.status)}</strong>
            </div>
            <div className={`retouch-task-summary ${visibleTask?.status ? `is-${visibleTask.status}` : ''}`}>
              <span>{visibleTask ? new Date(visibleTask.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '暂无任务'}</span>
              <strong>{visibleTask?.apiModel || activeProfile.model || '未设置模型'}</strong>
              {visibleTask?.elapsed != null && <small>{formatElapsed(visibleTask.elapsed)}</small>}
              {visibleTask?.error && <p>{visibleTask.error}</p>}
            </div>

            <div className="retouch-result-strip">
              {visibleTask?.outputImages.length ? (
                visibleTask.outputImages.slice(0, 4).map((imageId, index) => (
                  <OutputImage
                    key={imageId}
                    imageId={imageId}
                    imageList={visibleTask.outputImages}
                    label={`输出图 ${index + 1}`}
                  />
                ))
              ) : (
                <div className="retouch-empty-result">
                  <SettingsIcon className="h-4 w-4" />
                  <span>提交后这里显示真实结果</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
