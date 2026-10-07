// Built-in fallbacks (used when cosmetics/catalog.json or mod/modules.json are not present yet) + shared helpers.
export const SLOTS: { id: string; label: string; slotTr: string; glyph: string; color: string }[] = [
  { id: 'hat', label: 'Şapkalar', slotTr: 'Şapka', glyph: '🎩', color: '#6FD3FF' }, { id: 'mask', label: 'Maskeler', slotTr: 'Maske', glyph: '🎭', color: '#FF5470' }, { id: 'body', label: 'Gövde', slotTr: 'Gövde', glyph: '🛡', color: '#FFC24D' },
  { id: 'cape', label: 'Pelerinler', slotTr: 'Pelerin', glyph: '🚩', color: '#2F8CFF' }, { id: 'wings', label: 'Kanatlar', slotTr: 'Kanat', glyph: '🪽', color: '#B66CFF' }, { id: 'pet', label: 'Evcil Hayvanlar', slotTr: 'Evcil Hayvan', glyph: '🐾', color: '#3DDC84' },
  { id: 'aura', label: 'Efektler', slotTr: 'Aura', glyph: '✨', color: '#FFFFFF' },
  { id: 'hit', label: 'Vuruş efektleri', slotTr: 'Vuruş efekti', glyph: '💥', color: '#FF8A3D' }
]
const ALIAS: Record<string, string> = { sapka: 'hat', şapka: 'hat', maske: 'mask', govde: 'body', gövde: 'body', pelerin: 'cape', kanat: 'wings', evcil: 'pet', pets: 'pet', particle: 'aura', hats: 'hat', masks: 'mask', capes: 'cape' }
export const normSlot = (s: string) => { const k = String(s || '').toLowerCase(); return ALIAS[k] || k }

export interface Cosmetic { id: string; slot: string; nameTr: string; rarity: string; iconData?: string; price: number; special?: string }
/** Same names + colors as the in-game screen (cosmetics/.../data/Rarity.java). */
export const GAME_RARITY: Record<string, { label: string; color: string }> = {
  common: { label: 'Sıradan', color: '#8A9BB8' }, rare: { label: 'Nadir', color: '#2F8CFF' }, epic: { label: 'Epik', color: '#B070FF' }, legendary: { label: 'Efsanevi', color: '#FFC24D' }
}
export interface Mod { id: string; name: string; desc: string; category: string }

export const RARITY: Record<string, { label: string; color: string }> = {
  common: { label: 'Yaygın', color: '#8A9BB8' }, uncommon: { label: 'Nadir', color: '#3DDC84' }, rare: { label: 'Ender', color: '#4DA3FF' },
  epic: { label: 'Efsanevi', color: '#B66CFF' }, legendary: { label: 'Mitik', color: '#6FD3FF' }
}
export const rarityOf = (r: string) => RARITY[String(r || '').toLowerCase()] || RARITY.common

const sampleNames: Record<string, string[]> = {
  hat: ['Altın Taç', 'Kovboy Şapkası', 'Cüce Külahı', 'Fes', 'Korsan Şapkası', 'Aureola', 'Büyücü Şapkası', 'Viking Miğferi'],
  mask: ['Ninja Maskesi', 'Kaplan Maskesi', 'Zombi Maskesi', 'Venedik Maskesi', 'Robot Maskesi', 'Tilki Maskesi'],
  body: ['Altın Zırh', 'Kar Tanesi Ceket', 'Robot Gövde', 'Şövalye Zırhı', 'Kızıl Pelerin Zırhı'],
  cape: ['Mavi Alev', 'Gece Yıldızı', 'Ay Işığı', 'Kraliyet Mavisi', 'Zümrüt', 'Okyanus', 'Buz Kristali', 'Şafak'],
  wings: ['Ateş Kanatları', 'Melek Kanatları', 'Kristal Kanat', 'Gölge Kanatları'],
  pet: ['Minik Tilki', 'Papağan', 'Baykuş', 'Küçük Ejder', 'Kedi'],
  aura: ['Kıvılcım Aurası', 'Kar Yağışı', 'Kalp Aurası', 'Buz Halkası']
}
const rar = ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary']
export const SAMPLE_COSMETICS: Cosmetic[] = Object.entries(sampleNames).flatMap(([slot, names]) =>
  names.map((n, i) => ({ id: `${slot}_sample_${i}`, slot, nameTr: n, rarity: rar[(i + slot.length) % rar.length], price: 0 })))

