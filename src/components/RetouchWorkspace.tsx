import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Switch } from '@cloudflare/kumo/components/switch'
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  ChevronRight,
  Frame,
  Grid2X2,
  History,
  ImagePlus,
  Layers,
  Menu,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
  ScanFace,
  Scissors,
  Focus,
  RotateCcw,
  Heart,
  SquarePen,
  BookOpen,
  Trash2,
} from 'lucide-react'
import { StudioButton, StudioSheet, StudioSelect, StudioTabs } from './studio/StudioPrimitives'
import TemplateArtwork from './studio/TemplateArtwork'
import StudioGuide, { useStudioGuide } from './studio/StudioGuide'
import TemplateEditor from './studio/TemplateEditor'
import { isUserTemplate, useUserTemplates, USER_TEMPLATES_KEY, type UserTemplate } from '../lib/userTemplates'
import { downloadImageIds } from '../lib/downloadImages'
import { DEFAULT_PARAMS } from '../types'
import type { ComponentType, CSSProperties, PointerEvent, SVGProps, WheelEvent as ReactWheelEvent } from 'react'
import { addImageFromFile, ensureImageCached, submitTask, useStore } from '../store'
import type { TaskParams, TaskRecord } from '../types'
import { getActiveApiProfile, validateApiProfile } from '../lib/apiProfiles'
import { supportsExtendedQuality, supportsGptImage26Params } from '../lib/imageModels'
import { calculateImageSize, normalizeImageSize, type SizeTier } from '../lib/size'
import {
  retouchTemplates as builtInRetouchTemplates,
  type RetouchTemplate,
  type RetouchCategoryId,
  type RetouchTemplateId,
  type RetouchStrengthId,
  type RetouchTargetId,
  type RetouchPreviewMode,
  type RetouchOutputSizeId,
  type RetouchGenerationMode,
} from '../lib/retouchPresets'
import SizePickerModal from './SizePickerModal'
import { EditIcon, HistoryIcon, PhotoIcon, RefreshIcon, SettingsIcon, WrenchIcon } from './icons'

type StudioSymbolName = 'sparkles' | 'compare' | 'expand' | 'arrow' | 'collage' | 'panels' | 'minimal'

/** 共享细线图标让工作台工具和预设保持同一视觉语言。 */
function StudioSymbol({ name, ...props }: SVGProps<SVGSVGElement> & { name: StudioSymbolName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {name === 'sparkles' && (
        <>
          <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" />
          <path d="M20 3v4m-2-2h4" />
        </>
      )}
      {name === 'compare' && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M12 4v16M6 15l3-3 3 2m0-2 3-3 3 3" />
        </>
      )}
      {name === 'expand' && (
        <>
          <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />
        </>
      )}
      {name === 'arrow' && <path d="M5 12h14m-6-6 6 6-6 6" />}
      {name === 'collage' && (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="m4 14 4-2 3 2 4-3 5 2M8 9h5m2 8h2" />
        </>
      )}
      {name === 'panels' && (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M4 12h16m-12 5h3m2-2h3M8 7h8" />
        </>
      )}
      {name === 'minimal' && (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <rect x="10" y="8" width="5" height="4" rx=".5" />
          <path d="M10 15h5" />
        </>
      )}
    </svg>
  )
}

/** 为 AI Native 分类提供与预览工具一致的细线图标。 */
function NativeIcon(props: SVGProps<SVGSVGElement>) {
  return <StudioSymbol {...props} name="sparkles" />
}

const previewZoomMin = 1
const previewZoomMax = 4
const outputSizeTiers: SizeTier[] = ['1K', '2K', '4K']
const outputSizeHints: Record<Exclude<RetouchOutputSizeId, 'custom'>, string> = {
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
  { label: '自动', value: 'auto', hint: '模型判断' },
  { label: '快速', value: 'low', hint: '测试构图' },
  { label: '标准', value: 'medium', hint: '客户审片' },
  { label: '精修', value: 'high', hint: '最终交付' },
  { label: '超清', value: 'xhigh', hint: 'GPT Image 2.5+' },
  { label: '最高', value: 'max', hint: 'GPT Image 2.5+' },
]
const complexityOptions: Array<{ label: string; value: TaskParams['complexity']; hint: string }> = [
  { label: '自动', value: 'auto', hint: '不发送' },
  { label: '低', value: 'low', hint: '快速规划' },
  { label: '中', value: 'medium', hint: '平衡' },
  { label: '高', value: 'high', hint: '充分规划' },
]
const formatOptions: Array<{ label: string; value: TaskParams['output_format'] }> = [
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'GIF', value: 'gif' },
  { label: 'SVG', value: 'svg' },
]
const retouchCategories: Array<{
  id: RetouchCategoryId
  title: string
  shortTitle: string
  summary: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}> = [
  {
    id: 'commerce', title: '电商 · 小红书', shortTitle: '商业创作',
    summary: '商品展示、生活广告与小红书海报，一站开始。', icon: ShoppingBag,
  },
  {
    id: 'aiNative',
    title: 'AI Native',
    shortTitle: 'AI Native',
    summary: '让一张照片，拥有更多表达。',
    icon: NativeIcon,
  },
  { id: 'custom', title: '我的模板', shortTitle: '我的模板', summary: '把常用的创作方式，留给下一次灵感。', icon: BookOpen },
  { id: 'aiColor', title: 'AI色彩', shortTitle: '色彩', summary: 'AI追色 / 样片 / 套图', icon: RefreshIcon },
  { id: 'tone', title: '调色', shortTitle: '调色', summary: '白平衡 / 全局 / 黑白场', icon: SettingsIcon },
  { id: 'local', title: '局部', shortTitle: '局部', summary: '面部 / 背景 / 区域色彩', icon: EditIcon },
  { id: 'portrait', title: '人像', shortTitle: '人像', summary: '丰体 / 瘦身 / 皮肤', icon: PhotoIcon },
  { id: 'image', title: '图像', shortTitle: '图像', summary: '消除 / 背景 / 产品', icon: WrenchIcon },
  { id: 'clothes', title: '衣物', shortTitle: '衣物', summary: '褶皱 / 污渍 / 领口', icon: EditIcon },
  { id: 'postColor', title: '后调色', shortTitle: '后期', summary: '质感肌 / 婚纱 / 儿童', icon: HistoryIcon },
  { id: 'crop', title: '裁剪', shortTitle: '裁剪', summary: '旋转 / 透视 / 补边', icon: SettingsIcon },
]

const categoryTemplateAliases: Partial<Record<RetouchCategoryId, RetouchCategoryId[]>> = {
  commerce: ['ecommerce', 'xiaohongshu'],
  portrait: ['portrait', 'body', 'slim', 'skin'],
  image: ['image', 'background'],
  tone: ['tone', 'global'],
  postColor: ['postColor', 'portraitColor'],
}
const ALL_TEMPLATE_GROUPS = '__all__'

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

  return (
    commonOutputRatios
      .map((ratio) => ({
        label: ratio.label,
        delta: Math.abs(aspectRatio - ratio.value) / ratio.value,
      }))
      .sort((a, b) => a.delta - b.delta)[0]?.label ?? '1:1'
  )
}

function getOutputSizePreset(size: string): { id: RetouchOutputSizeId; ratio: string | null } {
  const normalizedSize = normalizeImageSize(size)
  if (normalizedSize === 'auto') return { id: 'auto', ratio: null }

  for (const tier of outputSizeTiers) {
    for (const ratio of commonOutputRatios) {
      if (calculateImageSize(tier, ratio.label) === normalizedSize) return { id: tier, ratio: ratio.label }
    }
  }

  const dimensions = normalizedSize.match(/^(\d+)x(\d+)$/)
  return { id: 'custom', ratio: dimensions ? `${dimensions[1]}:${dimensions[2]}` : null }
}

