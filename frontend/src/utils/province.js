// Chinese province/region data + strict address → province detection, shared by
// the customer form (auto-fill) and list filter.

export const PROVINCES = [
  'Anhui', 'Beijing', 'Chongqing', 'Fujian', 'Gansu', 'Guangdong', 'Guangxi',
  'Guizhou', 'Hainan', 'Hebei', 'Heilongjiang', 'Henan', 'Hubei', 'Hunan',
  'Inner Mongolia', 'Jiangsu', 'Jiangxi', 'Jilin', 'Liaoning', 'Ningxia',
  'Qinghai', 'Shaanxi', 'Shandong', 'Shanghai', 'Shanxi', 'Sichuan', 'Tianjin',
  'Tibet', 'Xinjiang', 'Yunnan', 'Zhejiang', 'Hong Kong', 'Macau', 'Taiwan',
]

export const PROVINCE_ZH = {
  Anhui: '安徽', Beijing: '北京', Chongqing: '重庆', Fujian: '福建', Gansu: '甘肃',
  Guangdong: '广东', Guangxi: '广西', Guizhou: '贵州', Hainan: '海南', Hebei: '河北',
  Heilongjiang: '黑龙江', Henan: '河南', Hubei: '湖北', Hunan: '湖南',
  'Inner Mongolia': '内蒙古', Jiangsu: '江苏', Jiangxi: '江西', Jilin: '吉林',
  Liaoning: '辽宁', Ningxia: '宁夏', Qinghai: '青海', Shaanxi: '陕西', Shandong: '山东',
  Shanghai: '上海', Shanxi: '山西', Sichuan: '四川', Tianjin: '天津', Tibet: '西藏',
  Xinjiang: '新疆', Yunnan: '云南', Zhejiang: '浙江', 'Hong Kong': '香港',
  Macau: '澳门', Taiwan: '台湾',
}

// Municipalities are named with 市 in Chinese and are common building-name words
// in English, so they need extra care in detection.
const MUNICIPALITIES = new Set(['Beijing', 'Shanghai', 'Tianjin', 'Chongqing'])

// Major cities (not themselves province names) → province.
const CITY_TO_PROVINCE = {
  沈阳: 'Liaoning', Shenyang: 'Liaoning', 大连: 'Liaoning', Dalian: 'Liaoning',
  青岛: 'Shandong', Qingdao: 'Shandong', 济南: 'Shandong', Jinan: 'Shandong',
  烟台: 'Shandong', Yantai: 'Shandong', 日照: 'Shandong', Rizhao: 'Shandong',
  潍坊: 'Shandong', Weifang: 'Shandong',
  苏州: 'Jiangsu', Suzhou: 'Jiangsu', 无锡: 'Jiangsu', Wuxi: 'Jiangsu',
  南京: 'Jiangsu', Nanjing: 'Jiangsu', 徐州: 'Jiangsu', Xuzhou: 'Jiangsu',
  常州: 'Jiangsu', Changzhou: 'Jiangsu',
  宁波: 'Zhejiang', Ningbo: 'Zhejiang', 杭州: 'Zhejiang', Hangzhou: 'Zhejiang',
  深圳: 'Guangdong', Shenzhen: 'Guangdong', 广州: 'Guangdong', Guangzhou: 'Guangdong',
  佛山: 'Guangdong', Foshan: 'Guangdong',
  武汉: 'Hubei', Wuhan: 'Hubei',
  成都: 'Sichuan', Chengdu: 'Sichuan', 德阳: 'Sichuan', Deyang: 'Sichuan',
  都江堰: 'Sichuan', Dujiangyan: 'Sichuan', 宜宾: 'Sichuan', Yibin: 'Sichuan',
  西安: 'Shaanxi', 哈尔滨: 'Heilongjiang', Harbin: 'Heilongjiang',
  长春: 'Jilin', Changchun: 'Jilin', 郑州: 'Henan', Zhengzhou: 'Henan',
  洛阳: 'Henan', Luoyang: 'Henan', 长沙: 'Hunan', Changsha: 'Hunan',
  合肥: 'Anhui', Hefei: 'Anhui', 福州: 'Fujian', Fuzhou: 'Fujian',
  厦门: 'Fujian', Xiamen: 'Fujian', 昆明: 'Yunnan', Kunming: 'Yunnan',
  南昌: 'Jiangxi', Nanchang: 'Jiangxi', 石家庄: 'Hebei', Shijiazhuang: 'Hebei',
  唐山: 'Hebei', Tangshan: 'Hebei', 太原: 'Shanxi', Taiyuan: 'Shanxi',
}

const CN = /[一-龥]/

// Detect the province from an address. Returns an English province name or ''.
// Strategy: collect province "signals" and return the one appearing LAST in the
// address (Chinese/English administrative suffixes usually sit at the end, e.g.
// "…, Chaoyang District, Beijing"), so a building name like "First Shanghai
// Center" earlier in a Beijing address doesn't win.
export function detectProvince(address) {
  const a = String(address || '')
  if (!a.trim()) return ''
  let best = { pos: -1, prov: '' }
  const consider = (idx, prov) => {
    if (idx > best.pos) best = { pos: idx, prov }
  }

  // Chinese: require a 省/市 suffix so a street like "珠江西路" (contains 江西)
  // isn't mistaken for a province.
  for (const [en, zh] of Object.entries(PROVINCE_ZH)) {
    const withSheng = a.lastIndexOf(zh + '省')
    if (withSheng >= 0) consider(withSheng, en)
    if (MUNICIPALITIES.has(en)) {
      const withShi = a.lastIndexOf(zh + '市')
      if (withShi >= 0) consider(withShi, en)
    }
  }

  // English province name on a word boundary (last occurrence).
  for (const p of PROVINCES) {
    const re = new RegExp(`\\b${p}\\b`, 'gi')
    let m
    let last = -1
    while ((m = re.exec(a)) !== null) last = m.index
    if (last >= 0) consider(last, p)
  }

  // Major cities → province.
  for (const [city, en] of Object.entries(CITY_TO_PROVINCE)) {
    let idx = -1
    if (CN.test(city)) {
      idx = a.lastIndexOf(city)
    } else {
      const re = new RegExp(`\\b${city}\\b`, 'gi')
      let m
      while ((m = re.exec(a)) !== null) idx = m.index
    }
    if (idx >= 0) consider(idx, en)
  }

  return best.prov
}