// [id, name, category, description] - used when mod/modules.json is not available yet.
const sm: [string, string, string, string][] = [
  ['fps', 'FPS Göstergesi', 'HUD', 'Saniyedeki kare sayını ekranın köşesinde gösterir.'],
  ['cps', 'CPS Göstergesi', 'HUD', 'Saniyedeki tık sayını (sol ve sağ) canlı gösterir.'],
  ['coords', 'Koordinatlar', 'HUD', 'X, Y, Z konumunu ve baktığın yönü gösterir.'],
  ['ping', 'Ping Göstergesi', 'HUD', 'Sunucuya olan gecikmeni milisaniye olarak gösterir.'],
  ['keystrokes', 'Tuş Göstergesi', 'HUD', 'WASD, boşluk ve fare tuşlarını ekranda canlandırır.'],
  ['armor', 'Zırh Göstergesi', 'HUD', 'Giydiğin zırhı ve dayanıklılık değerlerini gösterir.'],
  ['potions', 'İksir Göstergesi', 'HUD', 'Aktif iksir etkilerini ve kalan süreleri listeler.'],
  ['clock', 'Saat', 'HUD', 'Gerçek saati oyun ekranında gösterir.'],
  ['fullbright', 'Fullbright', 'Görsel', 'Karanlık yerleri aydınlatarak her yeri net gösterir.'],
  ['zoom', 'Yakınlaştırma', 'Görsel', 'Tuşa basılı tutarak uzağı yakınlaştırır.'],
  ['lowfire', 'Düşük Ateş', 'Görsel', 'Yanarken ekranı kaplayan ateşi aşağı indirir.'],
  ['crosshair', 'Özel Artı İmleç', 'Görsel', 'Artı imlecin rengini, boyutunu ve şeklini değiştirir.'],
  ['hitcolor', 'Vuruş Rengi', 'Görsel', 'Vurulan oyuncuların üzerindeki rengi özelleştirir.'],
  ['fpsboost', 'FPS Boost', 'Performans', 'Hazır profillerle tek tıkla daha yüksek FPS sağlar.'],
  ['particles', 'Parçacık Sınırı', 'Performans', 'Ekrandaki parçacık sayısını sınırlayarak FPS kazandırır.'],
  ['entitycap', 'Varlık Mesafesi', 'Performans', 'Uzaktaki varlıkların çizimini kısarak yükü azaltır.'],
  ['autogg', 'AutoGG', 'Sosyal', 'Oyun bitince otomatik olarak "gg" yazar.'],
  ['chat', 'Sohbet Geliştirmeleri', 'Sosyal', 'Zaman damgası, kopyalama ve sıkıştırılmış sohbet ekler.'],
  ['screenshot', 'Ekran Görüntüsü', 'Sosyal', 'Ekran görüntülerini tek tuşla paylaşılabilir hale getirir.'],
  ['togglesprint', 'Otomatik Koşu', 'Diğer', 'Koşma tuşunu basılı tutmana gerek bırakmaz.'],
  ['sessiontimer', 'Oturum Sayacı', 'Diğer', 'Oyunda geçirdiğin süreyi takip eder.'],
  ['memory', 'Bellek Kullanımı', 'Diğer', 'Kullanılan ve ayrılan RAM miktarını gösterir.']
]
export const SAMPLE_MODS: Mod[] = sm.map(([id, name, category, desc]) => ({ id, name, category, desc }))

export const FALLBACK_NEWS = [
  { id: 'n1', tag: 'MANŞET', title: 'VanillaTurkey Client yayında!', body: 'Yeni launcher, 100+ modül ve yüzlerce ücretsiz kozmetik ile Minecraft deneyimini bir üst seviyeye taşı.', image: '' },
  { id: 'n2', tag: 'PERFORMANS', title: 'Performans Paketi ile deli gibi FPS', body: 'Sodium, Lithium ve dahası otomatik kurulur. Ayarlardan tek tıkla aç veya kapat.', image: '' },
  { id: 'n3', tag: 'KOZMETİK', title: 'Hepsi ücretsiz kozmetikler', body: 'Şapka, pelerin, kanat, evcil hayvan ve aura. Kozmetikler sekmesinden giy, herkes seni onlarla görsün.', image: '' }
]
