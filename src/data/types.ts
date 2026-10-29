// 数据层类型。字段定义以 docs/FIELDS.md 为准；这里只写成 TypeScript

export const CURRENT_SCHEMA_VERSION = 3;

export type Observer = 'self' | 'device' | 'others' | 'official'; // device：快捷指令等自动观测

export type Direction = 'outbound' | 'inbound';

/** 核心事件：固定名字，引擎和开放 API 只认这一层 */
export const CORE_EVENTS = [
  'DEPART',
  'GATE_IN',
  'PLATFORM',
  'QUEUE_START',
  'BOARD',
  'SEATED',
  'ALIGHT',
  'GATE_OUT',
  'ARRIVE',
  'CHECK_IN',
] as const;
export type CoreEvent = (typeof CORE_EVENTS)[number];

export type TimePrecision = 'exact' | 'approx' | 'estimated';
export type ReportedSource = 'tap-adjust' | 'note' | 'oral-report' | 'manual-edit' | 'self-check';
export type ServiceStatus = 'normal' | 'disrupted' | 'holiday';
export type CorrectionSource = 'self-report' | 'calendar' | 'delay-certificate';

/** 情境标签：v2 存中文，v3 存 slug */
export const CONTEXT_SLUGS: Record<string, string> = {
  独自: 'alone',
  同行: 'accompanied',
  便利店: 'convenience-store',
  回消息: 'replying-messages',
  满员没上去: 'missed-full-train',
  身体不适: 'unwell',
  忘东西折返: 'returned-for-item',
};

/** 本人观测的一行（v3） */
export type CheckpointEvent = {
  id: string; // `${sessionId}-${写入毫秒}`
  schemaVersion: number; // 本行写入时的版本（读出时升级后的对象仍保留原值）
  observer: Observer;
  sessionId: string;
  direction: Direction;
  event: CoreEvent | string; // 核心事件，或路线配置里的自定义节点 id
  tappedAt: string | null; // 按键时刻；未知为 null
  reportedAt?: string;
  reportedPrecision?: TimePrecision;
  reportedSource?: ReportedSource;
  recordedBy: string | null; // 'self' 或代写的 agent 名；未知为 null
  inferredAt?: string; // 预留
  inferredMethod?: string;
  confidence?: number;
  place?: string;
  placeFree?: string;
  car?: string;
  trainId?: string;
  context?: string[];
  serviceStatus?: ServiceStatus; // 按下时的原值，永不改写
  serviceStatusCorrected?: ServiceStatus;
  correctionSource?: CorrectionSource;
  correctedBy?: string;
  correctedAt?: string;
  note?: string;
  updatedAt: string;
  rev: number;
  // ── 打卡器 v7 草稿字段（docs/FIELDS.md 末尾）。定稿前不升 schemaVersion，临时记录器也这样写 ──
  seat?: SeatOutcome;
  transfer?: boolean;
  placeSource?: PlaceSource;
  placeGuessed?: boolean;
  uiVersion?: string;
  autoTrigger?: string;
  reportedOffsetSec?: number;
  reviewNote?: string; // 如「自查：这几条是一起补按的」
  reviewSource?: ReviewSource;
  reviewedBy?: string; // 'self' 或代记的 agent 名
  reviewedAt?: string;
  contextAdded?: string[]; // 按完之后补的标签；context 只存按下之前点的
};

/** 坐没坐到。midway＝中途坐下（通常先记 none，坐下时再记一行 midway）。临时记录器也用这三个值 */
export type SeatOutcome = 'seated' | 'none' | 'midway';
/** 事后复核的依据：self-check＝一程结束后本人自查；oral-report＝事后问本人、由 agent 代记 */
export type ReviewSource = 'self-check' | 'oral-report';
export type PlaceSource = 'fixed' | 'same-as-prev' | 'history' | 'gps' | 'manual' | 'self-check';

/** 事后可以追加的字段。原值字段一律不在这里，写不进去 */
export const ANNOTATION_FIELDS = [
  'reportedAt',
  'reportedPrecision',
  'reportedSource',
  'inferredAt',
  'inferredMethod',
  'confidence',
  'placeFree',
  'trainId',
  'serviceStatusCorrected',
  'correctionSource',
  'correctedBy',
  'correctedAt',
  'reviewNote',
  'reviewSource',
  'reviewedBy',
  'reviewedAt',
  'contextAdded',
] as const;
export type AnnotationField = (typeof ANNOTATION_FIELDS)[number];
export type Annotation = Partial<Pick<CheckpointEvent, AnnotationField>>;

/** 数据库里存的原始行：任何版本，原样保存 */
export type StoredRow = Record<string, unknown> & { id: string; schemaVersion: number };
