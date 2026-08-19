/**
 * i18n for ai.100ideas.net — bilingual (EN / ZH) UI dictionary + helpers.
 *
 * Design notes
 * ------------
 * - The site is `output: 'static'` with a handful of SSR routes
 *   (`prerender = false`). Every component/layout resolves its own language
 *   from the incoming request via `getLang(Astro)`, so no prop-drilling or
 *   middleware is required and the approach works identically in SSR and
 *   during static prerender (where it falls back to `en`).
 * - Language is chosen by, in priority order:
 *     1. the `site_lang` cookie (set by LanguageSwitcher.astro), then
 *     2. the `Accept-Language` request header (zh → zh, otherwise en).
 * - `useTranslations(lang)` returns a `t(key, vars?)` function used in
 *   templates. Keys missing from a locale fall back to English, then to the
 *   raw key (so a typo never crashes a page).
 */

export const LANGS = ['en', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** Minimal structural type for the bits of `Astro` we read. Keeps this file
 *  dependency-free (no import of the full Astro global). */
type LangSource = {
  cookies: { get(name: string): { value?: string } | undefined };
  request: { headers: { get(name: string): string | null } };
};

/**
 * Resolve the active UI language for a request.
 * Cookie wins; otherwise we sniff Accept-Language for a leading `zh`.
 */
export function getLang(astro: LangSource): Lang {
  const cookie = astro.cookies.get('site_lang')?.value;
  if (cookie === 'zh' || cookie === 'en') return cookie;
  const header = astro.request.headers.get('accept-language') ?? '';
  return /^zh/i.test(header.trim()) ? 'zh' : 'en';
}

/** English is the canonical source of truth; every other locale must mirror
 *  its keys. The `en` shape also drives the `Keys` type for type-safe `t()`. */
const en = {
  // ── Navigation (Header + mobile) ──────────────────────────────────────
  'nav.home': 'Home',
  'nav.allTools': 'All Tools',
  'nav.mcp': 'MCP Servers',
  'nav.alternatives': 'Alternatives',
  'nav.tags': 'Tags',
  'nav.categories': 'Categories',

  // ── Header ────────────────────────────────────────────────────────────
  'header.submitTool': 'Submit Tool',
  'header.brand': '100 Ideas AI',

  // ── Language switcher ─────────────────────────────────────────────────
  'lang.label': 'Language',
  'lang.en': 'EN',
  'lang.zh': '中文',

  // ── Footer ───────────────────────────────────────────────────────────
  'footer.tagline':
    'A curated, open-source directory of AI tools and MCP servers. Find self-hostable alternatives to popular AI products, compare tech stacks and licenses.',
  'footer.tags': 'Tags',
  'footer.privacy': 'Privacy',
  'footer.terms': 'Terms',
  'footer.sitemap': 'Sitemap',
  'footer.github': 'GitHub',
  'footer.rights': 'All rights reserved.',

  // ── Tool cards ────────────────────────────────────────────────────────
  'card.openSource': 'Open source',
  'card.alternativeTo': 'Alternative to',

  // ── Home ─────────────────────────────────────────────────────────────
  'home.heroTitle': 'Open source AI tools & MCP servers',
  'home.heroSubtitle':
    'A curated, open-source directory of AI tools and MCP (Model Context Protocol) servers. Find self-hostable alternatives to popular AI products, compare tech stacks and licenses, and discover the servers that plug into your agent.',
  'home.toolsIndexed': 'tools indexed',
  'home.mcpServers': 'MCP servers',
  'home.categories': 'categories',
  'home.searchPlaceholder': 'Search tools, stacks, alternatives…',
  'home.catAll': 'All',
  'home.noTools':
    'No tools indexed yet. Run the ingestion pipeline to populate the directory.',
  'home.noResults': 'No tools match your search.',

  // ── Tool detail ──────────────────────────────────────────────────────
  'tool.notFound': 'Tool not found',
  'tool.notFoundDesc': 'We couldn’t find a tool at “{slug}”.',
  'tool.browseAll': 'Browse all tools',
  'tool.pros': 'Pros',
  'tool.cons': 'Cons',
  'tool.audience': 'Target audience:',
  'tool.links': 'Links',
  'tool.viewGithub': 'View on GitHub →',
  'tool.website': 'Official website →',
  'tool.category': 'Category:',
  'tool.altTo': 'Open source alternative to',
  'tool.techStack': 'Tech stack',
  'tool.related': 'Related tools',
  'tool.relatedDesc': 'Other open-source tools that share tags with {name}.',

  // ── MCP servers page ──────────────────────────────────────────────────
  'mcp.title': 'Model Context Protocol Servers & Tools',
  'mcp.subtitle':
    'Open-source MCP servers that expose your data, APIs and tools to AI agents.',
  'mcp.empty': 'No MCP servers indexed yet.',

  // ── Alternatives page ────────────────────────────────────────────────
  'alt.title': 'Open Source Alternatives',
  'alt.subtitle':
    'Self-hostable, license-friendly tools that replace commercial AI products.',
  'alt.empty': 'No alternatives indexed yet.',

  // ── Categories page ──────────────────────────────────────────────────
  'cat.title': 'Categories',
  'cat.subtitle': 'Browse the directory by what each tool does.',
  'cat.empty': 'No categories yet.',

  // ── Single category page ─────────────────────────────────────────────
  'catpage.empty': 'No tools in this category yet.',

  // ── Tags index ───────────────────────────────────────────────────────
  'tags.title': 'Browse by tag',
  'tags.subtitle': '{n} tags across the directory.',

  // ── Single tag page ──────────────────────────────────────────────────
  'tag.empty': 'No tools tagged “{label}” yet.',

  // ── Alternative-to page ──────────────────────────────────────────────
  'altto.title': 'Best Open Source Alternatives to {name}',
  'altto.empty': 'No open-source alternatives to {name} indexed yet.',

  // ── Privacy ──────────────────────────────────────────────────────────
  'privacy.title': 'Privacy Policy',
  'privacy.updated': 'Last updated:',
  'privacy.s1h': 'What we collect',
  'privacy.s1b':
    'This directory is a static, read-only catalogue of publicly available open-source projects. We do not require accounts to browse it. Tool metadata (name, description, stars, license, repository links) is sourced from public GitHub data and enrichment providers.',
  'privacy.s2h': 'Submissions',
  'privacy.s2b':
    'If you submit a tool, the URL and optional email you provide are stored so we can review and publish it. We use submitted emails solely for the submission workflow and never sell them.',
  'privacy.s3h': 'Analytics & cookies',
  'privacy.s3b':
    'We may use privacy-respecting, aggregated analytics to understand traffic. We do not use third-party advertising cookies.',
  'privacy.s4h': 'Contact',
  'privacy.s4b':
    'Questions about this policy? Open an issue on our GitHub repository.',

  // ── Terms ─────────────────────────────────────────────────────────────
  'terms.title': 'Terms of Service',
  'terms.updated': 'Last updated:',
  'terms.s1h': 'Use of the directory',
  'terms.s1b':
    '100 Ideas AI is provided "as is" for informational purposes. Listings describe third-party open-source projects; we are not responsible for their content, availability or licensing.',
  'terms.s2h': 'Accuracy',
  'terms.s2b':
    'Metadata is generated automatically and may contain errors. Always verify license and usage terms on the upstream repository before relying on a tool.',
  'terms.s3h': 'Submissions',
  'terms.s3b':
    'By submitting a tool you confirm you have the right to share it and that the information provided is accurate to the best of your knowledge.',
};

const zh: Record<string, string> = {
  'nav.home': '首页',
  'nav.allTools': '全部工具',
  'nav.mcp': 'MCP 服务器',
  'nav.alternatives': '替代方案',
  'nav.tags': '标签',
  'nav.categories': '分类',

  'header.submitTool': '提交工具',
  'header.brand': '100 Ideas AI',

  'lang.label': '语言',
  'lang.en': 'EN',
  'lang.zh': '中文',

  'footer.tagline':
    '一个精心策划的开源 AI 工具与 MCP 服务器目录。寻找可自托管的流行 AI 产品替代品，对比技术栈与许可证，发现可接入你智能体的服务器。',
  'footer.tags': '标签',
  'footer.privacy': '隐私',
  'footer.terms': '条款',
  'footer.sitemap': '站点地图',
  'footer.github': 'GitHub',
  'footer.rights': '版权所有。',

  'card.openSource': '开源',
  'card.alternativeTo': '替代',

  'home.heroTitle': '开源 AI 工具与 MCP 服务器',
  'home.heroSubtitle':
    '一个精心策划的开源 AI 工具与 MCP（模型上下文协议）服务器目录。寻找可自托管的流行 AI 产品替代品，对比技术栈与许可证，发现可接入你智能体的服务器。',
  'home.toolsIndexed': '已收录工具',
  'home.mcpServers': 'MCP 服务器',
  'home.categories': '分类',
  'home.searchPlaceholder': '搜索工具、技术栈、替代方案…',
  'home.catAll': '全部',
  'home.noTools': '尚未收录任何工具。运行数据同步流水线以填充目录。',
  'home.noResults': '没有符合搜索条件的工具。',

  'tool.notFound': '未找到工具',
  'tool.notFoundDesc': '我们未能在“{slug}”找到对应工具。',
  'tool.browseAll': '浏览全部工具',
  'tool.pros': '优点',
  'tool.cons': '缺点',
  'tool.audience': '目标用户：',
  'tool.links': '链接',
  'tool.viewGithub': '在 GitHub 查看 →',
  'tool.website': '官方网站 →',
  'tool.category': '分类：',
  'tool.altTo': '以下产品的开源替代品',
  'tool.techStack': '技术栈',
  'tool.related': '相关工具',
  'tool.relatedDesc': '其他与 {name} 共享标签的开源工具。',

  'mcp.title': 'Model Context Protocol 服务器与工具',
  'mcp.subtitle': '将你的数据、API 与工具开放给 AI 智能体的开源 MCP 服务器。',
  'mcp.empty': '尚未收录任何 MCP 服务器。',

  'alt.title': '开源替代方案',
  'alt.subtitle': '可自托管、许可证友好的工具，用来替代商业 AI 产品。',
  'alt.empty': '尚未收录任何替代方案。',

  'cat.title': '分类',
  'cat.subtitle': '按工具的功能浏览目录。',
  'cat.empty': '暂无分类。',

  'catpage.empty': '该分类下暂无工具。',

  'tags.title': '按标签浏览',
  'tags.subtitle': '全站共 {n} 个标签。',

  'tag.empty': '尚未有工具标记为“{label}”。',

  'altto.title': '最佳 {name} 开源替代品',
  'altto.empty': '尚未收录任何 {name} 的开源替代品。',

  'privacy.title': '隐私政策',
  'privacy.updated': '最后更新：',
  'privacy.s1h': '我们收集的信息',
  'privacy.s1b':
    '本目录是一个静态、只读的公开开源项目目录，浏览无需注册账户。工具元数据（名称、描述、星标、许可证、仓库链接）来自公开 GitHub 数据与富化服务提供方。',
  'privacy.s2h': '提交内容',
  'privacy.s2b':
    '如果你提交一个工具，我们仅会保存你提供的网址与可选邮箱，以便审核与发布。提交邮箱仅用于提交流程，我们绝不会出售。',
  'privacy.s3h': '分析与 Cookie',
  'privacy.s3b':
    '我们可能使用尊重隐私的聚合分析来了解流量情况，不使用任何第三方广告 Cookie。',
  'privacy.s4h': '联系我们',
  'privacy.s4b': '对本政策有疑问？请在我们的 GitHub 仓库提交 issue。',

  'terms.title': '服务条款',
  'terms.updated': '最后更新：',
  'terms.s1h': '目录的使用',
  'terms.s1b':
    '100 Ideas AI 按“现状”提供，仅用于 informational 目的。条目描述的是第三方开源项目，我们对其内容、可用性或许可不承担任何责任。',
  'terms.s2h': '准确性',
  'terms.s2b':
    '元数据由系统自动生成，可能包含错误。在依赖某个工具前，请务必在上游仓库核实其许可证与使用条款。',
  'terms.s3h': '提交内容',
  'terms.s3b':
    '提交工具即表示你确认有权分享该工具，且所提供的信息在您认知范围内是准确的。',
};

const dictionaries = { en, zh } as const;

export type I18nKey = keyof typeof en;

/**
 * Returns a `t(key, vars?)` translator bound to `lang`.
 * Missing keys fall back to English, then to the raw key.
 */
export function useTranslations(lang: Lang) {
  const dict = dictionaries[lang] ?? en;
  return (key: I18nKey, vars?: Record<string, string | number>): string => {
    let str: string = (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}