function buildRetouchPrompt(template: RetouchTemplate, strengthId: RetouchStrengthId, targetId: RetouchTargetId) {
  const strength = strengthOptions.find((option) => option.id === strengthId) ?? strengthOptions[1]
  const target = targetOptions.find((option) => option.id === targetId) ?? targetOptions[0]
  if (template.category === 'ecommerce' || template.category === 'xiaohongshu') return template.prompt
  if (template.composition === 'poster') {
    return `${template.prompt}\n\n执行设置：视觉处理强度为${strength.label}，只作用于新增的排版、图形和材料效果；主体按${target.label}识别，保持原照片的身份、真实细节和内部空间关系。允许按本预设重新安排照片在成品画布中的位置，不擅自改写照片内容。`
  }
  return `${template.prompt}\n\n执行设置：${strength.prompt}${target.prompt} 保持专业修图逻辑：只修改当前功能相关区域，不要改动无关主体、身份、文字、构图和真实光影。`
}

function buildStackedRetouchPrompt(
  templates: RetouchTemplate[],
  strengthId: RetouchStrengthId,
  targetId: RetouchTargetId,
) {
  if (templates.length === 0) return ''
  if (templates.length === 1) return buildRetouchPrompt(templates[0], strengthId, targetId)

  const strength = strengthOptions.find((option) => option.id === strengthId) ?? strengthOptions[1]
  const target = targetOptions.find((option) => option.id === targetId) ?? targetOptions[0]
  const posterTemplate = templates.find((template) => template.composition === 'poster')
  // 先完成选定的修图，再排版，避免“保护原构图”误阻止新纸刊页面的构成。
  const orderedTemplates = posterTemplate
    ? [...templates.filter((template) => template.composition !== 'poster'), posterTemplate]
    : templates
  const steps = orderedTemplates
    .map((template, index) => `${index + 1}. ${template.title}：${template.prompt}`)
    .join('\n')

  if (posterTemplate) {
    return `先在参考图上完成明确选择的修图，再执行最后一项创意版式：\n${steps}\n\n执行设置：${strength.prompt}${target.prompt} 普通修图仅影响已选择功能相关区域；创意版式可以调整主体在新画布中的位置和比例，不能再次修改照片内部的人物身份、主体结构、文字和真实光影。新增设计效果仅作用于预设明确允许的区域。`
  }
  return `对输入图片执行以下专业修图组合，按顺序叠加处理，不互相覆盖：\n${steps}\n\n执行设置：${strength.prompt}${target.prompt} 保持专业修图逻辑：只修改已选择功能相关区域，不要改动无关主体、身份、文字、构图和真实光影。`
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

    setLoadedImage((current) => (current?.imageId === normalizedImageId ? current : null))
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

function OutputImage({ imageId, imageList, label }: { imageId: string; imageList: string[]; label: string }) {
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
    <span className="retouch-history-thumb">{src ? <img src={src} alt="" /> : <PhotoIcon className="h-4 w-4" />}</span>
  )
}

