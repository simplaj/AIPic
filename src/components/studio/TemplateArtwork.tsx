import type { RetouchTemplate } from '../../lib/retouchPresets'
import { isUserTemplate, TEMPLATE_COVERS } from '../../lib/userTemplates'

type Artwork = {
  image: string
  eyebrow: string
  headline?: string[]
  position?: string
  filter?: string
  ink?: boolean
}

const categoryLabels: Partial<Record<RetouchTemplate['category'], string>> = {
  aiColor: '色彩匹配', tone: '全局调色', local: '局部调整', portrait: '人像精修',
  image: '图像修复', clothes: '服装整理', postColor: '后期调色', crop: '构图校正',
  body: '身体修饰', slim: '自然塑形', skin: '肤质精修', background: '背景修复',
  global: '全局优化', portraitColor: '人像色彩', aiNative: '智能创作',
}

function artworkFor(template: RetouchTemplate): Artwork {
  if (isUserTemplate(template)) return {
    image: TEMPLATE_COVERS[template.cover].file,
    eyebrow: `我的模板 / ${template.generationMode === 'edit' ? '图生图' : '文生图'}`,
    position: template.cover === 'portrait' ? '50% 32%' : 'center',
    ink: template.cover === 'notes',
  }
  if (template.category === 'ecommerce') {
    return {
      image: 'product-still-life.jpg',
      eyebrow: template.previewStyle === 'lifestyle' ? 'LIFESTYLE / 02' : 'PRODUCT / 01',
      headline: template.previewStyle === 'lifestyle' ? ['日常，', '也值得讲究。'] : ['让好产品', '被看见。'],
      position: template.previewStyle === 'lifestyle' ? '76% center' : '58% center',
      filter: template.previewStyle === 'lifestyle' ? 'saturate(.7) sepia(.12)' : 'saturate(.8)',
    }
  }
  if (template.category === 'xiaohongshu') {
    const isGuide = template.previewStyle === 'editorial'
    return {
      image: isGuide ? 'desk-editorial.jpg' : 'notes-editorial.jpg',
      eyebrow: isGuide ? 'LIFE / ORGANIZED' : 'LIFE / NOTES',
      headline: isGuide ? ['桌面归位', '灵感就位。'] : ['把春天', '写进日常。'],
      position: isGuide ? '62% center' : '42% center',
      ink: !isGuide,
    }
  }
  if (template.composition === 'poster') {
    const quiet = template.id.includes('quiet')
    const echo = template.id.includes('echo')
    return {
      image: 'editorial-landscape.jpg',
      eyebrow: 'PHOTO / EDITORIAL',
      headline: quiet ? ['留一点空白，', '给想象。'] : echo ? ['山的回声，', '在纸上。'] : ['山野来信。'],
      position: quiet ? '25% center' : echo ? '78% center' : 'center',
      filter: quiet ? 'saturate(.45)' : echo ? 'saturate(.65)' : 'saturate(.85)',
    }
  }
  const landscape = ['image', 'crop', 'background', 'global'].includes(template.category)
  return {
    image: landscape ? 'editorial-landscape.jpg' : 'portrait-light.jpg',
    eyebrow: `${categoryLabels[template.category] ?? '照片精修'}${template.group ? ` / ${template.group}` : ''}`,
    position: landscape ? 'center' : '50% 32%',
    filter: template.category === 'tone' ? 'saturate(.6)' : undefined,
  }
}

/** Reference photography illustrates each preset; it is never a generated result. */
export default function TemplateArtwork({ template }: { template: RetouchTemplate }) {
  const art = artworkFor(template)
  return <div className={`template-art studio-artwork${art.ink ? ' studio-artwork--ink' : ''}`} aria-hidden="true">
    <img
      src={`${import.meta.env.BASE_URL}studio/${art.image}`}
      alt=""
      loading="lazy"
      decoding="async"
      style={{ objectPosition: art.position, filter: art.filter }}
    />
    <div className="studio-artwork-heading">
      <span>{art.eyebrow}</span>
      {art.headline && <strong>{art.headline.map((line) => <span key={line}>{line}</span>)}</strong>}
    </div>
    <span className="studio-artwork-caption">摄影示意</span>
  </div>
}
