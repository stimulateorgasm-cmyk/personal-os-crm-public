import React, { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  TrendingUp,
  Users,
  DollarSign,
  UserCheck,
  Percent,
  Plus,
  RefreshCw,
  ExternalLink,
  Send,
  Instagram,
  Eye,
  MousePointer,
  Search,
  ArrowUpDown,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn, formatMoney, formatNumber, getAdStatusStyle } from "@/lib/utils"
import { authFetch, API } from "@/hooks/use-api"

// --- Типы (зеркалят backend-модели) ---
interface AdChannel {
  id: number
  name: string
  category: string
  link: string
  admin_nick: string
  contact: string
  price: number
  comment: string
  status: string
  created_at: string
}

interface AdPurchase {
  id: number
  channel_id: number | null
  channel_name: string
  month: string
  manager: string
  date: string
  platform: string
  price: number
  discount: number
  final_price: number
  growth: number
  coverage: number
  err: number
  cpm: number
  link: string
  status: string
  consultations: number
  clients: number
  sales_sum: number
  roi: number
  created_at: string
  channel_link?: string
}

interface AdPost {
  id: number
  purchase_id: number | null
  channel: string
  link: string
  views: number
  subscribers_gained: number
  clicks: number
  target_action: string
  created_at: string
  last_synced_at: string
}

interface AdOverview {
  totals: { spent: number; growth: number; leads: number; clients: number; sales: number; roi: number }
  by_platform: { platform: string; label: string; spent: number; leads: number; clients: number; sales: number }[]
  top_channels: { name: string; spent: number; sales: number; roi: number }[]
}

interface FunnelStage {
  stage: string
  value: number
}

// --- Справочники (запасные, пока API недоступен) ---
const FALLBACK_CATEGORIES = [
  "Все категории",
  "Секс",
  "ЛОМ",
  "Пикап",
  "Бизнес и мужское",
  "Место",
  "Эзотерика",
  "Сообщества",
  "IT",
  "Психология",
]

const FALLBACK_STATUSES = ["Все статусы", "рассматриваю", "закупил", "опубликовано", "слив", "бартер"]

const FUNNEL_DESC: Record<string, string> = {
  "Показ": "Охват рекламных креативов",
  "Целевое действие": "Переход / просмотр лид-магнита",
  "Обращение": "Заявка / лид в боте или директе",
  "Созвон": "Диагностическая сессия",
  "Оплата": "Успешные клиенты с чеком",
}

const EMPTY_FUNNEL: FunnelStage[] = [
  { stage: "Показ", value: 0 },
  { stage: "Целевое действие", value: 0 },
  { stage: "Обращение", value: 0 },
  { stage: "Созвон", value: 0 },
  { stage: "Оплата", value: 0 },
]

const EMPTY_OVERVIEW: AdOverview = {
  totals: { spent: 0, growth: 0, leads: 0, clients: 0, sales: 0, roi: 0 },
  by_platform: [],
  top_channels: [],
}

// t.me/<username>/<id> → username (для автоподстановки канала из ссылки)
function extractChannelFromLink(link: string): string {
  let s = (link || "").trim().replace(/^https?:\/\//, "")
  if (s.startsWith("t.me/")) s = s.slice(5)
  const parts = s.split("/").filter(Boolean)
  if (!parts.length) return ""
  if (["c", "joinchat", "+", "addstickers"].includes(parts[0])) return ""
  return parts[0]
}

// normalize href: ссылки в БД могут лежать как с https://, так и без
function normalizeHref(s: string): string {
  const t = (s || "").trim()
  if (!t) return ""
  return t.startsWith("http") ? t : `https://${t}`
}

interface PostRow {
  link: string
  channel: string
  target_action: string
}

const emptyPostRow = (): PostRow => ({ link: "", channel: "", target_action: "тест" })

// Инлайн-редактор ссылки канала (клик → ввод → Enter/blur сохраняет)
function ChannelLinkCell({ link, onSave }: { link: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(link)
  const commit = () => {
    setEditing(false)
    const v = val.trim()
    if (v !== (link || "")) onSave(v)
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") { setVal(link); setEditing(false) }
        }}
        placeholder="t.me/..."
        className="w-40 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-400"
      />
    )
  }
  const href = normalizeHref(link)
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:underline inline-flex items-center gap-1 text-xs"
      onDoubleClick={() => { setVal(link); setEditing(true) }}
      title="Клик — открыть, двойной клик — изменить"
    >
      {link} <ExternalLink className="w-3 h-3" />
    </a>
  ) : (
    <button
      onClick={() => { setVal(""); setEditing(true) }}
      className="text-zinc-600 hover:text-zinc-300 text-xs inline-flex items-center gap-1"
      title="Добавить ссылку"
    >
      + ссылка
    </button>
  )
}