function RetouchPreviewEmpty({ hasHistorySelection, generationMode, onUpload, onDescribe, onBrowse, onExample }: {
  hasHistorySelection: boolean
  generationMode: RetouchGenerationMode
  onUpload: () => void
  onDescribe: () => void
  onBrowse: () => void
  onExample: (id: string) => void
}) {
  return <div className="studio-start">
    <ImagePlus size={28} strokeWidth={1.4} />
    <h1>{hasHistorySelection ? '这条记录没有可预览的图片' : '开始一张新作品'}</h1>
    <p>选个模板快速开始，或直接写下你的想法。</p>
    <div className="studio-start-actions"><StudioButton tone="primary" onClick={onBrowse}><Grid2X2 size={15} />选择模板</StudioButton><StudioButton onClick={generationMode === 'edit' ? onUpload : onDescribe}>{generationMode === 'edit' ? '上传参考图' : '直接创作'}<ArrowRight size={14} /></StudioButton></div>
    <div className="studio-starter-examples">
      <span>从一个完整示例开始</span>
      <div>
        <StudioButton tone="ghost" className="studio-starter-example" onClick={() => onExample('commerce-product-hero')}>
          <img src={`${import.meta.env.BASE_URL}studio/product-still-life.jpg`} alt="" />
          <span><strong>电商主图</strong><small>让产品成为主角</small></span><ArrowUpRight size={14} />
        </StudioButton>
        <StudioButton tone="ghost" className="studio-starter-example" onClick={() => onExample('xiaohongshu-product-cover')}>
          <img src={`${import.meta.env.BASE_URL}studio/notes-editorial.jpg`} alt="" />
          <span><strong>小红书封面</strong><small>把想法写进画面</small></span><ArrowUpRight size={14} />
        </StudioButton>
      </div>
    </div>
  </div>
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

export default function RetouchWorkspace() {
  const userTemplates = useUserTemplates((state) => state.templates)
  const retouchTemplates = useMemo<RetouchTemplate[]>(() => [...builtInRetouchTemplates, ...userTemplates], [userTemplates])
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
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const maskDraft = useStore((s) => s.maskDraft)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const previewStageRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [showOutputDrawer, setShowOutputDrawer] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [templateEditor, setTemplateEditor] = useState<{ template?: UserTemplate } | null>(null)
  const [workspaceView, setWorkspaceView] = useState<'library' | 'canvas'>('canvas')
  const [templateSearch, setTemplateSearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [mobilePanel, setMobilePanel] = useState<'preview' | 'compose'>(() => prompt.trim() ? 'compose' : 'preview')
  const guide = useStudioGuide()
  const settingsOpen = useStore((state) => state.showSettings)
  const outputButtonRef = useRef<HTMLButtonElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const navButtonRef = useRef<HTMLButtonElement>(null)
  const newTemplateButtonRef = useRef<HTMLButtonElement>(null)
  const templateTriggerRef = useRef<HTMLElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [selectedOutputRatio, setSelectedOutputRatio] = useState<{ size: string; ratio: string } | null>(null)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewImageAspect, setPreviewImageAspect] = useState<number | null>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [previewPanDragging, setPreviewPanDragging] = useState(false)
  const previewPanStartRef = useRef({ pointerId: 0, clientX: 0, clientY: 0, x: 0, y: 0 })
  const [isDraggingUpload, setIsDraggingUpload] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<RetouchCategoryId>('commerce')
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<RetouchTemplateId[]>([])
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(ALL_TEMPLATE_GROUPS)
  const [selectedStrengthId, setSelectedStrengthId] = useState<RetouchStrengthId>('standard')
  const [selectedTargetId, setSelectedTargetId] = useState<RetouchTargetId>('auto')
  const [generationMode, setGenerationMode] = useState<RetouchGenerationMode>(() => inputImages.length ? 'edit' : 'text')
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null)
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [comparePosition, setComparePosition] = useState(50)
  const [compareDragging, setCompareDragging] = useState(false)
  const [inputSessionStartedAt, setInputSessionStartedAt] = useState(0)
  const [textSessionStartedAt, setTextSessionStartedAt] = useState(0)
  const inputSignatureRef = useRef<string | null>(null)
  const generatedPromptRef = useRef<string | null>(null)
  const promptManuallyEditedRef = useRef(false)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === USER_TEMPLATES_KEY || event.key === null) useUserTemplates.getState().reload()
    }
    useUserTemplates.getState().reload()
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const apiIssue = validateApiProfile(activeProfile)
  const qualityLocked = activeProfile.provider === 'openai' && activeProfile.codexCli
  const supports26 = supportsGptImage26Params(activeProfile)
  const extendedQuality = supportsExtendedQuality(activeProfile)
  const effectiveQuality = qualityLocked
    ? 'auto'
    : !extendedQuality && (params.quality === 'xhigh' || params.quality === 'max')
      ? 'high'
      : activeProfile.provider === 'fal' && params.quality === 'auto'
        ? 'high'
        : params.quality
  const visibleFormat = supports26
    ? params.output_format === 'svg' && (generationMode === 'edit' || activeProfile.provider === 'fal')
      ? 'png'
      : params.output_format
    : params.output_format === 'svg' || params.output_format === 'gif'
      ? 'png'
      : params.output_format
  const outputSummary = [
    `${Math.max(1, params.n)} 张`,
    params.size === 'auto' ? '自动尺寸' : params.size.replace('x', ' × '),
    qualityOptions.find((option) => option.value === effectiveQuality)?.label ?? effectiveQuality,
    params.complexity !== 'auto' ? `复杂 ${params.complexity}` : null,
    visibleFormat.toUpperCase(),
    visibleFormat === 'gif' ? `${params.frame_count} 帧` : null,
    activeProfile.streamImages ? '流式' : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const setStreamImages = (enabled: boolean) => {
    setSettings({
      profiles: settings.profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, streamImages: enabled } : profile,
      ),
    })
  }
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
    ? (retouchTasks.find(
        (task) => task.createdAt >= inputSessionStartedAt && sameImageIds(task.inputImageIds, currentInputIds),
      ) ?? null)
    : null
  const latestTaskWithOutputForCurrentInput = latestTaskForCurrentInput?.outputImages.length
    ? latestTaskForCurrentInput
    : hasCurrentInput
      ? (retouchTasks.find(
          (task) =>
            task.createdAt >= inputSessionStartedAt &&
            task.outputImages.length > 0 &&
            sameImageIds(task.inputImageIds, currentInputIds),
        ) ?? null)
      : null
  const latestTextTask = isTextToImageMode
    ? (retouchTasks.find((task) => task.createdAt >= textSessionStartedAt && task.inputImageIds.length === 0) ?? null)
    : null
  const latestTextTaskWithOutput = latestTextTask?.outputImages.length
    ? latestTextTask
    : isTextToImageMode
      ? (retouchTasks.find(
          (task) =>
            task.createdAt >= textSessionStartedAt && task.inputImageIds.length === 0 && task.outputImages.length > 0,
        ) ?? null)
      : null
  const selectedHistoryTask = selectedHistoryTaskId
    ? (retouchTasks.find((task) => task.id === selectedHistoryTaskId) ?? null)
    : null
  const previewMode: RetouchPreviewMode = selectedHistoryTask
    ? 'history'
    : isTextToImageMode
      ? latestTextTask || latestTextTaskWithOutput
        ? 'current'
        : 'empty'
      : hasCurrentInput
        ? 'current'
        : 'empty'
  const visibleTask: TaskRecord | null =
    previewMode === 'history'
      ? selectedHistoryTask
      : previewMode === 'current'
        ? isTextToImageMode
          ? (latestTextTaskWithOutput ?? latestTextTask)
          : (latestTaskWithOutputForCurrentInput ?? latestTaskForCurrentInput)
        : null
  const visibleOutputTask: TaskRecord | null = visibleTask?.outputImages.length ? visibleTask : null
  const inputPreview = previewMode === 'current' && isImageEditMode ? (inputImages[0]?.dataUrl ?? null) : null
  const beforeImageId =
    visibleOutputTask?.inputImageIds[0] ?? (previewMode === 'current' && isImageEditMode ? currentInputIds[0] : null)
  const outputImageId = visibleOutputTask?.outputImages[0] ?? null
  const beforeImageSrc = useCachedImageSource(beforeImageId, inputPreview)
  const outputImageSrc = useCachedImageSource(outputImageId)
  const outputSizePreset = useMemo(() => getOutputSizePreset(params.size), [params.size])
  // 保留用户指定的比例，避免档位切换时反复从规整后的像素反推而产生偏移。
  const outputSizeRatio =
    selectedOutputRatio?.size === params.size
      ? selectedOutputRatio.ratio
      : (outputSizePreset.ratio ?? getNearestOutputRatio(previewImageAspect))
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
  const activeOutputSizeId = outputSizePreset.id
  const hasPreviewImage = Boolean(outputImageSrc || beforeImageSrc)
  const canCompare = Boolean(
    visibleOutputTask?.inputImageIds[0] && visibleOutputTask?.outputImages[0] && beforeImageSrc && outputImageSrc,
  )
  const canUsePreviewZoom = hasPreviewImage && !(compareEnabled && canCompare)
  const previewTitle = outputImageSrc
    ? previewMode === 'history'
      ? '历史结果'
      : isTextToImageMode
        ? '生成结果'
        : '修图结果'
    : previewMode === 'history'
      ? '历史原图'
      : previewMode === 'current'
        ? isTextToImageMode
          ? '生成中'
          : '输入参考'
        : '空白画布'
  const previewEmptyHasHistorySelection = previewMode === 'history'
  const currentStatusTask =
    previewMode === 'current' ? (isTextToImageMode ? latestTextTask : latestTaskForCurrentInput) : null
  const selectedTemplates = selectedTemplateIds
    .map((id) => retouchTemplates.find((template) => template.id === id))
    .filter((template): template is RetouchTemplate => Boolean(template))
  const selectedConfigCount = selectedTemplates.length
  const selectedCategory =
    retouchCategories.find((category) => category.id === selectedCategoryId) ?? retouchCategories[0]
  const categoryIds = categoryTemplateAliases[selectedCategoryId] ?? [selectedCategoryId]
  const categoryTemplates = retouchTemplates.filter((template) => categoryIds.includes(template.category))
  const groupedCategoryTemplates = categoryTemplates.reduce<Array<{ group: string; templates: RetouchTemplate[] }>>(
    (groups, template) => {
      const group = template.group ?? selectedCategory.title
      const current = groups.find((item) => item.group === group)
      if (current) {
        current.templates.push(template)
      } else {
        groups.push({ group, templates: [template] })
      }
      return groups
    },
    [],
  )
  const activeGroupName =
    selectedGroupName === ALL_TEMPLATE_GROUPS ? ALL_TEMPLATE_GROUPS : selectedGroupName && groupedCategoryTemplates.some((group) => group.group === selectedGroupName)
      ? selectedGroupName
      : (groupedCategoryTemplates[0]?.group ?? null)
  const activeGroupTemplates =
    activeGroupName === ALL_TEMPLATE_GROUPS ? categoryTemplates : groupedCategoryTemplates.find((group) => group.group === activeGroupName)?.templates ?? []
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
  const activeBaseUrl = activeProfile.baseUrl.trim()
  const requestBaseUrl = activeBaseUrl
    ? `${activeBaseUrl.replace(/\/+$/, '')}${activeBaseUrl.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'}`
    : '未填写 API 地址'
  const previewImageFitStyle = useMemo<CSSProperties | undefined>(() => {
    if (!previewImageAspect || previewImageAspect <= 0 || !previewStageSize.width || !previewStageSize.height)
      return undefined
    const stageAspect = previewStageSize.width / previewStageSize.height
    const fitWidth =
      stageAspect > previewImageAspect ? previewStageSize.height * previewImageAspect : previewStageSize.width
    const fitHeight =
      stageAspect > previewImageAspect ? previewStageSize.height : previewStageSize.width / previewImageAspect

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
      transition: previewPanDragging ? 'none' : undefined,
    }
  }, [previewPan.x, previewPan.y, previewPanDragging, previewZoom])
  const handlePreviewImageMeasure = (aspectRatio: number) => {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return
    setPreviewImageAspect((current) =>
      current != null && Math.abs(current - aspectRatio) < 0.001 ? current : aspectRatio,
    )
  }

  useEffect(() => {
    const node = previewStageRef.current
    if (!node) return

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      const width = Math.max(0, Math.floor(rect.width))
      const height = Math.max(0, Math.floor(rect.height))
      setPreviewStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [workspaceView, mobilePanel])

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
    if (
      groupedCategoryTemplates.length &&
      selectedGroupName !== ALL_TEMPLATE_GROUPS &&
      !groupedCategoryTemplates.some((group) => group.group === selectedGroupName)
    ) {
      setSelectedGroupName(groupedCategoryTemplates[0].group)
    }
  }, [groupedCategoryTemplates, selectedGroupName])

  const handleRemoveInputImage = (index: number) => {
    removeInputImage(index)
  }

  const toggleTemplate = (template: RetouchTemplate) => {
    const isRemoving = selectedTemplateIds.includes(template.id)
    // 一张成品只使用一种纸刊版式；普通修图功能仍可叠加。
    const compatibleTemplateIds =
      template.composition === 'poster'
        ? selectedTemplateIds.filter((id) => retouchTemplates.find((item) => item.id === id)?.composition !== 'poster')
        : selectedTemplateIds
    const nextTemplateIds = isRemoving
      ? selectedTemplateIds.filter((id) => id !== template.id)
      : [...compatibleTemplateIds, template.id]
    const nextTemplates = nextTemplateIds
      .map((id) => retouchTemplates.find((item) => item.id === id))
      .filter((item): item is RetouchTemplate => Boolean(item))

    const navigationCategory = retouchCategories.find((category) =>
      (categoryTemplateAliases[category.id] ?? [category.id]).includes(template.category),
    )
    setSelectedCategoryId(navigationCategory?.id ?? template.category)
    setSelectedGroupName(template.group ?? template.category)
    setSelectedTemplateIds(nextTemplateIds)
    setGeneratedPrompt(buildStackedRetouchPrompt(nextTemplates, selectedStrengthId, selectedTargetId))
    if (!isRemoving && (template.category === 'ecommerce' || template.category === 'xiaohongshu')) {
      setGenerationMode(inputImages.length ? 'edit' : 'text')
    }
    if (nextTemplates.length) setParams(mergeTemplateParams(nextTemplates))
    if (!isRemoving) {
      if (template.category !== 'ecommerce' && template.category !== 'xiaohongshu') setGenerationMode('edit')
      setWorkspaceView('canvas')
      setMobilePanel('compose')
      if (guide.step !== null && guide.step <= 1) guide.go(2)
      requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }))
    }
    showToast(
      isRemoving
        ? `已移除「${template.title}」`
        : template.composition === 'poster'
          ? `已选用「${template.title}」版式`
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
    showToast(`强度已设为「${strengthOptions.find((option) => option.id === strengthId)?.label ?? '标准'}」`, 'success')
  }

  const applyTarget = (targetId: RetouchTargetId) => {
    setSelectedTargetId(targetId)
    if (selectedTemplates.length) {
      const nextPrompt = buildStackedRetouchPrompt(selectedTemplates, selectedStrengthId, targetId)
      if (canReplaceWithGeneratedPrompt(nextPrompt)) setGeneratedPrompt(nextPrompt)
    }
    showToast(`对象已设为「${targetOptions.find((option) => option.id === targetId)?.label ?? '自动'}」`, 'success')
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
    if (
      previewPanStartRef.current.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
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
        setWorkspaceView('canvas')
        setMobilePanel('preview')
        setSelectedHistoryTaskId(null)
        setCompareEnabled(false)
        showToast(`已添加 ${count} 张参考图，已切换为图生图修图`, 'success')
      }
    } catch (error) {
      showToast(`上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const handleSubmit = async () => {
    if (apiIssue) {
      showToast(`请先配置 API：${apiIssue}`, 'error')
      setShowSettings(true, 'api')
      return
    }
    if (isImageEditMode && inputImages.length === 0) {
      showToast('图生图修图需要先上传参考图，或切换到文生图', 'info')
      return
    }
    setSelectedHistoryTaskId(null)
    setCompareEnabled(false)
    setWorkspaceView('canvas')
    setMobilePanel('preview')
    if (guide.step !== null) guide.finish(true)
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
  const submitLabel = apiIssue ? '连接 API' : isTextToImageMode ? '生成图像' : maskDraft ? '开始局部修图' : '开始修图'

  const isCreativeCategory = ['commerce', 'custom', 'aiNative', 'ecommerce', 'xiaohongshu'].includes(selectedCategoryId)
  const filteredTemplates = (templateSearch.trim() ? categoryTemplates : activeGroupTemplates).filter((template) =>
    `${template.title} ${template.scenario} ${template.group}`
      .toLowerCase()
      .includes(templateSearch.toLowerCase().trim()),
  )
  const selectCategory = (id: RetouchCategoryId) => {
    setSelectedCategoryId(id)
    setTemplateSearch('')
    const ids = categoryTemplateAliases[id] ?? [id]
    setSelectedGroupName(id === 'commerce' ? ALL_TEMPLATE_GROUPS : retouchTemplates.find((template) => ids.includes(template.category))?.group ?? null)
    setWorkspaceView('library')
    if (guide.step === 0) guide.go(1)
    setShowMobileNav(false)
  }
  const applyExample = (template: RetouchTemplate) => {
    if (!template.examplePrompt) return
    setSelectedCategoryId(['ecommerce', 'xiaohongshu'].includes(template.category) ? 'commerce' : template.category)
    setSelectedGroupName(template.group ?? null)
    setSelectedTemplateIds([template.id])
    setGeneratedPrompt(template.examplePrompt)
    setParams(template.params)
    setGenerationMode('text')
    setSelectedHistoryTaskId(null)
    setWorkspaceView('canvas')
    setMobilePanel('compose')
    if (guide.step !== null && guide.step <= 1) guide.go(2)
    showToast(`已填入「${template.exampleTitle ?? template.title}」，可以修改后生成`, 'success')
    requestAnimationFrame(() => promptRef.current?.focus())
  }
  const changeView = (value: string) => {
    setWorkspaceView(value as 'library' | 'canvas')
    if (value === 'library' && guide.step === 0) guide.go(1)
  }
  const chooseTemplate = (template: RetouchTemplate) => {
    if (isUserTemplate(template)) {
      setSelectedTemplateIds([template.id])
      setSelectedCategoryId('custom')
      setGeneratedPrompt(template.prompt)
      if (Object.keys(template.params).length) setParams(template.params)
      setGenerationMode(template.generationMode)
      setSelectedHistoryTaskId(null)
      setWorkspaceView('canvas')
      setMobilePanel('compose')
      requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }))
      showToast(`已应用「${template.title}」`, 'success')
      return
    }
    if (!selectedTemplateIds.includes(template.id)) { toggleTemplate(template); return }
    setWorkspaceView('canvas'); setMobilePanel('compose')
    if (guide.step !== null && guide.step <= 1) guide.go(2)
    requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }))
  }
  const changeOutputDrawer = (open: boolean) => {
    setShowOutputDrawer(open)
    if (!open && guide.step === 3) guide.go(4)
  }
  const guideAction = () => {
    if (guide.step === 0) { selectCategory('commerce'); guide.go(1) }
    else if (guide.step === 1) {
      const example = filteredTemplates[0]
      if (example?.examplePrompt) applyExample(example)
      else if (example) chooseTemplate(example)
    } else if (guide.step === 2) { guide.go(3) }
    else if (guide.step === 3) changeOutputDrawer(true)
    else guide.finish(true)
  }
  const visibleHistory = historyTasks.filter((task) => historyFilter === 'all' || task.status === historyFilter)
  const openTemplateEditor = (trigger: HTMLElement, template?: UserTemplate) => {
    templateTriggerRef.current = trigger
    setTemplateEditor({ template })
  }
  const deleteTemplate = (template: UserTemplate) => setConfirmDialog({
    title: '删除模板', message: `确定删除「${template.title}」吗？已经生成的作品会继续保留。`,
    tone: 'danger', confirmText: '删除模板', action: () => {
      try {
        useUserTemplates.getState().remove(template.id)
        setSelectedTemplateIds((ids) => ids.filter((id) => id !== template.id))
        showToast('模板已删除', 'success')
      } catch (error) { showToast(error instanceof Error ? error.message : '删除失败，请重试。', 'error') }
    },
  })
  const nav = (
    <>
      <button className="studio-brand" onClick={() => selectCategory('aiNative')} aria-label="AIPic 首页">
        <span className="studio-brand-icon">
          <Sparkles size={23} strokeWidth={1.7} />
        </span>
        <span>
          AIPic<small>创意图像工作室</small>
        </span>
      </button>
      <div className="studio-nav-label">创作空间</div>
      <nav className="studio-nav" aria-label="创作工具">
        {retouchCategories.slice(0, 3).map((category) => {
          const Icon = category.icon
          return (
            <button
              key={category.id}
              aria-label={category.title}
              className={selectedCategoryId === category.id ? 'is-active' : ''}
              onClick={() => selectCategory(category.id)}
              aria-current={selectedCategoryId === category.id ? 'page' : undefined}
            >
              <Icon className="studio-nav-icon" aria-hidden="true" />
              <span>{category.title}</span>
              {category.id === 'commerce' ? <span className="studio-nav-new" aria-hidden="true">NEW</span> : category.id === 'custom' ? <span className="studio-nav-count">{userTemplates.length}</span> : <ChevronRight size={14} className="studio-nav-chevron" />}
            </button>
          )
        })}
      </nav>
      <details className="studio-retouch-nav" open={!isCreativeCategory || undefined}>
        <summary>
          <ScanFace size={18} />
          <span>照片精修</span>
          <ChevronDown size={15} />
        </summary>
        <nav aria-label="精修工具">
          {retouchCategories.slice(3).map((category) => (
            <button
              key={category.id}
              className={selectedCategoryId === category.id ? 'is-active' : ''}
              onClick={() => selectCategory(category.id)}
              aria-current={selectedCategoryId === category.id ? 'page' : undefined}
            >
              {category.title}
              <span>
                {
                  retouchTemplates.filter((t) =>
                    (categoryTemplateAliases[category.id] ?? [category.id]).includes(t.category),
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
      </details>
      <div className="studio-nav-divider" />
      <div className="studio-nav-label">我的空间</div>
      <nav className="studio-nav" aria-label="工作区">
        <button
          onClick={() => {
            setShowMobileNav(false)
            setShowHistory(true)
          }}
        >
          <History size={18} />
          <span>创作历史</span>
          <span className="studio-nav-count">{retouchTasks.length}</span>
        </button>
        <button onClick={() => { setShowMobileNav(false); useStore.getState().setAppMode('agent') }}>
          <MessageSquare size={18} />
          <span>AI 助手</span>
          <ArrowUpRight size={14} className="studio-nav-chevron" />
        </button>
      </nav>
      <div className="studio-nav-bottom">
        <div className="studio-local-note">
          <span className="studio-status-dot" />
          作品保存在本机 · v{__APP_VERSION__}
        </div>
        <button
          className="studio-connection"
          onClick={() => {
            setShowMobileNav(false)
            setShowSettings(true, 'api')
          }}
          title={requestBaseUrl}
        >
          <span className="studio-connection-symbol">
            <Settings2 size={18} />
          </span>
          <span>
            <strong>{apiIssue ? '连接你的模型' : activeProfile.name}</strong>
            <small>{apiIssue ? '配置 API 后开始生成' : activeProfile.model}</small>
          </span>
          <ChevronRight size={15} />
        </button>
      </div>
    </>
  )

  return (
    <section data-no-drag-select aria-label="AIPic 图像工作室" className="studio-app">
      <aside className="studio-sidebar">{nav}</aside>
      <div className="studio-main" data-view={workspaceView} data-mobile-panel={mobilePanel}>
        <header className="studio-topbar">
          <StudioButton ref={navButtonRef} tone="ghost" className="studio-mobile-menu" onClick={() => setShowMobileNav(true)} aria-label="打开导航"><Menu size={18} /></StudioButton>
          <strong className="studio-workspace-title">图像工作台</strong>
          <StudioTabs value={workspaceView} onValueChange={changeView} className="studio-workspace-tabs" tabs={[
            { value: 'canvas', label: <span className="studio-tab-label"><Frame size={14} />工作区</span> },
            { value: 'library', label: <span data-guide="templates" className="studio-tab-label"><Grid2X2 size={14} />选择模板</span> },
          ]} />
          <div className="studio-topbar-actions">
            <StudioButton tone="ghost" onClick={() => { setWorkspaceView('canvas'); setShowMobileNav(false); guide.start() }} aria-label="使用指南" title="新手引导"><CircleHelp size={16} /><span className="studio-action-label">使用指南</span></StudioButton>
            <StudioButton ref={historyButtonRef} tone="ghost" onClick={() => setShowHistory(true)} aria-label="打开创作历史"><History size={16} /><span className="studio-action-label">历史</span></StudioButton>
            <StudioButton tone="ghost" onClick={() => setShowSettings(true, 'api')} aria-label="打开 API 设置"><Settings2 size={16} /></StudioButton>
            <button className="studio-version" aria-label={`当前版本 ${__APP_VERSION__}，检查更新`} title={`构建 ${__APP_BUILD_ID__}`} onClick={() => window.dispatchEvent(new Event('aipic:check-version'))}>v{__APP_VERSION__}</button>
          </div>
        </header>
        <div className="studio-body">
          <div className="studio-content">
            <section className="studio-library" data-category={selectedCategoryId} hidden={workspaceView !== 'library'} aria-label="模板库">
              <div className="studio-library-heading">
                <div><h1>{selectedCategory.title}<Badge variant="secondary">{categoryTemplates.length}</Badge></h1><p>点选模板，立即进入工作区编辑</p></div>
                <div className="studio-library-tools"><Input size="sm" aria-label="搜索模板" placeholder="搜索模板" value={templateSearch} onValueChange={setTemplateSearch} />
                  <StudioButton ref={newTemplateButtonRef} tone="primary" onClick={(event) => openTemplateEditor(event.currentTarget)}><Plus size={14} />新建模板</StudioButton>
                  <StudioButton tone="ghost" onClick={() => setWorkspaceView('canvas')}>返回工作区<ArrowRight size={14} /></StudioButton>
                </div>
              </div>
              {groupedCategoryTemplates.length > 1 && (
                <div className="studio-filter-tabs" role="group" aria-label="模板分组">
                  {selectedCategoryId === 'commerce' && <button aria-pressed={activeGroupName === ALL_TEMPLATE_GROUPS} onClick={() => { setSelectedGroupName(ALL_TEMPLATE_GROUPS); setTemplateSearch('') }}>全部</button>}
                  {groupedCategoryTemplates.map((group) => (
                    <button
                      key={group.group}
                      aria-pressed={activeGroupName === group.group}
                      onClick={() => {
                        setSelectedGroupName(group.group)
                        setTemplateSearch('')
                      }}
                    >
                      {group.group}
                    </button>
                  ))}
                </div>
              )}
              <div className={`studio-template-grid ${isCreativeCategory ? '' : 'is-retouch-grid'}`}>
                {filteredTemplates.map((template) => {
                  const selected = selectedTemplateIds.includes(template.id)
                  return (
                    <article data-guide="template-card" key={template.id} aria-labelledby={`template-title-${template.id}`} className={`studio-template ${selected ? 'is-selected' : ''}`}>
                      <button
                        className="studio-template-art-button"
                        aria-label={`选择${template.title}`}
                        aria-pressed={selected}
                        onClick={() => chooseTemplate(template)}
                      >
                        <TemplateArtwork template={template} />
                        {selected && (
                          <span className="studio-template-check">
                            <Check size={15} />
                          </span>
                        )}
                      </button>
                      <div className="studio-template-info">
                        <div>
                          <h2 id={`template-title-${template.id}`}><button title={template.title} onClick={() => chooseTemplate(template)}>{template.title}</button></h2>
                          <span>{template.params.size ? template.params.size.replace('x', ' × ') : '自适应画幅'}</span>
                        </div>
                        <p>{template.scenario}</p>
                        <div className="studio-template-actions">
                          <StudioButton tone="primary" size="sm" onClick={() => chooseTemplate(template)}>使用模板<ArrowRight size={13} /></StudioButton>
                        {template.examplePrompt && (
                          <button className="studio-example-button" onClick={() => applyExample(template)}>
                            <SquarePen size={14} />
                            填入示例
                            <ArrowRight size={14} />
                          </button>
                        )}
                        {isUserTemplate(template) && <div className="studio-template-manage">
                          <button aria-label={`编辑模板：${template.title}`} title="编辑模板" onClick={(event) => openTemplateEditor(event.currentTarget, template)}><SquarePen size={14} /></button>
                          <button aria-label={`删除模板：${template.title}`} title="删除模板" onClick={() => deleteTemplate(template)}><Trash2 size={14} /></button>
                        </div>}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
              {!filteredTemplates.length && (
                <div className="studio-search-empty">
                  <Search size={26} />
                  <strong>{selectedCategoryId === 'custom' && !userTemplates.length ? '你的创作方式，也可以成为模板' : '没有找到这个模板'}</strong>
                  <span>{selectedCategoryId === 'custom' && !userTemplates.length ? '保存常用提示词，下次选中就能开始。' : '试试其他关键词，或清空搜索。'}</span>
                  {selectedCategoryId === 'custom' && !userTemplates.length ? <StudioButton tone="primary" onClick={(event) => openTemplateEditor(event.currentTarget)}>新建第一份模板<Plus size={14} /></StudioButton> : <StudioButton onClick={() => setTemplateSearch('')}>查看全部</StudioButton>}
                </div>
              )}
              <div className="studio-library-footnote">
                <Sparkles size={14} />
                <span>
                  {selectedCategoryId === 'commerce'
                    ? '上传真实商品图，可更好地保留包装、标志与产品细节。'
                    : selectedCategoryId === 'custom'
                      ? '你的模板保存在本机浏览器，可以随时编辑和复用。'
                      : '预设可以自由组合。选中后，在工作区继续完善你的创作要求。'}
                </span>
              </div>
            </section>
            <section className="studio-canvas" hidden={workspaceView !== 'canvas'} aria-label="工作区画布">
              <div className="studio-workflow-line"><span>{selectedTemplates.length ? `已应用：${selectedTemplates.map(t => t.title).join(' + ')}` : '自由创作 · 可选模板，也可直接描述'}</span><StudioButton tone="ghost" onClick={() => changeView('library')}>{selectedTemplates.length ? '更换模板' : '选择模板'}<Grid2X2 size={13} /></StudioButton></div>
              <div className="studio-canvas-toolbar">
                <div className="studio-tool-group">
                  <StudioButton
                    tone="ghost"
                    onClick={() => applyPreviewZoom(Math.max(1, previewZoom - 0.25))}
                    disabled={!canUsePreviewZoom}
                    aria-label="缩小预览"
                  >
                    <Minus size={16} />
                  </StudioButton>
                  <button
                    className="studio-zoom-label"
                    onClick={() => applyPreviewZoom(1)}
                    disabled={!canUsePreviewZoom}
                    title="恢复适应画布"
                  >
                    {Math.round(previewZoom * 100)}%
                  </button>
                  <StudioButton
                    tone="ghost"
                    onClick={() => applyPreviewZoom(Math.min(4, previewZoom + 0.25))}
                    disabled={!canUsePreviewZoom}
                    aria-label="放大预览"
                  >
                    <Plus size={16} />
                  </StudioButton>
                </div>
                <div className="studio-tool-group">
                  <StudioButton
                    tone="ghost"
                    onClick={handleCompareToggle}
                    disabled={!canCompare}
                    aria-pressed={compareEnabled && canCompare}
                  >
                    <Layers size={16} />
                    对比
                  </StudioButton>
                  <StudioButton
                    tone="ghost"
                    onClick={handleMaskEdit}
                    disabled={isTextToImageMode || !inputImages.length}
                  >
                    <Scissors size={16} />
                    局部
                  </StudioButton>
                  <StudioButton
                    tone="ghost"
                    onClick={openVisibleOutput}
                    disabled={!outputImageId}
                    aria-label="全屏预览"
                  >
                    <Focus size={16} />
                  </StudioButton>
                  <StudioButton
                    tone="ghost"
                    disabled={!visibleTask?.outputImages.length}
                    aria-label="下载输出图片"
                    onClick={async () => {
                      if (!visibleTask?.outputImages.length) return
                      const result = await downloadImageIds(visibleTask.outputImages, 'aipic')
                      showToast(
                        result.failCount
                          ? `已下载 ${result.successCount} 张，${result.failCount} 张下载失败`
                          : `已下载 ${result.successCount} 张`,
                        result.failCount ? 'info' : 'success',
                      )
                    }}
                  >
                    <ArrowDownToLine size={16} />
                  </StudioButton>
                </div>
              </div>
              <div
                className={`retouch-preview-frame studio-canvas-frame ${isDraggingUpload ? 'is-dragging' : ''}`}
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
                <div
                  ref={previewStageRef}
                  className={`retouch-preview-stage ${compareEnabled && canCompare ? 'is-comparing' : ''}`}
                >
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
                      <div
                        className="retouch-compare-before"
                        style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}
                      >
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
                        role="slider"
                        aria-label="原图与结果对比位置"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(comparePosition)}
                        aria-valuetext={`原图显示 ${Math.round(comparePosition)}%`}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault()
                            setComparePosition((position) =>
                              Math.min(100, Math.max(0, position + (event.key === 'ArrowRight' ? 5 : -5))),
                            )
                          } else if (event.key === 'Home' || event.key === 'End') {
                            event.preventDefault()
                            setComparePosition(event.key === 'Home' ? 0 : 100)
                          }
                        }}
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
                      style={{ touchAction: previewZoom > 1 ? 'none' : 'pan-y pinch-zoom' }}
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
                      style={{ touchAction: previewZoom > 1 ? 'none' : 'pan-y pinch-zoom' }}
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
                      onDescribe={() => { setMobilePanel('compose'); requestAnimationFrame(() => promptRef.current?.focus()) }}
                    onBrowse={() => changeView('library')}
                    onExample={(id) => { const template = retouchTemplates.find(t => t.id === id); if (template) applyExample(template) }}
                    />
                  )}
                </div>
                {currentStatusTask?.status === 'running' && (
                  <div className="retouch-running-badge" role="status">
                    <span className="retouch-progress-dot" aria-hidden="true" />
                    正在生成
                  </div>
                )}
                {visibleTask?.status === 'error' && (
                  <div className="retouch-error-badge" role="status">
                    生成失败
                  </div>
                )}
                {hasPreviewImage && (
                  <div className="retouch-fit-badge">
                    {previewZoom > 1 ? `${Math.round(previewZoom * 100)}%` : '完整显示'}
                  </div>
                )}
                {hasPreviewImage && (
                  <button
                    type="button"
                    className="retouch-preview-upload-float"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <PhotoIcon className="h-4 w-4" aria-hidden="true" />
                    添加照片
                  </button>
                )}
              </div>
              {visibleTask?.error && (
                <div className="studio-task-error" role="status">
                  <strong>这次生成未完成</strong>
                  <p>{visibleTask.error}</p>
                  <StudioButton tone="ghost" onClick={() => useStore.getState().setDetailTaskId(visibleTask.id)}>
                    查看任务详情
                    <ArrowUpRight size={14} />
                  </StudioButton>
                </div>
              )}
              {!!visibleTask?.outputImages.length && (
                <div className="studio-output-strip">
                  {visibleTask.outputImages.map((id, i) => (
                    <OutputImage key={id} imageId={id} imageList={visibleTask.outputImages} label={`输出图 ${i + 1}`} />
                  ))}
                </div>
              )}
              <div className="studio-canvas-footer">
                <span>
                  {currentStatusTask?.status === 'running'
                    ? '模型正在创作，请稍候'
                    : visibleTask
                      ? `${formatStatus(visibleTask.status)} · ${formatElapsed(visibleTask.elapsed)}`
                      : '上传参考图，或直接描述你的想法'}
                </span>
                <button onClick={() => setWorkspaceView('library')}>
                  返回模板库
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </section>
          </div>
          <aside
            className="studio-composer"
            aria-label="创作面板"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void handleFiles(e.dataTransfer.files)
            }}
          >
            <div className="studio-composer-title">
              <span>
                <WandSparkles size={17} />
                开始创作
              </span>
              <div className="studio-composer-title-actions"><span className="studio-composer-count">{selectedConfigCount ? `${selectedConfigCount} 个预设` : '自由创作'}</span><StudioButton tone="ghost" aria-label="保存为模板" title="将当前提示词和参数保存为模板" onClick={(event) => openTemplateEditor(event.currentTarget)}><SquarePen size={14} /></StudioButton></div>
            </div>
            <StudioTabs className="studio-mode" value={generationMode} onValueChange={(value) => switchGenerationMode(value as RetouchGenerationMode)} tabs={[{ value: 'text', label: '文生图' }, { value: 'edit', label: '图生图' }]} />
            <div className="studio-composer-scroll">
              {!!selectedTemplates.length && (
                <div className="studio-selected-templates">
                  <span>已选模板</span>
                  <div>
                    {selectedTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => toggleTemplate(template)}
                        aria-label={`移除${template.title}`}
                      >
                        {template.title}
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="studio-prompt">
                <span>
                  {promptFieldLabel}
                  <small>描述越具体，画面越贴近</small>
                </span>
                <InputArea
                  data-guide="prompt"
                  aria-label={promptFieldLabel}
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => {
                    promptManuallyEditedRef.current = true
                    setPrompt(e.target.value)
                  }}
                  placeholder={
                    isTextToImageMode
                      ? '想做什么样的画面？\n说说主体、风格、色彩和文字。'
                      : '想修改照片的哪里？\n说说效果，以及需要保留的细节。'
                  }
                  spellCheck={false}
                />
              </label>
              <div className="studio-upload-heading">
                <span>参考素材</span>
                <small>
                  {inputImages.length ? `${inputImages.length} 张` : isTextToImageMode ? '可选' : '需要参考图'}
                </small>
              </div>
              {!!inputImages.length && (
                <div className="studio-input-images">
                  {inputImages.map((image, index) => (
                    <div key={image.id}>
                      <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                      <button onClick={() => handleRemoveInputImage(index)} aria-label={`移除参考图 ${index + 1}`}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="studio-add-reference"
                    aria-label="添加更多参考图"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              )}
              {!inputImages.length && (
                <button className="studio-upload" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus size={23} strokeWidth={1.5} />
                  <strong>添加参考图</strong>
                  <small>点击上传，或将图片拖入这里</small>
                </button>
              )}
              {isTextToImageMode && inputImages.length > 0 && (
                <p className="studio-muted-note">文生图不会携带参考图。需要引用时切换到图生图。</p>
              )}
              {maskDraft && (
                <div className="studio-mask-chip">
                  <Scissors size={14} />
                  <span>局部遮罩已就绪</span>
                  <button onClick={clearMaskDraft} aria-label="移除遮罩">
                    <X size={13} />
                  </button>
                </div>
              )}
              {!isCreativeCategory && (
                <details className="studio-adjustments">
                  <summary>
                    <SlidersHorizontal size={14} />
                    修图调整
                    <ChevronDown size={14} />
                  </summary>
                  <label>
                    处理强度
                    <StudioSelect
                      aria-label="处理强度"
                      value={selectedStrengthId}
                      onValueChange={(value) => applyStrength(value as RetouchStrengthId)}
                    >
                      {strengthOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </StudioSelect>
                  </label>
                  <label>
                    主体类型
                    <StudioSelect
                      aria-label="主体类型"
                      value={selectedTargetId}
                      onValueChange={(value) => applyTarget(value as RetouchTargetId)}
                    >
                      {targetOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </StudioSelect>
                  </label>
                </details>
              )}
            </div>
            <div className="studio-composer-footer">
              <button
                data-guide="output"
                ref={outputButtonRef}
                className="studio-output-settings"
                onClick={() => changeOutputDrawer(true)}
                aria-label="打开输出设置"
                aria-haspopup="dialog"
              >
                <SlidersHorizontal size={16} />
                <span>
                  <strong>输出设置</strong>
                  <small>{outputSummary}</small>
                </span>
                <ChevronRight size={15} />
              </button>
              <StudioButton
                tone="primary"
                data-guide="generate"
                className="studio-generate"
                onClick={handleSubmit}
                disabled={!apiIssue && !prompt.trim()}
              >
                <Sparkles size={17} />
                {submitLabel}
                <ArrowRight size={17} />
              </StudioButton>
              <button className="studio-model-label" onClick={() => setShowSettings(true, 'api')}>
                <span className={`studio-status-dot ${apiIssue ? 'is-unconnected' : ''}`} />
                {activeProfile.model || '选择图像模型'}
                <ChevronDown size={12} />
              </button>
            </div>
          </aside>
        </div>
        {workspaceView === 'canvas' && <div className="studio-mobile-workspace-switch"><StudioTabs value={mobilePanel} onValueChange={(value) => setMobilePanel(value as 'preview' | 'compose')} tabs={[{ value: 'preview', label: '画布预览' }, { value: 'compose', label: '编辑与生成' }]} /></div>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label="上传参考图文件"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <StudioSheet
        open={showMobileNav}
        onOpenChange={setShowMobileNav}
        title="创作导航"
        description="选择一个创作方向"
        side="left"
        returnFocusRef={navButtonRef}
      >
        <div className="studio-mobile-nav-content">{nav}</div>
      </StudioSheet>
      <StudioSheet
        open={showOutputDrawer}
        onOpenChange={changeOutputDrawer}
        title="输出设置"
        description="调整这次创作的画幅与质感"
        returnFocusRef={outputButtonRef}
        footer={
          <>
            <StudioButton tone="ghost" onClick={() => setParams({ ...DEFAULT_PARAMS })}>
              <RotateCcw size={15} />
              恢复默认
            </StudioButton>
            <StudioButton tone="primary" onClick={() => changeOutputDrawer(false)}>
              完成
              <Check size={15} />
            </StudioButton>
          </>
        }
      >
        <div className="studio-settings-section">
          <h3>画幅与数量</h3>
          <label className="studio-field">
            输出数量
            <StudioSelect aria-label="输出数量" value={params.n} onValueChange={(value) => setParams({ n: Number(value) })}>
              {Array.from({ length: activeProfile.provider === 'fal' ? 4 : 10 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} 张
                </option>
              ))}
            </StudioSelect>
          </label>
          <div className="studio-field">
            <span>分辨率</span>
            <div className="studio-size-presets" role="group" aria-label="输出分辨率">
              {outputSizeOptions.map((option) => (
                <button
                  key={option.id}
                  aria-pressed={activeOutputSizeId === option.id}
                  onClick={() => {
                    setSelectedOutputRatio(option.id === 'auto' ? null : { size: option.value, ratio: outputSizeRatio })
                    setParams({ size: option.value })
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="studio-size-custom"
            onClick={() => {
              setShowOutputDrawer(false)
              setShowSizePicker(true)
            }}
          >
            <Frame size={16} />
            <span>比例与自定义尺寸</span>
            <strong>{params.size === 'auto' ? '自动' : params.size.replace('x', ' × ')}</strong>
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="studio-settings-section">
          <h3>画质与格式</h3>
          <div className="studio-field-grid">
            <label className="studio-field">
              画质
              <StudioSelect aria-label="画质"
                value={effectiveQuality}
                disabled={qualityLocked}
                onValueChange={(value) => setParams({ quality: value as TaskParams['quality'] })}
              >
                {qualityOptions
                  .filter(
                    (o) =>
                      !(activeProfile.provider === 'fal' && o.value === 'auto') &&
                      (extendedQuality || !['xhigh', 'max'].includes(o.value)),
                  )
                  .map((o) => (
                    <option value={o.value} key={o.value}>
                      {o.label} · {o.value}
                    </option>
                  ))}
              </StudioSelect>
            </label>
            <label className="studio-field">
              复杂度
              <StudioSelect aria-label="复杂度"
                value={supports26 ? params.complexity : 'auto'}
                disabled={!supports26}
                onValueChange={(value) => setParams({ complexity: value as TaskParams['complexity'] })}
              >
                {complexityOptions.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
                  </option>
                ))}
              </StudioSelect>
            </label>
          </div>
          <label className="studio-field">
            文件格式
            <StudioSelect aria-label="文件格式"
              value={visibleFormat}
              onValueChange={(value) =>
                setParams({
                  output_format: value as TaskParams['output_format'],
                  ...(value === 'jpeg' && params.background === 'transparent'
                    ? { background: 'opaque' as const }
                    : {}),
                })
              }
            >
              {formatOptions.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  disabled={
                    (['gif', 'svg'].includes(o.value) && !supports26) ||
                    (o.value === 'svg' && (isImageEditMode || activeProfile.provider === 'fal'))
                  }
                >
                  {o.label}
                  {o.value === 'svg' ? ' · 矢量' : o.value === 'gif' ? ' · 动图' : ''}
                </option>
              ))}
            </StudioSelect>
          </label>
          {visibleFormat === 'gif' && supports26 && (
            <div className="studio-field-grid">
              <label className="studio-field">
                GIF 帧数
                <input
                  type="number"
                  min={2}
                  max={16}
                  defaultValue={params.frame_count}
                  key={`frames-${params.frame_count}`}
                  onBlur={(e) =>
                    setParams({ frame_count: Math.min(16, Math.max(2, Math.round(Number(e.target.value) || 9))) })
                  }
                />
              </label>
              <label className="studio-field">
                每帧时长（ms）
                <input
                  type="number"
                  min={20}
                  max={2000}
                  defaultValue={params.frame_duration_ms}
                  key={`duration-${params.frame_duration_ms}`}
                  onBlur={(e) =>
                    setParams({
                      frame_duration_ms: Math.min(2000, Math.max(20, Math.round(Number(e.target.value) || 200))),
                    })
                  }
                />
              </label>
            </div>
          )}
          {qualityLocked && <p className="studio-muted-note">当前兼容模式使用自动画质。</p>}
          {!supports26 && <p className="studio-muted-note">复杂度、GIF 和 SVG 需要 GPT Image 2.6 及以上模型。</p>}
          <label className="studio-field">
            背景
            <StudioSelect aria-label="背景"
              value={params.background ?? 'default'}
              disabled={activeProfile.provider === 'fal'}
              onValueChange={(value) =>
                setParams({
                  background: value === 'default' ? undefined : (value as TaskParams['background']),
                })
              }
            >
              <option value="default">服务商默认</option>
              <option value="auto">自动</option>
              <option value="opaque">不透明</option>
              <option value="transparent" disabled={visibleFormat === 'jpeg'}>
                透明
              </option>
            </StudioSelect>
          </label>
        </div>
        <div className="studio-settings-section">
          <div className="studio-switch-field">
            <label htmlFor="studio-stream">
              流式传输<small>默认关闭，可按接口能力手动开启。</small>
            </label>
            <Switch
              size="sm"
              id="studio-stream"
              checked={activeProfile.streamImages === true}
              disabled={activeProfile.provider === 'fal'}
              onCheckedChange={setStreamImages}
              aria-label="流式传输"
            />
          </div>
          <StudioButton
            tone="ghost"
            className="studio-api-settings-link"
            onClick={() => {
              setShowOutputDrawer(false)
              setShowSettings(true, 'api')
            }}
          >
            <Settings2 size={15} />
            接口与更多参数
            <ArrowUpRight size={15} />
          </StudioButton>
        </div>
      </StudioSheet>
      <StudioSheet
        open={showHistory}
        onOpenChange={setShowHistory}
        title="创作历史"
        description={`${historyTasks.length} 次创作，保存在这台设备中`}
        returnFocusRef={historyButtonRef}
      >
        <div className="studio-filter-tabs" role="group" aria-label="筛选历史">
          {[
            { value: 'all', label: '全部' },
            { value: 'done', label: '已完成' },
            { value: 'running', label: '生成中' },
            { value: 'error', label: '失败' },
          ].map((f) => (
            <button key={f.value} aria-pressed={historyFilter === f.value} onClick={() => setHistoryFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="studio-history-list">
          {visibleHistory.map((task) => (
            <article className="studio-history-item" key={task.id}>
              <button
                className="studio-history-open"
                onClick={() => {
                  setSelectedHistoryTaskId(task.id)
                  setCompareEnabled(false)
                  setWorkspaceView('canvas')
                  setShowHistory(false)
                }}
              >
                <HistoryThumb task={task} />
                <span>
                  <strong>{truncateMiddle(task.prompt, 40)}</strong>
                  <small>
                    {new Date(task.createdAt).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                  <span className={`studio-task-badge is-${task.status}`}>
                    {formatStatus(task.status)} · {task.outputImages.length || task.params.n} 张
                  </span>
                </span>
              </button>
              <StudioButton
                tone="ghost"
                aria-label="查看任务详情"
                onClick={() => {
                  setShowHistory(false)
                  useStore.getState().setDetailTaskId(task.id)
                }}
              >
                <ArrowUpRight size={16} />
              </StudioButton>
            </article>
          ))}
        </div>
        {!visibleHistory.length && (
          <div className="studio-search-empty">
            <History size={30} />
            <strong>{historyFilter === 'all' ? '你的作品，从这里积累' : '暂无这类记录'}</strong>
            <span>{historyFilter === 'all' ? '完成第一次生成后，随时回来继续创作。' : '切换筛选，看看其他创作。'}</span>
          </div>
        )}
      </StudioSheet>
      {templateEditor && <TemplateEditor template={templateEditor.template} prompt={prompt} params={params} generationMode={generationMode} returnFocusRef={templateTriggerRef}
        onClose={() => setTemplateEditor(null)} onSave={(draft, id) => {
          useUserTemplates.getState().save(draft, id)
          templateTriggerRef.current = newTemplateButtonRef.current
          setTemplateEditor(null)
          selectCategory('custom')
          showToast(id ? '模板已更新' : '模板已保存，可随时复用', 'success')
        }} />}
      <StudioGuide step={guide.step} paused={showOutputDrawer || showSizePicker || showHistory || showMobileNav || settingsOpen || !!templateEditor} onAction={guideAction} onDismiss={() => guide.finish()} />
      {showSizePicker && (
        <SizePickerModal
          currentSize={params.size}
          onSelect={(size, ratio) => {
            setSelectedOutputRatio(ratio ? { size, ratio } : null)
            setParams({ size })
          }}
          onClose={() => {
            setShowSizePicker(false)
            setShowOutputDrawer(true)
          }}
        />
      )}
    </section>
  )
}
