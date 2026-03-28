// ── MORNING TW — Data Layer ──
export const REGIONS = [
  { id: 'all',  label: '全台灣', icon: '🇹🇼' },
  { id: '北部',  label: '北部',   icon: '🏙️' },
  { id: '中部',  label: '中部',   icon: '🏔️' },
  { id: '南部',  label: '南部',   icon: '☀️' },
  { id: '東部',  label: '東部',   icon: '🌊' },
  { id: '離島',  label: '離島',   icon: '🏝️' },
];

export const CITIES = {
  '北部': ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
  '中部': ['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'],
  '南部': ['嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣'],
  '東部': ['花蓮縣', '台東縣'],
  '離島': ['澎湖縣', '金門縣', '連江縣'],
};

export const TYPES = [
  { id: 'all',     label: '全部',     icon: '🌅' },
  { id: 'egg',     label: '蛋餅燒餅', icon: '🥚' },
  { id: 'rice',    label: '飯糰粥',   icon: '🍚' },
  { id: 'soup',    label: '湯品',     icon: '🍜' },
  { id: 'local',   label: '在地特色', icon: '📍' },
  { id: 'drink',   label: '豆漿飲料', icon: '🫘' },
];

export const TYPE_LABELS = {
  egg:   { label: '蛋餅燒餅', icon: '🥚', cls: 'tag--egg' },
  rice:  { label: '飯糰粥',   icon: '🍚', cls: 'tag--rice' },
  soup:  { label: '湯品',     icon: '🍜', cls: 'tag--soup' },
  local: { label: '在地特色', icon: '📍', cls: 'tag--local' },
  drink: { label: '豆漿飲料', icon: '🫘', cls: 'tag--drink' },
};

export const REGION_HIGHLIGHTS = [
  {
    region: '北部',
    icon: '🏙️',
    name: '北台灣',
    specialty: '豆漿・蛋餅・燒餅油條',
    badge: '選擇最多',
    cities: ['台北', '新北', '基隆', '宜蘭'],
  },
  {
    region: '中部',
    icon: '🏔️',
    name: '中台灣',
    specialty: '肉圓・傳統早餐・市場小吃',
    badge: '古早味天堂',
    cities: ['台中', '彰化', '雲林'],
  },
  {
    region: '南部',
    icon: '☀️',
    name: '南台灣',
    specialty: '牛肉湯・火雞肉飯・虱目魚',
    badge: '最獨特早餐',
    cities: ['嘉義', '台南', '高雄'],
  },
  {
    region: '東部',
    icon: '🌊',
    name: '東台灣',
    specialty: '包子・原住民風味・海鮮',
    badge: '秘境早餐',
    cities: ['花蓮', '台東'],
  },
  {
    region: '離島',
    icon: '🏝️',
    name: '離島',
    specialty: '海鮮粥・廣東粥・虱目魚丸',
    badge: '限定風味',
    cities: ['澎湖', '金門'],
  },
];

export async function loadBreakfasts() {
  const res = await fetch('data/breakfasts.json');
  return res.json();
}