export function AdsDashboard() {
  const queryClient = useQueryClient()

  // Tabs State
  const [activeTab, setActiveTab] = useState("overview")

  // Channels filters
  const [selectedCategory, setSelectedCategory] = useState("Все категории")
  const [selectedStatus, setSelectedStatus] = useState("Все статусы")
  const [searchChannel, setSearchChannel] = useState("")
  const [isAddChannelOpen, setIsAddChannelOpen] = useState(false)
  const [newChannel, setNewChannel] = useState({
    name: "",
    category: "Секс",
    link: "",
    admin: "",
    price: "",
    comment: "",
    status: "рассматриваю",
  })

  // Purchases filters
  const [purchaseMonthFilter, setPurchaseMonthFilter] = useState("all")
  const [purchasePlatformFilter, setPurchasePlatformFilter] = useState("all")
  const [isAddPurchaseOpen, setIsAddPurchaseOpen] = useState(false)
  const [newPurchase, setNewPurchase] = useState({
    date: new Date().toISOString().split("T")[0],
    channel: "",
    platform: "telegram",
    price: "",
    coverage: "",
    growth: "",
    link: "",
    status: "оплачено",
  })

  // Сортировка таблиц
  const [channelSort, setChannelSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "name", dir: "asc" })
  const [purchaseSort, setPurchaseSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "date", dir: "desc" })

  // Tracking state
  const [newPostUrl, setNewPostUrl] = useState("")

  // Единая форма «Зафиксировать пост» (Фаза 3e)
  const [isAddPostPackageOpen, setIsAddPostPackageOpen] = useState(false)
  const [postPackageMsg, setPostPackageMsg] = useState("")
  const [newPostPackage, setNewPostPackage] = useState({
    date: new Date().toISOString().split("T")[0],
    price: "",
    discount: "",
    final_price: "",
    status: "опубликовано",
    platform: "telegram",
    comment: "",
    channel_name: "",
    posts: [emptyPostRow()] as PostRow[],
  })

  // --- Загрузка данных ---
  const { data: overviewData } = useQuery<AdOverview>({
    queryKey: ["ads-overview"],
    queryFn: () => authFetch(`${API}/api/ads/overview`).then((r) => r.json()),
  })

  const { data: channelsData } = useQuery<{ channels: AdChannel[] }>({
    queryKey: ["ads-channels"],
    queryFn: () => authFetch(`${API}/api/ads/channels`).then((r) => r.json()),
  })

  const { data: purchasesData } = useQuery<{ purchases: AdPurchase[] }>({
    queryKey: ["ads-purchases"],
    queryFn: () => authFetch(`${API}/api/ads/purchases`).then((r) => r.json()),
  })

  const { data: postsData } = useQuery<{ posts: AdPost[] }>({
    queryKey: ["ads-posts"],
    queryFn: () => authFetch(`${API}/api/ads/posts`).then((r) => r.json()),
  })

  const { data: funnelData } = useQuery<FunnelStage[]>({
    queryKey: ["ads-funnel"],
    queryFn: () => authFetch(`${API}/api/ads/funnel`).then((r) => r.json()),
  })

  const { data: categoriesData } = useQuery<string[]>({
    queryKey: ["ads-categories"],
    queryFn: () => authFetch(`${API}/api/ads/categories`).then((r) => r.json()),
  })

  const { data: statusesData } = useQuery<string[]>({
    queryKey: ["ads-statuses"],
    queryFn: () => authFetch(`${API}/api/ads/statuses`).then((r) => r.json()),
  })

  const overview = overviewData ?? EMPTY_OVERVIEW
  const channels = channelsData?.channels ?? []
  const purchases = purchasesData?.purchases ?? []
  const posts = postsData?.posts ?? []
  const funnel = funnelData?.length ? funnelData : EMPTY_FUNNEL
  const categories = categoriesData?.length ? ["Все категории", ...categoriesData] : FALLBACK_CATEGORIES
  const channelStatuses = statusesData?.length ? ["Все статусы", ...statusesData] : FALLBACK_STATUSES

  // --- Мутации ---
  const addChannel = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      authFetch(`${API}/api/ads/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ads-channels"] })
      queryClient.invalidateQueries({ queryKey: ["ads-overview"] })
      setIsAddChannelOpen(false)
      setNewChannel({ name: "", category: "Секс", link: "", admin: "", price: "", comment: "", status: "рассматриваю" })
    },
  })

  const addPurchase = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      authFetch(`${API}/api/ads/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ads-purchases"] })
      queryClient.invalidateQueries({ queryKey: ["ads-overview"] })
      setIsAddPurchaseOpen(false)
      setNewPurchase({ date: new Date().toISOString().split("T")[0], channel: "", platform: "telegram", price: "", coverage: "", growth: "", link: "", status: "оплачено" })
    },
  })

  const updateChannel = useMutation({
    mutationFn: ({ id, link }: { id: number; link: string }) =>
      authFetch(`${API}/api/ads/channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ads-channels"] })
    },
  })

  const addPostPackage = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      authFetch(`${API}/api/ads/purchase-with-posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    onSuccess: (data: { summary?: { purchases?: number; posts?: number } }) => {
      queryClient.invalidateQueries({ queryKey: ["ads-purchases"] })
      queryClient.invalidateQueries({ queryKey: ["ads-posts"] })
      queryClient.invalidateQueries({ queryKey: ["ads-channels"] })
      queryClient.invalidateQueries({ queryKey: ["ads-overview"] })
      setIsAddPostPackageOpen(false)
      const posts = data?.summary?.posts ?? 0
      setPostPackageMsg(`создано: 1 закупка, ${posts} ${posts === 1 ? "пост" : posts >= 2 && posts <= 4 ? "поста" : "постов"}`)
      setNewPostPackage({
        date: new Date().toISOString().split("T")[0],
        price: "",
        discount: "",
        final_price: "",
        status: "опубликовано",
        platform: "telegram",
        comment: "",
        channel_name: "",
        posts: [emptyPostRow()],
      })
    },
  })

  const addPost = useMutation({
    mutationFn: (url: string) => {
      const channelName = url.split("/")[1] || "custom_post"
      return authFetch(`${API}/api/ads/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelName, link: url, target_action: "тест" }),
      }).then((r) => r.json())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ads-posts"] })
      setNewPostUrl("")
    },
  })

  const refreshPost = useMutation({
    mutationFn: (id: number) =>
      authFetch(`${API}/api/ads/posts/${id}/refresh`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ads-posts"] })
    },
  })

  // Синк живых метрик площадок (подписчики/охваты) по кнопке
  const syncMetrics = useMutation({
    mutationFn: () => authFetch(`${API}/api/ads/sync`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ads-social"] })
      queryClient.invalidateQueries({ queryKey: ["stats-global"] })
    },
  })

  // --- Фильтрация (клиентская) ---
  const filteredChannels = channels.filter((ch) => {
    const matchesCat = selectedCategory === "Все категории" || ch.category === selectedCategory
    const matchesStatus = selectedStatus === "Все статусы" || ch.status === selectedStatus
    const matchesSearch =
      ch.name.toLowerCase().includes(searchChannel.toLowerCase()) ||
      (ch.admin_nick && ch.admin_nick.toLowerCase().includes(searchChannel.toLowerCase()))
    return matchesCat && matchesStatus && matchesSearch
  })

  const filteredPurchases = purchases.filter((p) => {
    const matchesPlatform = purchasePlatformFilter === "all" || p.platform === purchasePlatformFilter
    const matchesMonth =
      purchaseMonthFilter === "all" ||
      (purchaseMonthFilter === "2025-12" && p.date.startsWith("2025-12")) ||
      (purchaseMonthFilter === "2025-11" && p.date.startsWith("2025-11")) ||
      (purchaseMonthFilter === "2024" && p.date.startsWith("2024"))
    return matchesPlatform && matchesMonth
  })

  // --- Сортировка (клиентская) ---
  const toggleSort = (which: "channel" | "purchase", key: string) => {
    const setter = which === "channel" ? setChannelSort : setPurchaseSort
    const cur = which === "channel" ? channelSort : purchaseSort
    setter(cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" })
  }

  // Достаём значение колонки для сравнения (числа — числом, строки — строкой)
  const chanVal = (c: AdChannel, key: string): string | number =>
    key === "price" ? c.price : String((c as any)[key] || "").toLowerCase()
  const purchVal = (p: AdPurchase, key: string): string | number => {
    if (key === "final_price") return p.final_price || p.price
    if (key === "price_sub") return p.growth > 0 ? Math.round((p.final_price || p.price) / p.growth) : 0
    if (["price", "coverage", "err", "cpm", "growth"].includes(key)) return (p as any)[key] || 0
    return String((p as any)[key] || "").toLowerCase()
  }

  const sortedChannels = useMemo(() => {
    return [...filteredChannels].sort((a, b) => {
      const av = chanVal(a, channelSort.key)
      const bv = chanVal(b, channelSort.key)
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
      return channelSort.dir === "asc" ? cmp : -cmp
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredChannels, channelSort])

  const sortedPurchases = useMemo(() => {
    return [...filteredPurchases].sort((a, b) => {
      const av = purchVal(a, purchaseSort.key)
      const bv = purchVal(b, purchaseSort.key)
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
      return purchaseSort.dir === "asc" ? cmp : -cmp
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPurchases, purchaseSort])

  const SortHeader = ({ which, col, label, align }: { which: "channel" | "purchase"; col: string; label: string; align?: "right" }) => {
    const cur = which === "channel" ? channelSort : purchaseSort
    return (
      <TableHead className={cn("cursor-pointer select-none whitespace-nowrap", align === "right" && "text-right")} onClick={() => toggleSort(which, col)}>
        <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
          <span className="text-[10px] uppercase tracking-wider">{label}</span>
          <ArrowUpDown size={10} className={cn("text-zinc-600", cur.key === col && "text-white")} />
        </span>
      </TableHead>
    )
  }

  // --- Производные значения ---
  const leadCost = overview.totals.leads > 0 ? Math.round(overview.totals.spent / overview.totals.leads) : 0
  const clientConversion = overview.totals.leads > 0 ? ((overview.totals.clients / overview.totals.leads) * 100).toFixed(1) : "0.0"
  const roiMultiple = overview.totals.spent > 0 ? (overview.totals.sales / overview.totals.spent).toFixed(1) : "0.0"

  // --- Handlers ---
  const handleAddChannel = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newChannel.name.trim()) return
    addChannel.mutate({
      name: newChannel.name,
      category: newChannel.category,
      link: newChannel.link || `t.me/${newChannel.name.toLowerCase().replace(/\s+/g, "_")}`,
      admin_nick: newChannel.admin || "@admin",
      price: Number(newChannel.price) || 0,
      comment: newChannel.comment,
      status: newChannel.status,
    })
  }

  const handleAddPurchase = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPurchase.channel.trim()) return
    addPurchase.mutate({
      date: newPurchase.date,
      channel_name: newPurchase.channel,
      platform: newPurchase.platform,
      price: Number(newPurchase.price) || 0,
      coverage: Number(newPurchase.coverage) || 0,
      growth: Number(newPurchase.growth) || 0,
      link: newPurchase.link,
      status: newPurchase.status,
    })
  }

  const handleAddTrackedPost = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPostUrl.trim()) return
    addPost.mutate(newPostUrl)
  }

  const handleAddPostPackage = (e: React.FormEvent) => {
    e.preventDefault()
    const posts = newPostPackage.posts.filter((p) => p.link.trim() || p.channel.trim())
    if (!posts.length) return
    addPostPackage.mutate({
      date: newPostPackage.date,
      price: Number(newPostPackage.price) || 0,
      discount: Number(newPostPackage.discount) || 0,
      final_price: Number(newPostPackage.final_price) || 0,
      status: newPostPackage.status,
      platform: newPostPackage.platform,
      comment: newPostPackage.comment,
      channel_name: newPostPackage.channel_name,
      posts: posts.map((p) => ({ link: p.link.trim(), channel: p.channel.trim(), target_action: p.target_action })),
    })
  }

  const updatePostPackageRow = (idx: number, patch: Partial<PostRow>) => {
    setNewPostPackage((prev) => ({
      ...prev,
      posts: prev.posts.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }))
  }

  const removePostPackageRow = (idx: number) => {
    setNewPostPackage((prev) => ({
      ...prev,
      posts: prev.posts.filter((_, i) => i !== idx),
    }))
  }

  const addPostPackageRow = () => {
    setNewPostPackage((prev) => ({ ...prev, posts: [...prev.posts, emptyPostRow()] }))
  }

  const handleRefreshPost = (id: number) => refreshPost.mutate(id)

  const handleSyncMetrics = () => syncMetrics.mutate()

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Реклама</h1>
          <p className="text-sm text-zinc-400">Анализ закупок рекламы в Telegram и Instagram</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncMetrics}
          disabled={syncMetrics.isPending}
          className="shrink-0"
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", syncMetrics.isPending && "animate-spin")} />
          {syncMetrics.isPending ? "Обновление..." : "Обновить метрики"}
        </Button>
      </div>

      {syncMetrics.data && (
        <div className="text-xs text-zinc-400">
          {syncMetrics.data.ok ? (
            <>
              Обновлено метрик: {syncMetrics.data.summary?.total ?? 0} (TG {syncMetrics.data.summary?.telegram ?? 0}, IG {syncMetrics.data.summary?.instagram ?? 0}, YT {syncMetrics.data.summary?.youtube ?? 0})
              {(syncMetrics.data.summary?.errors?.length ?? 0) > 0 && (
                <span className="text-amber-400"> · пропущено с ошибками: {syncMetrics.data.summary.errors.length}</span>
              )}
            </>
          ) : (
            <span className="text-red-400">Ошибка синка метрик</span>
          )}
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">📊 Обзор</TabsTrigger>
          <TabsTrigger value="channels">📋 Каналы</TabsTrigger>
          <TabsTrigger value="purchases">🎯 Закупки</TabsTrigger>
          <TabsTrigger value="tracking">🔗 Отслеживание</TabsTrigger>
          <TabsTrigger value="funnel">📈 Воронка</TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: ОБЗОР ================= */}
        <TabsContent value="overview" className="space-y-6">
          {/* 1. Six Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="p-4 border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Потрачено</span>
                <DollarSign className="w-4 h-4 text-orange-400" />
              </div>
              <div className="text-xl lg:text-2xl font-bold text-white">
                {formatMoney(overview.totals.spent)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Всего бюджет</div>
            </Card>

            <Card className="p-4 border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Прирост</span>
                <Users className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl lg:text-2xl font-bold text-emerald-400">
                +{formatNumber(overview.totals.growth)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Подписчиков</div>
            </Card>

            <Card className="p-4 border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Лиды</span>
                <TrendingUp className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-xl lg:text-2xl font-bold text-white">
                {formatNumber(overview.totals.leads)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">{leadCost} ₽ / лид</div>
            </Card>

            <Card className="p-4 border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Клиенты</span>
                <UserCheck className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl lg:text-2xl font-bold text-white">
                {formatNumber(overview.totals.clients)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Конверсия {clientConversion}%</div>
            </Card>

            <Card className="p-4 border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Продажи</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl lg:text-2xl font-bold text-white">
                {formatMoney(overview.totals.sales)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Выручка с рекламы</div>
            </Card>

            <Card className="p-4 border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Окупаемость</span>
                <Percent className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl lg:text-2xl font-bold text-emerald-400">
                {formatNumber(Math.round(overview.totals.roi))}%
              </div>
              <div className="text-xs text-emerald-500/80 mt-1">ROI (х{roiMultiple})</div>
            </Card>
          </div>

          {/* 2. Platform Comparison + Top Channels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5 border-zinc-800 bg-zinc-900/50">
              <CardHeader className="p-0 pb-4">
                <CardTitle className="text-base font-semibold text-white">Telegram vs Instagram</CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  Сравнение эффективности по источникам рекламы
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 space-y-6">
                {overview.by_platform.length === 0 ? (
                  <div className="text-sm text-zinc-500 py-8 text-center">Нет данных по закупкам</div>
                ) : (
                  overview.by_platform.map((plat) => {
                    const isTg = plat.platform === "telegram"
                    const totalSpent = overview.totals.spent
                    const spentPercent = totalSpent > 0 ? Math.round((plat.spent / totalSpent) * 100) : 0
                    const totalSales = overview.totals.sales
                    const salesPercent = totalSales > 0 ? Math.round((plat.sales / totalSales) * 100) : 0

                    return (
                      <div key={plat.platform} className="space-y-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            {isTg ? (
                              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                                <Send className="w-4 h-4" />
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 border border-pink-500/20">
                                <Instagram className="w-4 h-4" />
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-white text-sm">{plat.label}</div>
                              <div className="text-xs text-zinc-400">
                                {plat.leads} лидов · {plat.clients} клиентов
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-white">{formatMoney(plat.sales)}</div>
                            <div className="text-xs text-zinc-500">продажи</div>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs text-zinc-400">
                            <span>Потрачено: <strong className="text-zinc-200">{formatMoney(plat.spent)}</strong> ({spentPercent}%)</span>
                            <span>Доля продаж: <strong className="text-emerald-400">{salesPercent}%</strong></span>
                          </div>
                          <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", isTg ? "bg-blue-500" : "bg-gradient-to-r from-purple-500 to-pink-500")}
                              style={{ width: `${spentPercent}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            <Card className="p-5 border-zinc-800 bg-zinc-900/50">
              <CardHeader className="p-0 pb-4">
                <CardTitle className="text-base font-semibold text-white">Топ каналов по окупаемости</CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  Лучшие размещения с максимальным показателем ROI
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Канал</TableHead>
                      <TableHead className="text-right">Потрачено</TableHead>
                      <TableHead className="text-right">Продажи</TableHead>
                      <TableHead className="text-right">ROI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.top_channels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-zinc-500">
                          Нет данных по каналам
                        </TableCell>
                      </TableRow>
                    ) : (
                      overview.top_channels.map((ch, idx) => (
                        <TableRow key={ch.name}>
                          <TableCell className="font-medium text-white">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs">
                                {idx + 1}
                              </span>
                              {ch.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-zinc-300">{formatMoney(ch.spent)}</TableCell>
                          <TableCell className="text-right font-medium text-white">{formatMoney(ch.sales)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="success" className="font-bold">
                              +{formatNumber(ch.roi)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================= TAB 2: КАНАЛЫ ================= */}
        <TabsContent value="channels" className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 lg:pb-0 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                    selectedCategory === cat
                      ? "bg-white text-zinc-950 font-semibold"
                      : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white border border-zinc-800"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2.5">
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                <Input
                  placeholder="Поиск канала..."
                  value={searchChannel}
                  onChange={(e) => setSearchChannel(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
              </div>

              <div className="w-40">
                <Select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                >
                  {channelStatuses.map((st) => (
                    <option key={st} value={st} className="bg-zinc-900 text-white">
                      {st}
                    </option>
                  ))}
                </Select>
              </div>

              <Button
                onClick={() => setIsAddChannelOpen(true)}
                className="gap-1.5 whitespace-nowrap h-9 text-xs"
              >
                <Plus className="w-4 h-4" /> Добавить канал
              </Button>
            </div>
          </div>

          <Card className="p-0 border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader which="channel" col="name" label="Название" />
                  <SortHeader which="channel" col="category" label="Категория" />
                  <TableHead>Ссылка</TableHead>
                  <TableHead>Админ</TableHead>
                  <SortHeader which="channel" col="price" label="Цена" align="right" />
                  <SortHeader which="channel" col="status" label="Статус" />
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedChannels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-zinc-500">
                      Каналы не найдены
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedChannels.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-semibold text-white">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChannelLinkCell link={item.link} onSave={(v) => updateChannel.mutate({ id: item.id, link: v })} />
                      </TableCell>
                      <TableCell className="text-zinc-300 text-xs">{item.admin_nick || "—"}</TableCell>
                      <TableCell className="text-right font-medium text-white">
                        {item.price > 0 ? formatMoney(item.price) : <span className="text-zinc-500">0 ₽ (бартер)</span>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium", getAdStatusStyle(item.status))}>
                          {item.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-400 max-w-xs truncate">
                        {item.comment || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Dialog: Добавить канал */}
          <Dialog open={isAddChannelOpen} onOpenChange={setIsAddChannelOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Добавить канал в базу</DialogTitle>
                <DialogDescription>
                  Внесите данные канала или блогера для планирования рекламных интеграций.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddChannel} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Название канала *</label>
                  <Input
                    required
                    placeholder="Например: Секс-афиша Краснодар"
                    value={newChannel.name}
                    onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Категория</label>
                    <Select
                      value={newChannel.category}
                      onChange={(e) => setNewChannel({ ...newChannel, category: e.target.value })}
                    >
                      {categories.filter((c) => c !== "Все категории").map((cat) => (
                        <option key={cat} value={cat} className="bg-zinc-900 text-white">
                          {cat}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Статус</label>
                    <Select
                      value={newChannel.status}
                      onChange={(e) => setNewChannel({ ...newChannel, status: e.target.value })}
                    >
                      {channelStatuses.filter((s) => s !== "Все статусы").map((st) => (
                        <option key={st} value={st} className="bg-zinc-900 text-white">
                          {st}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Ссылка на канал</label>
                    <Input
                      placeholder="t.me/channel_name"
                      value={newChannel.link}
                      onChange={(e) => setNewChannel({ ...newChannel, link: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Админ (никнейм)</label>
                    <Input
                      placeholder="@admin_user"
                      value={newChannel.admin}
                      onChange={(e) => setNewChannel({ ...newChannel, admin: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Стоимость интеграции (₽)</label>
                  <Input
                    type="number"
                    placeholder="Например: 4500"
                    value={newChannel.price}
                    onChange={(e) => setNewChannel({ ...newChannel, price: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Комментарий / Условия</label>
                  <Input
                    placeholder="Посты без удаления, выход в прайм-тайм..."
                    value={newChannel.comment}
                    onChange={(e) => setNewChannel({ ...newChannel, comment: e.target.value })}
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddChannelOpen(false)}>
                    Отмена
                  </Button>
                  <Button type="submit" disabled={addChannel.isPending}>
                    {addChannel.isPending ? "Сохранение..." : "Сохранить канал"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ================= TAB 3: ЗАКУПКИ ================= */}
        <TabsContent value="purchases" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-44">
                <Select
                  value={purchaseMonthFilter}
                  onChange={(e) => setPurchaseMonthFilter(e.target.value)}
                >
                  <option value="all">Все месяцы</option>
                  <option value="2025-12">Декабрь 2025</option>
                  <option value="2025-11">Ноябрь 2025</option>
                  <option value="2024">2024 год</option>
                </Select>
              </div>

              <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800">
                <button
                  onClick={() => setPurchasePlatformFilter("all")}
                  className={cn(
                    "px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer",
                    purchasePlatformFilter === "all" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"
                  )}
                >
                  Все
                </button>
                <button
                  onClick={() => setPurchasePlatformFilter("telegram")}
                  className={cn(
                    "px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer flex items-center gap-1",
                    purchasePlatformFilter === "telegram" ? "bg-blue-600/30 text-blue-300 border border-blue-500/30" : "text-zinc-400 hover:text-white"
                  )}
                >
                  <Send className="w-3 h-3" /> Telegram
                </button>
                <button
                  onClick={() => setPurchasePlatformFilter("instagram")}
                  className={cn(
                    "px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer flex items-center gap-1",
                    purchasePlatformFilter === "instagram" ? "bg-pink-600/30 text-pink-300 border border-pink-500/30" : "text-zinc-400 hover:text-white"
                  )}
                >
                  <Instagram className="w-3 h-3" /> Instagram
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => setIsAddPostPackageOpen(true)} className="gap-1.5 h-9 text-xs bg-emerald-600 hover:bg-emerald-500">
                <Plus className="w-4 h-4" /> Зафиксировать пост
              </Button>
              <Button onClick={() => setIsAddPurchaseOpen(true)} className="gap-1.5 h-9 text-xs">
                <Plus className="w-4 h-4" /> Добавить закупку
              </Button>
            </div>
          </div>

          {postPackageMsg && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-300">
              <span>{postPackageMsg}</span>
              <button
                onClick={() => setPostPackageMsg("")}
                className="text-zinc-500 hover:text-white text-xs shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          <Card className="p-0 border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader which="purchase" col="date" label="Дата" />
                  <SortHeader which="purchase" col="channel_name" label="Канал" />
                  <SortHeader which="purchase" col="platform" label="Платформа" />
                  <SortHeader which="purchase" col="price" label="Цена" align="right" />
                  <SortHeader which="purchase" col="coverage" label="Охват" align="right" />
                  <SortHeader which="purchase" col="err" label="ERR%" align="right" />
                  <SortHeader which="purchase" col="cpm" label="CPM" align="right" />
                  <SortHeader which="purchase" col="growth" label="Прирост" align="right" />
                  <SortHeader which="purchase" col="price_sub" label="Цена / подп." align="right" />
                  <TableHead>Ссылка</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPurchases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-zinc-500">
                      Закупки не найдены
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedPurchases.map((item) => {
                    const pricePerSub = item.growth > 0 ? Math.round((item.final_price || item.price) / item.growth) : 0
                    const itemLink = normalizeHref(item.link || item.channel_link)
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-zinc-400 font-mono text-xs">{item.date}</TableCell>
                        <TableCell className="font-semibold text-white">{item.channel_name}</TableCell>
                        <TableCell>
                          {item.platform === "telegram" ? (
                            <Badge variant="info" className="gap-1 text-xs">
                              <Send className="w-3 h-3" /> TG
                            </Badge>
                          ) : (
                            <Badge variant="purple" className="gap-1 text-xs">
                              <Instagram className="w-3 h-3" /> IG
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium text-white">
                          {formatMoney(item.final_price || item.price)}
                        </TableCell>
                        <TableCell className="text-right text-zinc-300">
                          {item.coverage > 0 ? formatNumber(item.coverage) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-zinc-400">
                          {item.err > 0 ? `${(item.err * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-zinc-400">
                          {item.cpm > 0 ? `${formatNumber(item.cpm)} ₽` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-400">
                          {item.growth > 0 ? `+${item.growth}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-zinc-200">
                          {pricePerSub > 0 ? `${pricePerSub} ₽` : "—"}
                        </TableCell>
                        <TableCell>
                          {itemLink ? (
                            <a href={itemLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1 text-xs">
                              {item.link || item.channel_link} <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-zinc-600 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium", getAdStatusStyle(item.status))}>
                            {item.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Dialog: Добавить закупку */}
          <Dialog open={isAddPurchaseOpen} onOpenChange={setIsAddPurchaseOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Добавить закупку рекламы</DialogTitle>
                <DialogDescription>
                  Зафиксируйте размещение для подсчета стоимости подписчика и окупаемости.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddPurchase} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Дата размещения</label>
                    <Input
                      type="date"
                      required
                      value={newPurchase.date}
                      onChange={(e) => setNewPurchase({ ...newPurchase, date: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Платформа</label>
                    <Select
                      value={newPurchase.platform}
                      onChange={(e) => setNewPurchase({ ...newPurchase, platform: e.target.value })}
                    >
                      <option value="telegram">Telegram</option>
                      <option value="instagram">Instagram</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Канал / Блогер *</label>
                  <Input
                    required
                    placeholder="Название канала"
                    value={newPurchase.channel}
                    onChange={(e) => setNewPurchase({ ...newPurchase, channel: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Ссылка на канал</label>
                  <Input
                    placeholder="t.me/... (пусто — подтянется из базы каналов)"
                    value={newPurchase.link}
                    onChange={(e) => setNewPurchase({ ...newPurchase, link: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Цена (₽) *</label>
                    <Input
                      type="number"
                      required
                      placeholder="5000"
                      value={newPurchase.price}
                      onChange={(e) => setNewPurchase({ ...newPurchase, price: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Охват поста</label>
                    <Input
                      type="number"
                      placeholder="600"
                      value={newPurchase.coverage}
                      onChange={(e) => setNewPurchase({ ...newPurchase, coverage: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Прирост подписчиков</label>
                    <Input
                      type="number"
                      placeholder="70"
                      value={newPurchase.growth}
                      onChange={(e) => setNewPurchase({ ...newPurchase, growth: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Статус оплаты</label>
                    <Select
                      value={newPurchase.status}
                      onChange={(e) => setNewPurchase({ ...newPurchase, status: e.target.value })}
                    >
                      <option value="оплачено">оплачено</option>
                      <option value="забронировано">забронировано</option>
                      <option value="бартер">бартер</option>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddPurchaseOpen(false)}>
                    Отмена
                  </Button>
                  <Button type="submit" disabled={addPurchase.isPending}>
                    {addPurchase.isPending ? "Сохранение..." : "Сохранить закупку"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Dialog: Зафиксировать рекламный пост (Фаза 3e) */}
          <Dialog open={isAddPostPackageOpen} onOpenChange={setIsAddPostPackageOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Зафиксировать рекламный пост</DialogTitle>
                <DialogDescription>
                  Одна форма для закупки и пакета постов. Каналы создаются автоматически из ссылок.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddPostPackage} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Дата *</label>
                    <Input
                      type="date"
                      required
                      value={newPostPackage.date}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, date: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Платформа</label>
                    <Select
                      value={newPostPackage.platform}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, platform: e.target.value })}
                    >
                      <option value="telegram">Telegram</option>
                      <option value="instagram">Instagram</option>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Цена (₽) *</label>
                    <Input
                      type="number"
                      required
                      placeholder="5000"
                      value={newPostPackage.price}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, price: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Скидка (₽)</label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={newPostPackage.discount}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, discount: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Итог (₽)</label>
                    <Input
                      type="number"
                      placeholder="= цена − скидка"
                      value={newPostPackage.final_price}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, final_price: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Статус</label>
                    <Select
                      value={newPostPackage.status}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, status: e.target.value })}
                    >
                      <option value="опубликовано">опубликовано</option>
                      <option value="закупил">закупил</option>
                      <option value="бартер">бартер</option>
                      <option value="слив">слив</option>
                      <option value="рассматриваю">рассматриваю</option>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">Основной канал (необяз.)</label>
                    <Input
                      placeholder="Название канала закупки"
                      value={newPostPackage.channel_name}
                      onChange={(e) => setNewPostPackage({ ...newPostPackage, channel_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Комментарий</label>
                  <Input
                    placeholder="Примечание к закупке"
                    value={newPostPackage.comment}
                    onChange={(e) => setNewPostPackage({ ...newPostPackage, comment: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300">Посты *</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPostPackageRow}
                      className="h-7 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" /> Добавить пост
                    </Button>
                  </div>

                  {newPostPackage.posts.map((row, idx) => (
                    <div key={idx} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-zinc-500">Пост {idx + 1}</span>
                        {newPostPackage.posts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePostPackageRow(idx)}
                            className="text-zinc-500 hover:text-red-400 text-xs"
                          >
                            ✕ Удалить
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-medium text-zinc-400">Ссылка на пост</label>
                          <Input
                            placeholder="https://t.me/channel/123"
                            value={row.link}
                            onChange={(e) => {
                              const link = e.target.value
                              const auto = row.channel.trim() ? row.channel : extractChannelFromLink(link)
                              updatePostPackageRow(idx, { link, channel: auto })
                            }}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-medium text-zinc-400">Канал</label>
                          <Input
                            placeholder="Авто из ссылки"
                            value={row.channel}
                            onChange={(e) => updatePostPackageRow(idx, { channel: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-400">Целевое действие</label>
                        <Select
                          value={row.target_action}
                          onChange={(e) => updatePostPackageRow(idx, { target_action: e.target.value })}
                        >
                          <option value="тест">тест</option>
                          <option value="личка">личка</option>
                          <option value="чат мероприятия">чат мероприятия</option>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddPostPackageOpen(false)}>
                    Отмена
                  </Button>
                  <Button type="submit" disabled={addPostPackage.isPending}>
                    {addPostPackage.isPending ? "Сохранение..." : "Сохранить"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ================= TAB 4: ОТСЛЕЖИВАНИЕ ================= */}
        <TabsContent value="tracking" className="space-y-6">
          <Card className="p-5 border-zinc-800 bg-zinc-900/50">
            <form onSubmit={handleAddTrackedPost} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Input
                  placeholder="Вставить ссылку на рекламный пост (например: t.me/channel/1234)"
                  value={newPostUrl}
                  onChange={(e) => setNewPostUrl(e.target.value)}
                  className="h-10 bg-zinc-950 border-zinc-800"
                />
              </div>
              <Button type="submit" className="h-10 px-6 font-semibold whitespace-nowrap" disabled={addPost.isPending}>
                {addPost.isPending ? "Добавление..." : "Отслеживать"}
              </Button>
            </form>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {posts.length === 0 ? (
              <div className="md:col-span-2 text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-800 rounded-lg">
                Нет отслеживаемых постов. Вставьте ссылку выше, чтобы начать.
              </div>
            ) : (
              posts.map((post) => (
                <Card key={post.id} className="p-5 border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Send className="w-4 h-4 text-blue-400" />
                          <h4 className="font-semibold text-white text-base">@{post.channel}</h4>
                        </div>
                        <a
                          href={`https://${post.link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 mt-1 font-mono"
                        >
                          {post.link} <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <Badge variant="purple" className="text-xs">
                        Цель: {post.target_action || "—"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-950/60 p-3 border border-zinc-800/80">
                      <div>
                        <div className="flex items-center gap-1 text-xs text-zinc-500 mb-0.5">
                          <Eye className="w-3 h-3" /> Просмотры
                        </div>
                        <div className="text-base font-bold text-white">{formatNumber(post.views)}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-xs text-zinc-500 mb-0.5">
                          <Users className="w-3 h-3 text-emerald-400" /> Прирост
                        </div>
                        <div className="text-base font-bold text-emerald-400">+{post.subscribers_gained}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-xs text-zinc-500 mb-0.5">
                          <MousePointer className="w-3 h-3 text-purple-400" /> Переходы
                        </div>
                        <div className="text-base font-bold text-white">{post.clicks}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 mt-4 border-t border-zinc-800/80 text-xs text-zinc-500">
                    <span>Обновлено: {post.last_synced_at || "—"}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRefreshPost(post.id)}
                      disabled={refreshPost.isPending && refreshPost.variables === post.id}
                      className="h-7 text-xs gap-1.5"
                    >
                      <RefreshCw className={cn("w-3 h-3", refreshPost.isPending && refreshPost.variables === post.id && "animate-spin text-blue-400")} />
                      {refreshPost.isPending && refreshPost.variables === post.id ? "Обновление..." : "Обновить"}
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* ================= TAB 5: ВОРОНКА ================= */}
        <TabsContent value="funnel" className="space-y-6">
          <Card className="p-6 border-zinc-800 bg-zinc-900/50">
            <CardHeader className="p-0 pb-6">
              <CardTitle className="text-lg font-semibold text-white">Воронка конверсии из рекламы в продажи</CardTitle>
              <CardDescription className="text-sm text-zinc-400">
                Сквозная аналитика: от показа креатива до подтвержденной оплаты
              </CardDescription>
            </CardHeader>

            <div className="space-y-4">
              {funnel.map((step, idx) => {
                const maxVal = funnel[0]?.value ?? 0
                const widthPercent = maxVal > 0 ? Math.max(12, Math.round((step.value / maxVal) * 100)) : 12
                const prevVal = idx > 0 ? funnel[idx - 1].value : null
                const conversionFromPrev = prevVal ? ((step.value / prevVal) * 100).toFixed(1) : null
                const overallConversion = maxVal > 0 ? ((step.value / maxVal) * 100).toFixed(step.value === maxVal ? 0 : 3) : "0"

                const stageColors = [
                  "from-blue-600 to-blue-500",
                  "from-indigo-600 to-indigo-500",
                  "from-purple-600 to-purple-500",
                  "from-amber-600 to-amber-500",
                  "from-emerald-600 to-emerald-500",
                ]

                return (
                  <div key={step.stage} className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 text-xs font-semibold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-white">{step.stage}</span>
                        <span className="text-xs text-zinc-500 hidden md:inline">({FUNNEL_DESC[step.stage]})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {conversionFromPrev && (
                          <Badge variant="secondary" className="text-xs text-zinc-300 bg-zinc-800">
                            конверсия этапа: <strong className="text-emerald-400 ml-1">{conversionFromPrev}%</strong>
                          </Badge>
                        )}
                        <span className="font-bold text-white text-base">{formatNumber(step.value)}</span>
                      </div>
                    </div>

                    <div className="h-9 w-full bg-zinc-950/80 rounded-lg p-1 border border-zinc-800/80 flex items-center">
                      <div
                        className={cn(
                          "h-full rounded-md bg-gradient-to-r transition-all duration-500 flex items-center px-3 text-xs font-semibold text-white shadow-sm",
                          stageColors[idx % stageColors.length]
                        )}
                        style={{ width: `${widthPercent}%`, minWidth: "120px" }}
                      >
                        <span className="truncate">{overallConversion}% от охвата</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-800/60">
                <div className="text-xs text-zinc-400 mb-1">Охват креативов</div>
                <div className="text-lg font-bold text-white">{formatNumber(funnel[0]?.value ?? 0)}</div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-800/60">
                <div className="text-xs text-zinc-400 mb-1">Итоговых оплат</div>
                <div className="text-lg font-bold text-emerald-400">{formatNumber(funnel[funnel.length - 1]?.value ?? 0)} клиентов</div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-800/60">
                <div className="text-xs text-zinc-400 mb-1">Сквозная конверсия (Показ → Оплата)</div>
                <div className="text-lg font-bold text-emerald-400">
                  {((funnel[0]?.value ?? 0) > 0 ? (((funnel[funnel.length - 1]?.value ?? 0) / (funnel[0]?.value ?? 0)) * 100).toFixed(3) : "0.000")}%
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
