// 전역 상태
let allLibraries = [];
let libraries = [];
let selectedLibrary = null;
const selectedBookCategories = new Set();
const selectedSpaceCategories = new Set();
const selectedElectronicCategories = new Set();
const selectedComfortCategories = new Set();
let selectedBookType = ''; // 'domestic' 또는 'foreign'
let openNowOnly = false; // deprecated UI removed
let sortKey = '';

  // 고급 필터 상태
  window.ageFocus = '';

// 장르별 필터링 상태
let selectedGenre = '';
let selectedBookTypeForMap = '';

const CSV_PATH = 'seoul_lib_preprocessed6.csv'; // 프로젝트 루트에 CSV 파일을 두면 됩니다.
// 지도는 MapView(map.js)에서 전담

// 인트로 화면 관련 변수
let introScreen = null;
let middleScreen = null;
let childrenPage = null;
let genrePage = null;
let hasScrolled = false;
let currentStep = 'intro'; // 'intro', 'middle', 'main', 'children'
let isTransitioning = false; // 스크롤 전환 중복 방지


window.addEventListener('DOMContentLoaded', async () => {
  addChildrenItemStyles(); // 어린이 페이지 스타일 추가
  initializeIntroScreen();
  initializeUI();
  initializeEventListeners();
  setupCategoryChips();
  // 지도 초기화 (파트너 모듈)
  if (window.MapView) {
    MapView.init('map', { level: 8 });
    // 지도 초기화 후 폴리곤 로드
    setTimeout(() => {
      try { window.MapView && window.MapView.loadInitialPolygons && window.MapView.loadInitialPolygons(); } catch(_){ }
    }, 1000);
  }
  await loadLibrariesFromCSV();
  applyFilters();
});

async function loadLibrariesFromCSV(){
  try{
    if (!window.d3 || !d3.csv) throw new Error('d3.csv not available');
    const rows = await d3.csv(CSV_PATH);
    let nextId = 1;
    const mapped = rows.map(r => mapCsvRowToLibrary(r, nextId++));
    // 필수 좌표/이름 없는 행 제외
    allLibraries = mapped.filter(l => l && l.name);
    // 쾌적함/좌석혼잡도 사분위(4등분) 경계 계산 및 등급 부여
    computeAndAssignComfortQuartiles(allLibraries);
    computeAndAssignCrowdingQuartiles(allLibraries);
    // 전역 변수로 설정 (MapView에서 사용)
    window.allLibraries = allLibraries;
  }catch(e){
    allLibraries = [...sampleLibraries];
  }
}

function toNumber(v){
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[,\s]/g,'');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function truthyFromString(v){
  if (!v) return false;
  const s = String(v);
  return /(y|Y|true|유|있|보유)/.test(s);
}

// 쾌적함(면적/방문자수) 사분위 기반 경계 계산 및 등급 할당
function computeAndAssignComfortQuartiles(libs){
  try {
    const ratios = libs
      .map(l => {
        const ratio = typeof l.comfortRatio === 'number' ? l.comfortRatio : 0;
        return isFinite(ratio) ? ratio : 0;
      })
      .filter(r => r >= 0);
    if (!ratios.length) return;
    const sorted = [...ratios].sort((a,b)=>a-b);
    const n = sorted.length;
    const q = (p)=> sorted[Math.max(0, Math.min(n-1, Math.floor((n-1)*p)))];
    const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
    window.comfortQuantiles = { q1, q2, q3 };
    libs.forEach(l => {
      const r = typeof l.comfortRatio === 'number' && isFinite(l.comfortRatio) ? l.comfortRatio : 0;
      let level = '좁음';
      if (r > q3) level = '매우좋음';
      else if (r > q2) level = '좋음';
      else if (r > q1) level = '보통';
      else level = '좁음';
      l.comfortLevel = level;
    });
  } catch(_){ /* fail silently */ }
}

// 좌석혼잡도(좌석수 총합 / 회원수 총합) 사분위 기반 등급 할당
function computeAndAssignCrowdingQuartiles(libs){
  try {
    const ratios = libs
      .map(l => {
        const seats = Number(l.seatsTotal) || 0;
        const mChild = Number(l['연령별회원등록자수_어린이']) || 0;
        const mTeen = Number(l['연령별회원등록자수_청소년']) || 0;
        const mAdult = Number(l['연령별회원등록자수_성인']) || 0;
        const members = mChild + mTeen + mAdult;
        if (seats > 0 && members > 0) return seats / members;
        return null;
      })
      .filter(v => v !== null && isFinite(v) && v >= 0);
    if (!ratios.length) return;
    const sorted = [...ratios].sort((a,b)=>a-b);
    const n = sorted.length;
    const q = (p)=> sorted[Math.max(0, Math.min(n-1, Math.floor((n-1)*p)))];
    const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
    window.crowdingQuantiles = { q1, q2, q3 };
    libs.forEach(l => {
      const seats = Number(l.seatsTotal) || 0;
      const mChild = Number(l['연령별회원등록자수_어린이']) || 0;
      const mTeen = Number(l['연령별회원등록자수_청소년']) || 0;
      const mAdult = Number(l['연령별회원등록자수_성인']) || 0;
      const members = mChild + mTeen + mAdult;
      if (seats > 0 && members > 0) {
        const r = seats / members; // 높을수록 좌석 대비 회원 여유 → 여유
        l.crowdingRatio = r;
        let level = '매우혼잡';
        if (r > q3) level = '여유';
        else if (r > q2) level = '보통';
        else if (r > q1) level = '혼잡';
        else level = '매우혼잡';
        l.crowdingLevel = level;
      } else {
        l.crowdingLevel = '정보없음';
        l.crowdingRatio = 0;
      }
    });
  } catch(_){ /* fail silently */ }
}

// 좌석혼잡도 계산 함수
function getCrowdingLevel(r) {
  const totalMembers = toNumber(r['연령별회원등록자수_어린이']) + 
                      toNumber(r['연령별회원등록자수_청소년']) + 
                      toNumber(r['연령별회원등록자수_성인']);
  const totalSeats = toNumber(r['좌석수_총좌석수']);
  
  if (totalSeats === 0) return '정보없음';
  
  const crowdingRatio = totalMembers / totalSeats;
  
  if (crowdingRatio >= 3.0) return '매우혼잡';
  if (crowdingRatio >= 2.0) return '혼잡';
  if (crowdingRatio >= 1.0) return '보통';
  return '여유';
}

function mapCsvRowToLibrary(r, id){
  // 주제 카테고리 합산
  const cats = [
    { key:'총류', d:'국내서_총류', f:'국외서_총류' },
    { key:'철학', d:'국내서_철학', f:'국외서_철학' },
    { key:'종교', d:'국내서_종교', f:'국외서_종교' },
    { key:'사회과학', d:'국내서_사회과학', f:'국외서_사회과학' },
    { key:'순수과학', d:'국내서_순수과학', f:'국외서_순수과학' },
    { key:'기술과학', d:'국내서_기술과학', f:'국외서_기술과학' },
    { key:'예술', d:'국내서_예술', f:'국외서_예술' },
    { key:'언어', d:'국내서_언어', f:'국외서_언어' },
    { key:'문학', d:'국내서_문학', f:'국외서_문학' },
    { key:'역사', d:'국내서_역사', f:'국외서_역사' }
  ];
  // 국내서와 국외서 분리
  const domesticCats = cats.map(c => ({ name:c.key, value: toNumber(r[c.d]) }));
  const foreignCats = cats.map(c => ({ name:c.key, value: toNumber(r[c.f]) }));
  
  // 전체 합산 (기존 로직 유지)
  const catTotals = cats.map(c => ({ name:c.key, value: toNumber(r[c.d]) + toNumber(r[c.f]) }));
  catTotals.sort((a,b)=>b.value-a.value);
  const top2 = catTotals.slice(0,2).filter(c=>c.value>0).map(c=>c.name);
  
  // 국내서/국외서별 상위 카테고리
  domesticCats.sort((a,b)=>b.value-a.value);
  foreignCats.sort((a,b)=>b.value-a.value);
  const topDomestic = domesticCats.slice(0,3).filter(c=>c.value>0).map(c=>c.name);
  const topForeign = foreignCats.slice(0,3).filter(c=>c.value>0).map(c=>c.name);

  const holdingsDomestic = toNumber(r['국내서_합계']);
  const holdingsForeign = toNumber(r['국외서_합계']);

  // 전자자료 데이터
  const electronicData = {
    전자저널: toNumber(r['전자저널']),
    전자도서: toNumber(r['전자도서']),
    오디오북: toNumber(r['오디오북']),
    웹데이터베이스: toNumber(r['웹데이터베이스']),
    기타: toNumber(r['전자_기타'])
  };
  
  // 전자자료 상위 카테고리 (값이 있는 것들만)
  const topElectronic = Object.entries(electronicData)
    .filter(([key, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, value]) => key);

  return {
    id,
    name: r['도서관명'] || r['기관명'] || r['명칭'] || '',
    district: r['시군구'] || r['자치구'] || '',
    type: r['구분'] || '',
    address: [r['주소']||'', r['상세주소']||''].filter(Boolean).join(' '),
    phone: r['전화번호']||'',
    homepage: r['홈페이지']||'',
    openHours: r['개관시간']||'',
    closedDays: r['휴관일']||'',
    lat: toNumber(r['위도']) || null,
    lng: toNumber(r['경도']) || null,
    area: toNumber(r['면적_도서관 서비스 제공 면적']),
    seatsTotal: toNumber(r['좌석수_총 좌석수']),
    seatsChild: toNumber(r['좌석수_어린이 열람석']),
    seatsSeniorDisabled: toNumber(r['좌석수_노인 및 장애인 열람석']),
    pcs: toNumber(r['설비_이용자용컴퓨터수']),
    visitors: toNumber(r['이용자수_도서관방문자수']),
    // 쾌적함 계산: 면적 / 방문자수 (㎡/명)
    comfortRatio: (() => {
      const area = toNumber(r['면적_도서관 서비스 제공 면적']);
      const visitors = toNumber(r['이용자수_도서관방문자수']);
      if (area > 0 && visitors > 0) {
        return area / visitors;
      }
      return 0;
    })(),
    // 쾌적함 등급 분류
    comfortLevel: (() => {
      const area = toNumber(r['면적_도서관 서비스 제공 면적']);
      const visitors = toNumber(r['이용자수_도서관방문자수']);
      if (area > 0 && visitors > 0) {
        const ratio = area / visitors;
        if (ratio >= 2.0) return '매우좋음';
        if (ratio >= 1.0) return '좋음';
        if (ratio >= 0.5) return '보통';
        return '좁음';
      }
      return '정보없음';
    })(),
    loansPrintChild: toNumber(r['인쇄자료_어린이_합계']) || toNumber(r['인쇄자료_대출_어린이']),
    loansPrintTeen: toNumber(r['인쇄자료_청소년_합계']) || toNumber(r['인쇄자료_대출_청소년']),
    loansPrintAdult: toNumber(r['인쇄자료_성인_합계']) || toNumber(r['인쇄자료_대출_성인']),
    loansPrintTotal: toNumber(r['인쇄자료_대출_합계']),
    eUseChild: toNumber(r['전자자료_어린이_합계']) || toNumber(r['전자자료_이용_어린이']),
    eUseTeen: toNumber(r['전자자료_청소년_합계']) || toNumber(r['전자자료_이용_청소년']),
    eUseAdult: toNumber(r['전자자료_성인_합계']) || toNumber(r['전자자료_이용_성인']),
    eUseTotal: toNumber(r['전자자료_이용_합계']),
    // 연령별 회원 등록자 수(비율 계산용) - CSV 헤더는 공백 포함
    '연령별회원등록자수_어린이': toNumber(r['연령별 회원등록자 수_어린이']),
    '연령별회원등록자수_청소년': toNumber(r['연령별 회원등록자 수_청소년']),
    '연령별회원등록자수_성인': toNumber(r['연령별 회원등록자 수_성인']),
    holdingsDomestic: holdingsDomestic || catTotals.reduce((s,c)=>s+(c.name&&c.value||0),0) /* fallback */,
    holdingsForeign: holdingsForeign,
    yearOpened: toNumber(r['개관년도']),
    hasChildrenRoom: truthyFromString(r['어린이실']),
    bookCategories: top2,
    domesticCategories: topDomestic,
    foreignCategories: topForeign,
    domesticCategoriesData: domesticCats,
    foreignCategoriesData: foreignCats,
    electronicCategories: topElectronic,
    electronicData: electronicData,
    spaceCategories: [],
    popularBooks: [],
    facilities: [],
    nearby: { residential: [], commercial: [] },
    // 좌석혼잡도 계산
    crowdingLevel: getCrowdingLevel(r),
    // 국내서 장르별 데이터
    '국내서_총류': toNumber(r['국내서_총류']),
    '국내서_철학': toNumber(r['국내서_철학']),
    '국내서_종교': toNumber(r['국내서_종교']),
    '국내서_사회과학': toNumber(r['국내서_사회과학']),
    '국내서_순수과학': toNumber(r['국내서_순수과학']),
    '국내서_기술과학': toNumber(r['국내서_기술과학']),
    '국내서_예술': toNumber(r['국내서_예술']),
    '국내서_언어': toNumber(r['국내서_언어']),
    '국내서_문학': toNumber(r['국내서_문학']),
    '국내서_역사': toNumber(r['국내서_역사']),
    
    // 국외서 장르별 데이터
    '국외서_총류': toNumber(r['국외서_총류']),
    '국외서_철학': toNumber(r['국외서_철학']),
    '국외서_종교': toNumber(r['국외서_종교']),
    '국외서_사회과학': toNumber(r['국외서_사회과학']),
    '국외서_순수과학': toNumber(r['국외서_순수과학']),
    '국외서_기술과학': toNumber(r['국외서_기술과학']),
    '국외서_예술': toNumber(r['국외서_예술']),
    '국외서_언어': toNumber(r['국외서_언어']),
    '국외서_문학': toNumber(r['국외서_문학']),
    '국외서_역사': toNumber(r['국외서_역사']),
    
    // 어린이 장르별 대출 데이터 추가
    '인쇄자료_어린이_총류': toNumber(r['인쇄자료_어린이_총류']),
    '인쇄자료_어린이_철학': toNumber(r['인쇄자료_어린이_철학']),
    '인쇄자료_어린이_종교': toNumber(r['인쇄자료_어린이_종교']),
    '인쇄자료_어린이_사회과학': toNumber(r['인쇄자료_어린이_사회과학']),
    '인쇄자료_어린이_순수과학': toNumber(r['인쇄자료_어린이_순수과학']),
    '인쇄자료_어린이_기술과학': toNumber(r['인쇄자료_어린이_기술과학']),
    '인쇄자료_어린이_예술': toNumber(r['인쇄자료_어린이_예술']),
    '인쇄자료_어린이_언어': toNumber(r['인쇄자료_어린이_언어']),
    '인쇄자료_어린이_문학': toNumber(r['인쇄자료_어린이_문학']),
    '인쇄자료_어린이_역사': toNumber(r['인쇄자료_어린이_역사']),
    
    // 청소년 장르별 데이터
    '인쇄자료_청소년_총류': toNumber(r['인쇄자료_청소년_총류']),
    '인쇄자료_청소년_철학': toNumber(r['인쇄자료_청소년_철학']),
    '인쇄자료_청소년_종교': toNumber(r['인쇄자료_청소년_종교']),
    '인쇄자료_청소년_사회과학': toNumber(r['인쇄자료_청소년_사회과학']),
    '인쇄자료_청소년_순수과학': toNumber(r['인쇄자료_청소년_순수과학']),
    '인쇄자료_청소년_기술과학': toNumber(r['인쇄자료_청소년_기술과학']),
    '인쇄자료_청소년_예술': toNumber(r['인쇄자료_청소년_예술']),
    '인쇄자료_청소년_언어': toNumber(r['인쇄자료_청소년_언어']),
    '인쇄자료_청소년_문학': toNumber(r['인쇄자료_청소년_문학']),
    '인쇄자료_청소년_역사': toNumber(r['인쇄자료_청소년_역사']),
    
    // 성인 장르별 데이터
    '인쇄자료_성인_총류': toNumber(r['인쇄자료_성인_총류']),
    '인쇄자료_성인_철학': toNumber(r['인쇄자료_성인_철학']),
    '인쇄자료_성인_종교': toNumber(r['인쇄자료_성인_종교']),
    '인쇄자료_성인_사회과학': toNumber(r['인쇄자료_성인_사회과학']),
    '인쇄자료_성인_순수과학': toNumber(r['인쇄자료_성인_순수과학']),
    '인쇄자료_성인_기술과학': toNumber(r['인쇄자료_성인_기술과학']),
    '인쇄자료_성인_예술': toNumber(r['인쇄자료_성인_예술']),
    '인쇄자료_성인_언어': toNumber(r['인쇄자료_성인_언어']),
    '인쇄자료_성인_문학': toNumber(r['인쇄자료_성인_문학']),
    '인쇄자료_성인_역사': toNumber(r['인쇄자료_성인_역사']),
    
    // 어린이 전자자료 장르별 대출 데이터 추가
    '전자자료_어린이_총류': toNumber(r['전자자료_어린이_총류']),
    '전자자료_어린이_철학': toNumber(r['전자자료_어린이_철학']),
    '전자자료_어린이_종교': toNumber(r['전자자료_어린이_종교']),
    '전자자료_어린이_사회과학': toNumber(r['전자자료_어린이_사회과학']),
    '전자자료_어린이_순수과학': toNumber(r['전자자료_어린이_순수과학']),
    '전자자료_어린이_기술과학': toNumber(r['전자자료_어린이_기술과학']),
    '전자자료_어린이_예술': toNumber(r['전자자료_어린이_예술']),
    '전자자료_어린이_언어': toNumber(r['전자자료_어린이_언어']),
    '전자자료_어린이_문학': toNumber(r['전자자료_어린이_문학']),
    '전자자료_어린이_역사': toNumber(r['전자자료_어린이_역사']),
    
    // 청소년 전자자료 장르별 데이터
    '전자자료_청소년_총류': toNumber(r['전자자료_청소년_총류']),
    '전자자료_청소년_철학': toNumber(r['전자자료_청소년_철학']),
    '전자자료_청소년_종교': toNumber(r['전자자료_청소년_종교']),
    '전자자료_청소년_사회과학': toNumber(r['전자자료_청소년_사회과학']),
    '전자자료_청소년_순수과학': toNumber(r['전자자료_청소년_순수과학']),
    '전자자료_청소년_기술과학': toNumber(r['전자자료_청소년_기술과학']),
    '전자자료_청소년_예술': toNumber(r['전자자료_청소년_예술']),
    '전자자료_청소년_언어': toNumber(r['전자자료_청소년_언어']),
    '전자자료_청소년_문학': toNumber(r['전자자료_청소년_문학']),
    '전자자료_청소년_역사': toNumber(r['전자자료_청소년_역사']),
    
    // 성인 전자자료 장르별 데이터
    '전자자료_성인_총류': toNumber(r['전자자료_성인_총류']),
    '전자자료_성인_철학': toNumber(r['전자자료_성인_철학']),
    '전자자료_성인_종교': toNumber(r['전자자료_성인_종교']),
    '전자자료_성인_사회과학': toNumber(r['전자자료_성인_사회과학']),
    '전자자료_성인_순수과학': toNumber(r['전자자료_성인_순수과학']),
    '전자자료_성인_기술과학': toNumber(r['전자자료_성인_기술과학']),
    '전자자료_성인_예술': toNumber(r['전자자료_성인_예술']),
    '전자자료_성인_언어': toNumber(r['전자자료_성인_언어']),
    '전자자료_성인_문학': toNumber(r['전자자료_성인_문학']),
    '전자자료_성인_역사': toNumber(r['전자자료_성인_역사']),
    
    // 개관시간 추가
    '개관시간': r['개관시간'] || ''
  };
}

function initializeIntroScreen() {
  introScreen = document.getElementById('introScreen');
  middleScreen = document.getElementById('middleScreen');
  childrenPage = document.getElementById('childrenPage');
  genrePage = document.getElementById('genrePage');
  if (!introScreen || !middleScreen) return;

  // 시네마틱 요소 참조 및 준비
  const bg1 = document.querySelector('.cine-bg-1');
  const bg2 = document.querySelector('.cine-bg-2');
  const floatIconsContainer = document.querySelector('.float-icons');
  const rings = Array.from(document.querySelectorAll('.rings3d .ring'));
  const progressBar = null;
  const mouseOverlay = document.querySelector('.mouse-gradient-overlay');
  const enterCine = null;
  const cineVignette = null;
  const cineRays = null;
  const cineFloor = null;

  let introScrollAccum = 0;

  function ensureFloatIcons(container){
    if (!container) return;
    if (container.children.length >= 20) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('div');
      el.className = 'fi';
      const x = Math.random() * width;
      const y = Math.random() * height;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      // 반짝임 타이밍 다양화
      el.style.setProperty('--twinkleDur', (1.8 + Math.random()*1.8).toFixed(2) + 's');
      el.style.setProperty('--twinkleDelay', (Math.random()*1.2).toFixed(2) + 's');
      container.appendChild(el);
    }
  }
  ensureFloatIcons(floatIconsContainer);

  function updateCinematic(scrollProgress, scrollY){
    // 텍스트/UI 미세 이동 + 배경 레이어 동적 변환
    const title = document.querySelector('.intro-title');
    const subtitle = document.querySelector('.intro-subtitle');
    const logo = document.querySelector('.library-icon');
    const ty = scrollY * 0.05;
    const sc = 1 + scrollProgress * 0.1;
    if (title) title.style.transform = `translateY(${ty}px) scale(${sc})`;
    if (subtitle) subtitle.style.transform = `translateY(${ty}px) scale(${sc})`;
    if (logo) logo.style.transform = `translateY(${ty}px) scale(${sc})`;

    const zoomScale = 1 + scrollProgress * 1.8; // 사진 확대 감도 낮춤
    if (bg1){
      bg1.style.transform = `scale(${zoomScale}) translateY(${scrollY * 0.18}px)`;
      const fade = 1 - Math.min(scrollProgress * 1.2, 1); // 메뉴가 나타나기 전까지만 보이게 점점 사라짐
      bg1.style.opacity = String(0.6 * fade);
      bg1.style.filter = `saturate(${1 + scrollProgress * 0.2})`;
    }
    if (bg2){
      const p2 = Math.max(0, (scrollProgress - 0.3) / 0.7);
      bg2.style.opacity = String(p2);
      bg2.style.transform = `scale(${1 + scrollProgress * 2}) translateY(${scrollY * 0.15}px) rotateX(${scrollProgress * 3}deg)`;
      bg2.style.filter = `brightness(${0.6 + p2 * 0.4})`;
    }

    if (floatIconsContainer){
      const nodes = Array.from(floatIconsContainer.children);
      for (let i = 0; i < nodes.length; i++){
        const n = nodes[i];
        const dy = scrollY * (0.05 + i * 0.01);
        const s = 0.3 + scrollProgress * 0.7;
        const rot = i * 15;
        n.style.transform = `translateY(${dy}px) scale(${s}) rotateZ(${rot}deg)`;
      }
    }

    if (rings.length){
      rings.forEach((r, i) => {
        r.style.transform = `rotateX(${60 + i * 10}deg) rotateY(${scrollProgress * 360}deg)`;
        r.style.opacity = String(0.25 + scrollProgress * 0.6);
      });
    }

    // 마우스 오버레이 위치 업데이트(마우스 이동 이벤트에서 실시간 반영됨)

    // 추가 시네마틱 제거됨
  }

  // 인트로 스크롤 진행도 → 문/바닥 애니메이션 업데이트
  function handleIntroScroll(){
    if (currentStep !== 'intro') return;
    // 인트로(첫 화면) 높이까지만 효과 적용
    const total = Math.max(window.innerHeight * 1.0, 1);
    const y = Math.max(0, Math.min(window.scrollY || window.pageYOffset || 0, total));
    const p = Math.min(y / total, 1);
    updateCinematic(p, y);
  }

  // 초기 상태 적용
  updateCinematic(0, 0);

  // 마우스 인터랙션
  let lastTrailTs = 0;
  function handleMouseMove(e){
    if (currentStep !== 'intro') return;
    const now = performance.now();
    if (mouseOverlay){
      mouseOverlay.style.background = `radial-gradient(600px circle at ${e.clientX}px ${e.clientY}px, rgba(6,182,212,0.1), transparent 40%)`;
    }
    if (now - lastTrailTs > 16){
      spawnTrail(e.clientX, e.clientY);
      if (Math.random() < 0.1) spawnSparkle(e.clientX + (Math.random()*30-15), e.clientY + (Math.random()*30-15));
      lastTrailTs = now;
    }
  }
  function spawnTrail(x, y){
    const el = document.createElement('div');
    el.className = 'cursor-trail';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 750);
  }
  function spawnSparkle(x, y){
    const el = document.createElement('div');
    el.className = 'sparkle';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 850);
  }
  function enableIntroMouseFX(){ window.addEventListener('mousemove', handleMouseMove); }
  function disableIntroMouseFX(){ window.removeEventListener('mousemove', handleMouseMove); }
  enableIntroMouseFX();

  // 터치 이벤트 - 인트로에서만 작동
  function handleTouch(e) {
    // 클릭대신 스크롤 유도. 터치만으로는 넘어가지 않음 (스와이프 사용)
    return;
  }

  // 클릭 이벤트 - 인트로에서만 작동
  function handleClick(e) {
    if (hasScrolled || currentStep !== 'intro') return;
    // 메뉴 버튼이 아닌 경우에만
    if (!e.target.closest('.menu-btn')) {
      showMiddleScreen();
    }
  }

  // 키보드 이벤트 - 인트로에서만 작동
  function handleKeyDown(e) {
    if (hasScrolled || currentStep !== 'intro') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      showMiddleScreen();
    }
  }

  // 스크롤 기반 네비게이션
  function onWheel(e) {
    // 스크롤 네비게이션은 전체 화면 전환에만 개입
    if (isTransitioning) return;

    const delta = e.deltaY || 0;
    // Intro 시 스크롤 진행도 계산 및 이펙트 업데이트
    if (currentStep === 'intro') {
      // 스크롤 이벤트에서 처리
      return;
    }
    // Middle → Main (기본)
    if (currentStep === 'middle' && delta > 10) {
      e.preventDefault();
      isTransitioning = true;
      currentStep = 'main';
      showMainScreen();
      setTimeout(() => { isTransitioning = false; }, 900);
      return;
    }
    // 상단에서 위로 스크롤 시 이전 화면으로 복귀
    const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    if (delta < -10 && atTop) {
      if (currentStep === 'main') {
        e.preventDefault();
        isTransitioning = true;
        hideMainScreen();
        setTimeout(() => { isTransitioning = false; }, 700);
      } else if (currentStep === 'children') {
        e.preventDefault();
        isTransitioning = true;
        hideChildrenPage();
        setTimeout(() => { isTransitioning = false; }, 900);
      } else if (currentStep === 'genre') {
        e.preventDefault();
        isTransitioning = true;
        hideGenrePage();
        setTimeout(() => { isTransitioning = false; }, 900);
      }
    }
  }

  // 터치 스와이프(모바일) 기반 네비게이션
  let touchStartY = null;
  function onTouchStart(e) {
    touchStartY = e.touches && e.touches.length ? e.touches[0].clientY : null;
  }
  function onTouchMove(e) {
    if (isTransitioning || touchStartY === null) return;
    const currentY = e.touches && e.touches.length ? e.touches[0].clientY : touchStartY;
    const dy = touchStartY - currentY; // 양수면 위로 스와이프(다음 화면)

    // Intro 스와이프 누적
    if (currentStep === 'intro') {
      // 기본 스크롤(스와이프) 허용
      return;
    }
    // Middle → Main
    if (currentStep === 'middle' && dy > 20) {
      isTransitioning = true;
      currentStep = 'main';
      showMainScreen();
      setTimeout(() => { isTransitioning = false; }, 900);
      return;
    }
    // 상단에서 아래로 스와이프 시 이전 화면
    const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    if (dy < -20 && atTop) {
      if (currentStep === 'main') {
        isTransitioning = true;
        hideMainScreen();
        setTimeout(() => { isTransitioning = false; }, 700);
      } else if (currentStep === 'children') {
        isTransitioning = true;
        hideChildrenPage();
        setTimeout(() => { isTransitioning = false; }, 900);
      } else if (currentStep === 'genre') {
        isTransitioning = true;
        hideGenrePage();
        setTimeout(() => { isTransitioning = false; }, 900);
      }
    }
  }
  function onTouchEnd() { touchStartY = null; }

  // 메뉴 버튼 이벤트
  function setupMenuButtons() {
    const mainPageBtn = document.getElementById('mainPageBtn');
    const childrenPageBtn = document.getElementById('childrenPageBtn');
    const backToMiddle = document.getElementById('backToMiddle');
    const backToMenu = document.getElementById('backToMenu');
    const backToMiddleFromGenre = document.getElementById('backToMiddleFromGenre');

    if (mainPageBtn) {
      mainPageBtn.addEventListener('click', () => {
        currentStep = 'main';
        showMainScreen();
      });
    }

    if (childrenPageBtn) {
      childrenPageBtn.addEventListener('click', () => {
        currentStep = 'children';
        showChildrenPage();
      });
    }
    
    const genrePageBtn = document.getElementById('genrePageBtn');
    if (genrePageBtn) {
      genrePageBtn.addEventListener('click', () => {
        currentStep = 'genre';
        showGenrePage();
      });
    }

    if (backToMiddle) {
      backToMiddle.addEventListener('click', () => {
        currentStep = 'middle';
        hideChildrenPage();
      });
    }

    if (backToMenu) {
      backToMenu.addEventListener('click', () => {
        currentStep = 'middle';
        hideMainScreen();
      });
    }
    
    if (backToMiddleFromGenre) {
      backToMiddleFromGenre.addEventListener('click', () => {
        currentStep = 'middle';
        hideGenrePage();
      });
    }
  }

  // 중간 화면 표시
  function showMiddleScreen() {
    currentStep = 'middle';
    // 먼저 중간 화면을 준비 (보이지 않게)
    middleScreen.style.display = 'flex';
    middleScreen.style.opacity = '0';
    
    // 인트로 화면 숨기기
    introScreen.classList.add('hidden');
    
    // 인트로 화면이 사라지는 동안 중간 화면을 서서히 나타냄
    setTimeout(() => {
      introScreen.style.display = 'none';
      middleScreen.style.opacity = '1';
      setupMenuButtons(); // 메뉴 버튼 이벤트 설정
    }, 400);
  }

  // 어린이 페이지 표시
  function showChildrenPage() {
    // 중간 화면은 상단에 유지하고, 선택한 페이지만 아래에 표시
    const container = document.querySelector('.container');
    const backToMenu = document.getElementById('backToMenu');
    if (container) container.style.display = 'none';
    if (genrePage) genrePage.style.display = 'none';
    if (childrenPage) {
      childrenPage.style.display = 'block';
      loadChildrenData();
    }
    if (middleScreen) middleScreen.style.display = 'flex';
    if (backToMenu) backToMenu.style.display = 'none';
    if (childrenPage) childrenPage.scrollIntoView({ behavior: 'smooth' });
  }

  // 어린이 페이지 숨기기
  function hideChildrenPage() {
    if (childrenPage) childrenPage.style.display = 'none';
    if (middleScreen) {
      middleScreen.style.display = 'flex';
    }
  }
  
  // 장르 페이지 표시
  function showGenrePage() {
    // 중간 화면은 상단에 유지하고, 선택한 페이지만 아래에 표시
    const container = document.querySelector('.container');
    const backToMenu = document.getElementById('backToMenu');
    if (container) container.style.display = 'none';
    if (childrenPage) childrenPage.style.display = 'none';
    if (genrePage) {
      genrePage.style.display = 'block';
      loadGenreData();
    }
    if (middleScreen) middleScreen.style.display = 'flex';
    if (backToMenu) backToMenu.style.display = 'none';
    if (genrePage) genrePage.scrollIntoView({ behavior: 'smooth' });
  }
  
  // 장르 페이지 숨기기
  function hideGenrePage() {
    if (genrePage) genrePage.style.display = 'none';
    if (middleScreen) {
      middleScreen.style.display = 'flex';
    }
  }

  // 메인 화면 표시
  function showMainScreen() {
    hasScrolled = true;
    const container = document.querySelector('.container');
    const backToMenu = document.getElementById('backToMenu');
    // 중간 화면은 상단에 유지하고, 메인만 아래에 표시
    if (childrenPage) childrenPage.style.display = 'none';
    if (genrePage) genrePage.style.display = 'none';
    if (container) {
      container.style.display = 'block';
      container.classList.add('show');
    }
    if (middleScreen) middleScreen.style.display = 'flex';
    if (backToMenu) backToMenu.style.display = 'none';
    if (container) container.scrollIntoView({ behavior: 'smooth' });
  }

  // 중간 화면이 초기부터 보이는 구성에서는 메뉴 버튼 이벤트를 즉시 설정
  try { setupMenuButtons(); } catch (e) { /* 초기 호출 실패 무시 */ }

  // 메인 화면 숨기기
  function hideMainScreen() {
    const container = document.querySelector('.container');
    const backToMenu = document.getElementById('backToMenu');
    if (container) container.style.display = 'none';
    if (backToMenu) backToMenu.style.display = 'none';
    if (middleScreen) {
      middleScreen.style.display = 'flex';
    }
    hasScrolled = false;
    currentStep = 'middle';
  }

  // 상단 결합 카드(쾌적함/좌석혼잡도) 클릭 → 해당 칩 섹션으로 포커스 이동
  try {
    const combo = document.getElementById('comboComfortStudy');
    if (combo) {
      combo.addEventListener('click', (e) => {
        const btn = e.target.closest('.combo-item');
        if (!btn) return;
        const tri = btn.dataset.tri;
        if (tri === 'comfort') {
          document.getElementById('comfortCategoryChips')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (tri === 'study') {
          document.getElementById('studyCategoryChips')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
  } catch (_) {}

  // 이벤트 리스너 등록
  // 인트로: 스크롤로 자연스럽게 아래 섹션 노출, 키보드로도 가능
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('scroll', handleIntroScroll, { passive: true });

  // 3초 후 자동으로 스킵 힌트 표시 (선택적)
  setTimeout(() => {
    if (currentStep === 'intro' && introScreen) {
      const indicator = introScreen.querySelector('.scroll-indicator');
      if (indicator) {
        indicator.style.animation = 'bounce 1s infinite';
      }
    }
  }, 3000);

  // 장르 데이터 로드 함수
  function loadGenreData() {
    // 새로운 랭킹 시스템 탭 이벤트 설정
    setupAdvancedRankingTabs();
    
    // 새로운 랭킹 시스템 초기 표시
    showDomesticRanking('total');
    showForeignRanking('total');
    showPrintAgeRanking('어린이');
    showElectronicAgeRanking('어린이');
  }
  




  // 어린이 데이터 로드 함수
  function loadChildrenData() {
    const allLibs = allLibraries.length ? allLibraries : sampleLibraries;
    
    // 어린이실 보유 도서관 필터링
    const childrenLibraries = allLibs.filter(lib => lib.hasChildrenRoom);
    

    
    // 도서관 목록 표시
    const listContainer = document.getElementById('childrenLibraryList');
    if (childrenLibraries.length === 0) {
      listContainer.innerHTML = '<p>어린이실을 보유한 도서관이 없습니다.</p>';
      return;
    }
    
    // 어린이 보유도서 기준으로 정렬 (어린이 도서가 많은 순)
    childrenLibraries.sort((a, b) => calculateChildrenHoldings(b) - calculateChildrenHoldings(a));
    
    const childrenContainer = document.getElementById('childrenLibraryContainer');
    if (childrenContainer) {
      childrenContainer.innerHTML = childrenLibraries.slice(0, 10).map((lib, index) => `
        <div class="children-library-simple-item" onmouseenter="showChildrenLibraryModal(${index})">
          <span class="library-rank">${index + 1}</span>
          <span class="library-name">${lib.name}</span>
          <div class="library-details">
            <span class="library-seats">🪑 ${lib.seatsChild || 0}석</span>
            <span class="library-holdings">📚 ${calculateChildrenHoldings(lib).toLocaleString()}권</span>
          </div>
        </div>
      `).join('');
      
      // 전역 변수에 데이터 저장 (모달에서 사용)
      window.childrenLibrariesData = childrenLibraries.slice(0, 10);
    }

    // 어린이 지도 초기화 (카카오 지도)
    initializeChildrenMap(childrenLibraries);
    
    // 장르별 대출 랭킹 초기화
    initializeGenreRanking(childrenLibraries);
    
    // 전자자료 장르별 대출 랭킹 초기화
    initializeElectronicRanking(childrenLibraries);
  }
  // 어린이 지도 초기화 (카카오 지도 사용)
  function initializeChildrenMap(childrenLibraries) {
    const mapContainer = document.getElementById('childrenMapContainer');
    if (!mapContainer) return;

    // 카카오 지도가 로드되었는지 확인
    if (!window.kakao || !window.kakao.maps) {
      console.log('카카오 지도 API가 로드되지 않았습니다.');
      return;
    }

    // 카카오 지도 초기화
    window.kakao.maps.load(() => {
      // 기존 지도가 있다면 제거
      mapContainer.innerHTML = '';

      const options = {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 8
      };
      
      const childrenMap = new kakao.maps.Map(mapContainer, options);
      
      // 줌 컨트롤 추가
      const zoomControl = new kakao.maps.ZoomControl();
      childrenMap.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

      // 어린이 친화 도서관들의 마커 생성
      const bounds = new kakao.maps.LatLngBounds();
      
      childrenLibraries.forEach((library, index) => {
        if (library.latitude && library.longitude) {
          const position = new kakao.maps.LatLng(library.latitude, library.longitude);
          bounds.extend(position);
          
          // 마커 이미지 설정 (어린이 전용 아이콘)
          const markerImage = new kakao.maps.MarkerImage(
            'icon.png', // 메인 지도와 같은 아이콘 사용
            new kakao.maps.Size(30, 30),
            { offset: new kakao.maps.Point(15, 28) }
          );

          const marker = new kakao.maps.Marker({
            position: position,
            image: markerImage
          });

          marker.setMap(childrenMap);

          // 정보창 내용
          const infoContent = `
            <div class="kakao-info-window children-kakao-info">
              <div class="info-title">👶 ${library.name}</div>
              <div class="info-content">
                <p><strong>어린이 좌석:</strong> ${library.seatsChild || 0}석</p>
                <p><strong>주소:</strong> ${library.address}</p>
                <p><strong>전화:</strong> ${library.phone || '정보 없음'}</p>
                <p><strong>보유도서:</strong> ${((library.holdingsDomestic || 0) + (library.holdingsForeign || 0)).toLocaleString()}권</p>
                <p><strong>운영시간:</strong> ${library.개관시간 || '정보 없음'}</p>
              </div>
            </div>
          `;

          const infoWindow = new kakao.maps.InfoWindow({
            content: infoContent
          });

          // 마커 호버 이벤트로 변경 (mouseover 시 열기, mouseout 시 닫기)
          kakao.maps.event.addListener(marker, 'mouseover', function() {
            infoWindow.open(childrenMap, marker);
          });
          kakao.maps.event.addListener(marker, 'mouseout', function() {
            infoWindow.close();
          });

          // 호버 이벤트 (간단한 툴팁)
          const hoverContent = `
            <div class="kakao-hover-popup">
              <div class="popup-title">${library.name}</div>
              <div class="popup-meta">
                어린이 좌석: ${library.seatsChild || 0}석<br/>
                보유도서: ${((library.holdingsDomestic || 0) + (library.holdingsForeign || 0)).toLocaleString()}권
              </div>
            </div>
          `;

          let hoverOverlay = null;

          kakao.maps.event.addListener(marker, 'mouseover', function() {
            hoverOverlay = new kakao.maps.CustomOverlay({
              position: position,
              content: hoverContent,
              yAnchor: 1.1,
              xAnchor: 0.5,
              zIndex: 12
            });
            hoverOverlay.setMap(childrenMap);
          });

          kakao.maps.event.addListener(marker, 'mouseout', function() {
            if (hoverOverlay) {
              hoverOverlay.setMap(null);
              hoverOverlay = null;
            }
          });
        }
      });

      // 모든 어린이 도서관이 보이도록 지도 범위 조정
      if (childrenLibraries.length > 0) {
        childrenMap.setBounds(bounds);
      }
    });
  }


  // 장르별 대출 랭킹 초기화
  function initializeGenreRanking(childrenLibraries) {
    // 장르 목록 정의 (CSV 컬럼명과 매칭)
    const genres = ['총류', '철학', '종교', '사회과학', '순수과학', '기술과학', '예술', '언어', '문학', '역사'];
    
    // 각 도서관의 장르별 대출 데이터 추출
    const librariesWithGenreData = childrenLibraries.map(lib => {
      const genreData = {};
      let totalCheckouts = 0;
      
      genres.forEach(genre => {
        // CSV 컬럼명: 인쇄자료_어린이_총류, 인쇄자료_어린이_철학 등
        const checkouts = parseInt(lib[`인쇄자료_어린이_${genre}`]) || 0;
        genreData[genre] = checkouts;
        totalCheckouts += checkouts;
      });
      
      return {
        ...lib,
        genreData,
        totalChildrenCheckouts: totalCheckouts
      };
    }).filter(lib => lib.totalChildrenCheckouts > 0); // 대출 기록이 있는 도서관만

    // 전역 변수에 저장
    window.childrenGenreData = librariesWithGenreData;
    window.genreList = genres;
    
    // 탭 이벤트 설정
    setupGenreTabs();
    
    // 초기 전체 랭킹 표시
    showGenreRanking('total');
  }

  // 장르 탭 설정
  function setupGenreTabs() {
    const tabs = document.querySelectorAll('.genre-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // 모든 탭에서 active 클래스 제거
        tabs.forEach(t => t.classList.remove('active'));
        // 클릭된 탭에 active 클래스 추가
        tab.classList.add('active');
        // 해당 장르 랭킹 표시 (자동 스크롤 활성화)
        showGenreRanking(tab.dataset.genre, true);
      });
    });
  }

  // 장르별 랭킹 표시
  function showGenreRanking(genre, autoScroll = false) {
    const container = document.getElementById('genreRankingList');
    if (!container || !window.childrenGenreData) return;

    let sortedLibraries;
    
    if (genre === 'total') {
      // 전체 어린이 대출 수 기준 정렬
      sortedLibraries = [...window.childrenGenreData]
        .sort((a, b) => b.totalChildrenCheckouts - a.totalChildrenCheckouts);
    } else {
      // 특정 장르 대출 수 기준 정렬
      sortedLibraries = [...window.childrenGenreData]
        .sort((a, b) => (b.genreData[genre] || 0) - (a.genreData[genre] || 0))
        .filter(lib => (lib.genreData[genre] || 0) > 0); // 해당 장르 대출이 있는 도서관만
    }

    // 상위 10개만 표시
    const topLibraries = sortedLibraries.slice(0, 10);
    
    if (topLibraries.length === 0) {
      container.innerHTML = '<div class="no-data">해당 장르의 대출 데이터가 없습니다.</div>';
      return;
    }

    const maxCount = topLibraries[0][genre === 'total' ? 'totalChildrenCheckouts' : 'genreData'][genre === 'total' ? undefined : genre];
    const maxValue = genre === 'total' ? topLibraries[0].totalChildrenCheckouts : topLibraries[0].genreData[genre];

    container.innerHTML = topLibraries.map((lib, index) => {
      const checkoutCount = genre === 'total' 
        ? lib.totalChildrenCheckouts 
        : (lib.genreData[genre] || 0);
      
      const percentage = genre === 'total' 
        ? 100 
        : Math.round((lib.genreData[genre] || 0) / lib.totalChildrenCheckouts * 100);

      const barWidth = (checkoutCount / maxValue) * 100;

      return `
        <div class="genre-ranking-item">
          <div class="ranking-info">
            <span class="rank-number">${index + 1}</span>
            <div class="library-info">
              <div class="library-name">${lib.name}</div>
              <div class="checkout-stats">
                <span class="checkout-count">${checkoutCount.toLocaleString()}권</span>
                ${genre !== 'total' ? `<span class="percentage">(${percentage}%)</span>` : ''}
              </div>
            </div>
          </div>
          <div class="ranking-bar">
            <div class="bar-fill" style="width: ${barWidth}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // 선택된 장르의 top 10 도서관들을 지도에 표시
    showChildrenLibrariesOnMap(topLibraries, genre);

    // 지도가 보이도록 자동 스크롤 (필터탭 클릭 시에만)
    if (autoScroll) {
      setTimeout(() => {
        const mapSection = document.querySelector('.children-map-section');
        if (mapSection) {
          mapSection.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 300); // 랭킹 렌더링 후 스크롤 실행
    }
  }

  // 어린이 장르별 top 10 도서관들을 지도에 표시하는 함수
  function showChildrenLibrariesOnMap(libraries, genre = '전체') {
    // 지도 컨테이너 확인
    const mapContainer = document.getElementById('childrenMapContainer');
    if (!mapContainer) return;

    // 지도가 로드되었는지 확인
    if (window.MapView && window.MapView.showFilteredLibraries) {
      if (libraries.length === 0) {
        // 도서관이 없으면 모든 도서관 표시
        window.MapView.showAllLibraries();
        return;
      }

      // 장르별 라벨 생성
      const genreLabels = {
        'total': '전체 어린이 대출 상위 10개 도서관',
        '총류': '어린이 총류 인쇄자료 대출 상위 10개 도서관',
        '철학': '어린이 철학 인쇄자료 대출 상위 10개 도서관',
        '종교': '어린이 종교 인쇄자료 대출 상위 10개 도서관',
        '사회과학': '어린이 사회과학 인쇄자료 대출 상위 10개 도서관',
        '순수과학': '어린이 순수과학 인쇄자료 대출 상위 10개 도서관',
        '기술과학': '어린이 기술과학 인쇄자료 대출 상위 10개 도서관',
        '예술': '어린이 예술 인쇄자료 대출 상위 10개 도서관',
        '언어': '어린이 언어 인쇄자료 대출 상위 10개 도서관',
        '문학': '어린이 문학 인쇄자료 대출 상위 10개 도서관',
        '역사': '어린이 역사 인쇄자료 대출 상위 10개 도서관'
      };

      const label = genreLabels[genre] || `${genre} 인쇄자료 대출 상위 10개 도서관`;
      
      // 지도에 필터링된 도서관들 표시
      if (window.MapView && MapView.render) MapView.render(libraries);
    } else {
      // 지도가 로드되지 않은 경우를 위한 대체 표시
      console.log(`${genre} 장르 top 10 도서관:`, libraries);
    }
  }

  // 전자자료 장르별 대출 랭킹 초기화
  function initializeElectronicRanking(childrenLibraries) {
    // 장르 목록 정의 (CSV 컬럼명과 매칭)
    const genres = ['총류', '철학', '종교', '사회과학', '순수과학', '기술과학', '예술', '언어', '문학', '역사'];
    
    // 각 도서관의 전자자료 장르별 대출 데이터 추출
    const librariesWithElectronicData = childrenLibraries.map(lib => {
      const electronicGenreData = {};
      let totalElectronicCheckouts = 0;
      
      genres.forEach(genre => {
        // CSV 컬럼명: 전자자료_어린이_총류, 전자자료_어린이_철학 등
        const checkouts = parseInt(lib[`전자자료_어린이_${genre}`]) || 0;
        electronicGenreData[genre] = checkouts;
        totalElectronicCheckouts += checkouts;
      });
      
      return {
        ...lib,
        electronicGenreData,
        totalElectronicCheckouts: totalElectronicCheckouts
      };
    }).filter(lib => lib.totalElectronicCheckouts > 0); // 전자자료 대출 기록이 있는 도서관만

    // 전역 변수에 저장
    window.childrenElectronicData = librariesWithElectronicData;
    window.electronicGenreList = genres;
    
    // 탭 이벤트 설정
    setupElectronicTabs();
    
    // 초기 전체 랭킹 표시
    showElectronicRanking('total');
  }

  // 전자자료 탭 설정
  function setupElectronicTabs() {
    const tabs = document.querySelectorAll('.electronic-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // 모든 탭에서 active 클래스 제거
        tabs.forEach(t => t.classList.remove('active'));
        // 클릭된 탭에 active 클래스 추가
        tab.classList.add('active');
        // 해당 장르 랭킹 표시
        showElectronicRanking(tab.dataset.genre);
      });
    });
  }


  
  // 새로운 랭킹 시스템 탭 설정
  function setupAdvancedRankingTabs() {
    // 국내서/국외서 랭킹 탭
    document.querySelectorAll('[data-type="domestic"], [data-type="foreign"]').forEach(tab => {
      tab.addEventListener('click', function() {
        const type = this.getAttribute('data-type');
        const genre = this.getAttribute('data-genre');
        
        // 활성 탭 변경
        document.querySelectorAll(`[data-type="${type}"]`).forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // 해당 랭킹 표시
        if (type === 'domestic') {
          showDomesticRanking(genre);
        } else {
          showForeignRanking(genre);
        }
      });
    });
    
    // 연령대별 랭킹 탭
    document.querySelectorAll('[data-type="print"], [data-type="electronic"]').forEach(tab => {
      tab.addEventListener('click', function() {
        const type = this.getAttribute('data-type');
        const age = this.getAttribute('data-age');
        
        // 활성 탭 변경
        document.querySelectorAll(`[data-type="${type}"]`).forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // 해당 랭킹 표시
        if (type === 'print') {
          showPrintAgeRanking(age);
        } else {
          showElectronicAgeRanking(age);
        }
      });
    });
  }
  
  // 국내서 랭킹 표시
  function showDomesticRanking(genre) {
    const allLibs = allLibraries.length ? allLibraries : sampleLibraries;
    const rankingList = document.getElementById('domesticRankingList');
    
    if (!rankingList) return;
    
    let sortedLibraries = [];
    
    if (genre === 'total') {
      // 전체 국내서 대출량 기준으로 정렬
      sortedLibraries = allLibs
        .filter(lib => {
          const total = (lib.국내서_총류 || 0) + (lib.국내서_철학 || 0) + (lib.국내서_종교 || 0) + 
                       (lib.국내서_사회과학 || 0) + (lib.국내서_순수과학 || 0) + (lib.국내서_기술과학 || 0) + 
                       (lib.국내서_예술 || 0) + (lib.국내서_언어 || 0) + (lib.국내서_문학 || 0) + (lib.국내서_역사 || 0);
          return total > 0;
        })
        .sort((a, b) => {
          const totalA = (a.국내서_총류 || 0) + (a.국내서_철학 || 0) + (a.국내서_종교 || 0) + 
                        (a.국내서_사회과학 || 0) + (a.국내서_순수과학 || 0) + (a.국내서_기술과학 || 0) + 
                        (a.국내서_예술 || 0) + (a.국내서_언어 || 0) + (a.국내서_문학 || 0) + (a.국내서_역사 || 0);
          const totalB = (b.국내서_총류 || 0) + (b.국내서_철학 || 0) + (b.국내서_종교 || 0) + 
                        (b.국내서_사회과학 || 0) + (b.국내서_순수과학 || 0) + (b.국내서_기술과학 || 0) + 
                        (b.국내서_예술 || 0) + (b.국내서_언어 || 0) + (b.국내서_문학 || 0) + (b.국내서_역사 || 0);
          return totalB - totalA;
        });
    } else {
      // 특정 장르 기준으로 정렬
      const genreKey = `국내서_${genre}`;
      sortedLibraries = allLibs
        .filter(lib => lib[genreKey] > 0)
        .sort((a, b) => b[genreKey] - a[genreKey]);
    }
    
    // 상위 10개 도서관 표시
    const top10 = sortedLibraries.slice(0, 10);
    
    rankingList.innerHTML = top10.map((lib, index) => {
      const rank = index + 1;
      const usageRate = genre === 'total' ? 
        (lib.국내서_총류 || 0) + (lib.국내서_철학 || 0) + (lib.국내서_종교 || 0) + 
        (lib.국내서_사회과학 || 0) + (lib.국내서_순수과학 || 0) + (lib.국내서_기술과학 || 0) + 
        (lib.국내서_예술 || 0) + (lib.국내서_언어 || 0) + (lib.국내서_문학 || 0) + (lib.국내서_역사 || 0) :
        lib[`국내서_${genre}`];
      
      return `
        <div class="ranking-item">
          <span class="ranking-number">${rank}</span>
          <div class="ranking-info">
            <div class="ranking-library-name">${lib.name}</div>
            <div class="ranking-detail">${genre === 'total' ? '전체 국내서' : `${genre} 장르`}: ${usageRate.toLocaleString()}권</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // 국외서 랭킹 표시
  function showForeignRanking(genre) {
    const allLibs = allLibraries.length ? allLibraries : sampleLibraries;
    const rankingList = document.getElementById('foreignRankingList');
    
    if (!rankingList) return;
    
    let sortedLibraries = [];
    
    if (genre === 'total') {
      // 전체 국외서 대출량 기준으로 정렬
      sortedLibraries = allLibs
        .filter(lib => {
          const total = (lib.국외서_총류 || 0) + (lib.국외서_철학 || 0) + (lib.국외서_종교 || 0) + 
                       (lib.국외서_사회과학 || 0) + (lib.국외서_순수과학 || 0) + (lib.국외서_기술과학 || 0) + 
                       (lib.국외서_예술 || 0) + (lib.국외서_언어 || 0) + (lib.국외서_문학 || 0) + (lib.국외서_역사 || 0);
          return total > 0;
        })
        .sort((a, b) => {
          const totalA = (a.국외서_총류 || 0) + (a.국외서_철학 || 0) + (a.국외서_종교 || 0) + 
                        (a.국외서_사회과학 || 0) + (a.국외서_순수과학 || 0) + (a.국외서_기술과학 || 0) + 
                        (a.국외서_예술 || 0) + (a.국외서_언어 || 0) + (a.국외서_문학 || 0) + (a.국외서_역사 || 0);
          const totalB = (b.국외서_총류 || 0) + (b.국외서_철학 || 0) + (b.국외서_종교 || 0) + 
                        (b.국외서_사회과학 || 0) + (b.국외서_순수과학 || 0) + (b.국외서_기술과학 || 0) + 
                        (b.국외서_예술 || 0) + (b.국외서_언어 || 0) + (b.국외서_문학 || 0) + (b.국외서_역사 || 0);
          return totalB - totalA;
        });
    } else {
      // 특정 장르 기준으로 정렬
      const genreKey = `국외서_${genre}`;
      sortedLibraries = allLibs
        .filter(lib => lib[genreKey] > 0)
        .sort((a, b) => b[genreKey] - a[genreKey]);
    }
    
    // 상위 10개 도서관 표시
    const top10 = sortedLibraries.slice(0, 10);
    
    rankingList.innerHTML = top10.map((lib, index) => {
      const rank = index + 1;
      const usageRate = genre === 'total' ? 
        (lib.국외서_총류 || 0) + (lib.국외서_철학 || 0) + (lib.국외서_종교 || 0) + 
        (lib.국외서_사회과학 || 0) + (lib.국외서_순수과학 || 0) + (lib.국외서_기술과학 || 0) + 
        (lib.국외서_예술 || 0) + (lib.국외서_언어 || 0) + (lib.국외서_문학 || 0) + (lib.국외서_역사 || 0) :
        lib[`국외서_${genre}`];
      
      return `
        <div class="ranking-item">
          <span class="ranking-number">${rank}</span>
          <div class="ranking-info">
            <div class="ranking-library-name">${lib.name}</div>
            <div class="ranking-detail">${genre === 'total' ? '전체 국외서' : `${genre} 장르`}: ${usageRate.toLocaleString()}권</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // 인쇄자료 연령대별 랭킹 표시
  function showPrintAgeRanking(age) {
    const allLibs = allLibraries.length ? allLibraries : sampleLibraries;
    const rankingList = document.getElementById('printAgeRankingList');
    
    if (!rankingList) return;
    
    // 연령대별 장르 키 생성
    const ageKey = `인쇄자료_${age}`;
    
    // 해당 연령대의 모든 장르 대출량 합계로 정렬
    const sortedLibraries = allLibs
      .filter(lib => {
        const total = (lib[`${ageKey}_총류`] || 0) + (lib[`${ageKey}_철학`] || 0) + (lib[`${ageKey}_종교`] || 0) + 
                     (lib[`${ageKey}_사회과학`] || 0) + (lib[`${ageKey}_순수과학`] || 0) + (lib[`${ageKey}_기술과학`] || 0) + 
                     (lib[`${ageKey}_예술`] || 0) + (lib[`${ageKey}_언어`] || 0) + (lib[`${ageKey}_문학`] || 0) + (lib[`${ageKey}_역사`] || 0);
        return total > 0;
      })
      .sort((a, b) => {
        const totalA = (a[`${ageKey}_총류`] || 0) + (a[`${ageKey}_철학`] || 0) + (a[`${ageKey}_종교`] || 0) + 
                      (a[`${ageKey}_사회과학`] || 0) + (a[`${ageKey}_순수과학`] || 0) + (a[`${ageKey}_기술과학`] || 0) + 
                      (a[`${ageKey}_예술`] || 0) + (a[`${ageKey}_언어`] || 0) + (a[`${ageKey}_문학`] || 0) + (a[`${ageKey}_역사`] || 0);
        const totalB = (b[`${ageKey}_총류`] || 0) + (b[`${ageKey}_철학`] || 0) + (b[`${ageKey}_종교`] || 0) + 
                      (b[`${ageKey}_사회과학`] || 0) + (b[`${ageKey}_순수과학`] || 0) + (b[`${ageKey}_기술과학`] || 0) + 
                      (b[`${ageKey}_예술`] || 0) + (b[`${ageKey}_언어`] || 0) + (b[`${ageKey}_문학`] || 0) + (b[`${ageKey}_역사`] || 0);
        return totalB - totalA;
      });
    
    // 상위 10개 도서관 표시
    const top10 = sortedLibraries.slice(0, 10);
    
    rankingList.innerHTML = top10.map((lib, index) => {
      const rank = index + 1;
      const totalUsage = (lib[`${ageKey}_총류`] || 0) + (lib[`${ageKey}_철학`] || 0) + (lib[`${ageKey}_종교`] || 0) + 
                        (lib[`${ageKey}_사회과학`] || 0) + (lib[`${ageKey}_순수과학`] || 0) + (lib[`${ageKey}_기술과학`] || 0) + 
                        (lib[`${ageKey}_예술`] || 0) + (lib[`${ageKey}_언어`] || 0) + (lib[`${ageKey}_문학`] || 0) + (lib[`${ageKey}_역사`] || 0);
      
      return `
        <div class="ranking-item">
          <span class="ranking-number">${rank}</span>
          <div class="ranking-info">
            <div class="ranking-library-name">${lib.name}</div>
            <div class="ranking-detail">${age} 인쇄자료: ${totalUsage.toLocaleString()}권</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // 전자자료 연령대별 랭킹 표시
  function showElectronicAgeRanking(age) {
    const allLibs = allLibraries.length ? allLibraries : sampleLibraries;
    const rankingList = document.getElementById('electronicAgeRankingList');
    
    if (!rankingList) return;
    
    // 연령대별 장르 키 생성
    const ageKey = `전자자료_${age}`;
    
    // 해당 연령대의 모든 장르 대출량 합계로 정렬
    const sortedLibraries = allLibs
      .filter(lib => {
        const total = (lib[`${ageKey}_총류`] || 0) + (lib[`${ageKey}_철학`] || 0) + (lib[`${ageKey}_종교`] || 0) + 
                     (lib[`${ageKey}_사회과학`] || 0) + (lib[`${ageKey}_순수과학`] || 0) + (lib[`${ageKey}_기술과학`] || 0) + 
                     (lib[`${ageKey}_예술`] || 0) + (lib[`${ageKey}_언어`] || 0) + (lib[`${ageKey}_문학`] || 0) + (lib[`${ageKey}_역사`] || 0);
        return total > 0;
      })
      .sort((a, b) => {
        const totalA = (a[`${ageKey}_총류`] || 0) + (a[`${ageKey}_철학`] || 0) + (a[`${ageKey}_종교`] || 0) + 
                      (a[`${ageKey}_사회과학`] || 0) + (a[`${ageKey}_순수과학`] || 0) + (a[`${ageKey}_기술과학`] || 0) + 
                      (a[`${ageKey}_예술`] || 0) + (a[`${ageKey}_언어`] || 0) + (a[`${ageKey}_문학`] || 0) + (a[`${ageKey}_역사`] || 0);
        const totalB = (b[`${ageKey}_총류`] || 0) + (b[`${ageKey}_철학`] || 0) + (b[`${ageKey}_종교`] || 0) + 
                      (b[`${ageKey}_사회과학`] || 0) + (b[`${ageKey}_순수과학`] || 0) + (b[`${ageKey}_기술과학`] || 0) + 
                      (b[`${ageKey}_예술`] || 0) + (b[`${ageKey}_언어`] || 0) + (b[`${ageKey}_문학`] || 0) + (b[`${ageKey}_역사`] || 0);
        return totalB - totalA;
      });
    
    // 상위 10개 도서관 표시
    const top10 = sortedLibraries.slice(0, 10);
    
    rankingList.innerHTML = top10.map((lib, index) => {
      const rank = index + 1;
      const totalUsage = (lib[`${ageKey}_총류`] || 0) + (lib[`${ageKey}_철학`] || 0) + (lib[`${ageKey}_종교`] || 0) + 
                        (lib[`${ageKey}_사회과학`] || 0) + (lib[`${ageKey}_순수과학`] || 0) + (lib[`${ageKey}_기술과학`] || 0) + 
                        (lib[`${ageKey}_예술`] || 0) + (lib[`${ageKey}_언어`] || 0) + (lib[`${ageKey}_문학`] || 0) + (lib[`${ageKey}_역사`] || 0);
      
      return `
        <div class="ranking-item">
          <span class="ranking-number">${rank}</span>
          <div class="ranking-info">
            <div class="ranking-library-name">${lib.name}</div>
            <div class="ranking-detail">${age} 전자자료: ${totalUsage.toLocaleString()}건</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // 전자자료 장르별 랭킹 표시
  function showElectronicRanking(genre) {
    const container = document.getElementById('electronicRankingList');
    if (!container || !window.childrenElectronicData) return;

    let sortedLibraries;
    
    if (genre === 'total') {
      // 전체 어린이 전자자료 대출 수 기준 정렬
      sortedLibraries = [...window.childrenElectronicData]
        .sort((a, b) => b.totalElectronicCheckouts - a.totalElectronicCheckouts);
    } else {
      // 특정 장르 전자자료 대출 수 기준 정렬
      sortedLibraries = [...window.childrenElectronicData]
        .sort((a, b) => (b.electronicGenreData[genre] || 0) - (a.electronicGenreData[genre] || 0))
        .filter(lib => (lib.electronicGenreData[genre] || 0) > 0); // 해당 장르 대출이 있는 도서관만
    }

    // 상위 10개만 표시
    const topLibraries = sortedLibraries.slice(0, 10);
    
    if (topLibraries.length === 0) {
      container.innerHTML = '<div class="no-data">해당 장르의 전자자료 대출 데이터가 없습니다.</div>';
      return;
    }

    const maxValue = genre === 'total' ? topLibraries[0].totalElectronicCheckouts : topLibraries[0].electronicGenreData[genre];

    container.innerHTML = topLibraries.map((lib, index) => {
      const checkoutCount = genre === 'total' 
        ? lib.totalElectronicCheckouts 
        : (lib.electronicGenreData[genre] || 0);
      
      const percentage = genre === 'total' 
        ? 100 
        : Math.round((lib.electronicGenreData[genre] || 0) / lib.totalElectronicCheckouts * 100);

      const barWidth = (checkoutCount / maxValue) * 100;

      return `
        <div class="electronic-ranking-item">
          <div class="ranking-info">
            <span class="rank-number electronic-rank">${index + 1}</span>
            <div class="library-info">
              <div class="library-name">${lib.name}</div>
              <div class="checkout-stats">
                <span class="checkout-count">${checkoutCount.toLocaleString()}건</span>
                ${genre !== 'total' ? `<span class="percentage">(${percentage}%)</span>` : ''}
              </div>
            </div>
          </div>
          <div class="ranking-bar">
            <div class="bar-fill electronic-bar" style="width: ${barWidth}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// 어린이 보유도서 계산 함수 (모달에서 사용)
function calculateChildrenHoldings(library) {
  let totalChildrenHoldings = 0;
  
  // 인쇄자료 어린이 도서 합산
  const printGenres = ['총류', '철학', '종교', '사회과학', '순수과학', '기술과학', '예술', '언어', '문학', '역사'];
  printGenres.forEach(genre => {
    totalChildrenHoldings += (library[`인쇄자료_어린이_${genre}`] || 0);
  });
  
  // 전자자료 어린이 도서 합산
  const electronicGenres = ['총류', '철학', '종교', '사회과학', '순수과학', '기술과학', '예술', '언어', '문학', '역사'];
  electronicGenres.forEach(genre => {
    totalChildrenHoldings += (library[`전자자료_어린이_${genre}`] || 0);
  });
  
  return totalChildrenHoldings;
}

// 어린이 도서관 모달 표시
function showChildrenLibraryModal(index) {
  const lib = window.childrenLibrariesData[index];
  if (!lib) {
    console.error('도서관 데이터를 찾을 수 없습니다:', index);
    return;
  }
  
  console.log('모달에 표시할 도서관 데이터:', lib);
  console.log('어린이 보유도서:', calculateChildrenHoldings(lib));

  const modalHTML = `
    <div class="children-modal-overlay" id="childrenModalOverlay" onclick="closeChildrenModal()">
      <div class="children-modal-content" onclick="event.stopPropagation()">
        <div class="children-modal-header">
          <h3>👶 ${lib.name}</h3>
          <button class="children-modal-close" onclick="closeChildrenModal()" type="button">&times;</button>
        </div>
        <div class="children-modal-body">
          <div class="children-modal-info">
            <div class="info-row">
              <span class="info-label">📍 주소</span>
              <span class="info-value">${lib.address}</span>
            </div>
            <div class="info-row">
              <span class="info-label">📞 연락처</span>
              <span class="info-value">${lib.phone || '정보 없음'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">🪑 어린이 좌석</span>
              <span class="info-value">${lib.seatsChild || 0}석</span>
            </div>
            <div class="info-row">
              <span class="info-label">🪑 총 좌석</span>
              <span class="info-value">${lib.seatsTotal || 0}석</span>
            </div>
            <div class="info-row">
              <span class="info-label">📚 어린이 보유도서</span>
              <span class="info-value">${calculateChildrenHoldings(lib).toLocaleString()}권</span>
            </div>
            <div class="info-row">
              <span class="info-label">🕐 운영시간</span>
              <span class="info-value">${lib.개관시간 || '정보 없음'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 기존 모달이 있다면 제거
  const existingModal = document.getElementById('childrenModalOverlay');
  if (existingModal) {
    existingModal.remove();
  }
  
  // 새 모달 삽입
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // 모달 애니메이션
  setTimeout(() => {
    const overlay = document.getElementById('childrenModalOverlay');
    if (overlay) {
      overlay.classList.add('show');
      console.log('모달이 성공적으로 표시되었습니다!');
    } else {
      console.error('모달 요소를 찾을 수 없습니다!');
    }
  }, 10);
}

// 어린이 도서관 모달 닫기
function closeChildrenModal() {
  console.log('모달 닫기 함수 호출됨');
  const overlay = document.getElementById('childrenModalOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.remove();
      console.log('모달이 제거되었습니다.');
    }, 300);
  } else {
    console.error('닫을 모달을 찾을 수 없습니다!');
  }
}

// 어린이 도서관 아이템 스타일 추가
function addChildrenItemStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .children-library-item {
      background: rgba(255, 255, 255, 0.8);
      padding: 1rem;
      margin: 1rem 0;
      border-radius: 10px;
      border: 1px solid rgba(139, 94, 60, 0.2);
    }
    .children-library-item h4 {
      margin: 0 0 0.5rem 0;
      color: #8b5e3c;
    }
    .children-library-item p {
      margin: 0.25rem 0;
      opacity: 0.8;
    }
    .children-stats-inline {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;
      font-size: 0.9rem;
    }
    .children-stats-inline span {
      background: rgba(139, 94, 60, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 15px;
    }
  `;
  document.head.appendChild(style);
}

function initializeUI() {
  const mapEl = document.getElementById('map');
  if (mapEl && !mapEl.querySelector('.map-empty-msg')) {
    const msg = document.createElement('div');
    msg.className = 'map-empty-msg';
    msg.textContent = '지도 영역 (임시) · 다음 단계에서 통합 예정';
    mapEl.appendChild(msg);
  }
}

function initializeEventListeners() {
  document.getElementById('searchBtn').addEventListener('click', () => { clearFiltersExcept(new Set(['search'])); applyFilters(); });
  document.getElementById('searchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') { clearFiltersExcept(new Set(['search'])); applyFilters(); } });
  
  // 전체 구 필터 이벤트 - 연령대 필터 초기화
  document.getElementById('districtFilter').addEventListener('change', (e) => {
    // 구역-정렬 조합만 허용 → district 변경 시 나머지 모두 초기화(정렬은 유지 가능)
    clearFiltersExcept(new Set(['district', 'sort']));
    applyFilters();
  });

  // 정렬 필터 이벤트 - 연령대 필터 초기화
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    sortKey = e.target.value;
    // 구역-정렬 조합만 허용 → sort 변경 시 나머지 초기화(구역은 유지)
    clearFiltersExcept(new Set(['district', 'sort']));
    applyFilters();
  });

  document.querySelector('.close').addEventListener('click', closeModal);
  window.addEventListener('click', (e) => { if (e.target === document.getElementById('detailModal')) closeModal(); });

  // 고급 필터 이벤트
  document.getElementById('ageFocus').addEventListener('change', (e) => { 
    window.ageFocus = e.target.value; // 전역 변수로 설정
    
    // 연령대 단독(다른 모든 필터와 배타) → 다른 모든 필터 초기화
    if (e.target.value) {
      clearFiltersExcept(new Set(['age']));
    }
    
    applyFilters(); 
  });

  // 뷰 전환 버튼 제거됨: 리스트는 기본형으로 고정
}

  // 쾌적함별 지도 필터링 함수 (지도 표시 상태만 유지)
  function filterLibrariesByComfort(comfortLevel) {
    if (!comfortLevel || comfortLevel === 'total') {
      if (window.MapView && MapView.showAllLibraries) { MapView.showAllLibraries(); }
      return;
    }
    // 사분위 기반 등급이 계산되어 있지 않다면 재계산
    if (!window.comfortQuantiles) computeAndAssignComfortQuartiles(allLibraries);
    // 해당 쾌적함 등급의 도서관 필터링(등급은 사분위로 부여됨)
    const filteredLibraries = allLibraries.filter(lib => lib.comfortLevel === comfortLevel);
    
    // 지도에 필터링된 도서관만 표시
    if (window.MapView) {
      const comfortLabels = {
        '매우좋음': '매우 쾌적한 도서관',
        '좋음': '쾌적한 도서관',
        '보통': '보통 쾌적함 도서관',
        '좁음': '좁은 도서관'
      };
      // 지도 측 필터 상태만 전달 (데이터는 applyFilters에서 렌더)
      if (MapView.setComfortFilter) {
        MapView.setComfortFilter(comfortLevel);
      }
    }
    
    // 리스트는 applyFilters에서 처리. 지도는 선택 상태만 반영
  }

  // 장르별 지도 필터링 함수
  function filterLibrariesByGenre(bookType, genre) {
  if (!genre || genre === 'total') {
    // 전체 선택시 모든 도서관 표시
    selectedGenre = '';
    selectedBookTypeForMap = '';
    window.activeBookGenre = null;
    window.activeBookType = null;
    if (window.MapView) {
      MapView.showAllLibraries();
    }
    
    // 도서관 목록도 전체로 복원
    libraries = allLibraries;
    displayLibraries();
    return;
  }
  
  selectedGenre = genre;
  selectedBookTypeForMap = bookType;
  window.activeBookGenre = genre;
  window.activeBookType = bookType;
  
  // 해당 장르의 비율이 높은 도서관 10개 선택
  const filteredLibraries = allLibraries
    .filter(lib => {
      if (bookType === 'domestic') {
        const totalDomestic = lib.holdingsDomestic || 0;
        const genreValue = lib.domesticCategories?.find(cat => cat.name === genre)?.value || 0;
        return totalDomestic > 0 && genreValue > 0;
      } else if (bookType === 'foreign') {
        const totalForeign = lib.holdingsForeign || 0;
        const genreValue = lib.foreignCategories?.find(cat => cat.name === genre)?.value || 0;
        return totalForeign > 0 && genreValue > 0;
      }
      return false;
    })
    .map(lib => {
      if (bookType === 'domestic') {
        const genreValue = lib.domesticCategories?.find(cat => cat.name === genre)?.value || 0;
        return { ...lib, genreCount: genreValue };
      } else if (bookType === 'foreign') {
        const genreValue = lib.foreignCategories?.find(cat => cat.name === genre)?.value || 0;
        return { ...lib, genreCount: genreValue };
      }
      return lib;
    })
    // 절대 수량이 많은 순으로 정렬 후 Top 10
    .sort((a, b) => (b.genreCount || 0) - (a.genreCount || 0))
    .slice(0, 10);
  
  // 지도에 필터링된 도서관만 표시
  if (window.MapView) {
    if (window.MapView && MapView.render) MapView.render(filteredLibraries);
  }
  
  // 도서관 목록도 함께 업데이트
  libraries = filteredLibraries;
  displayLibraries();
}

function setupCategoryChips() {
  const container = document.querySelector('.category-bar');
  if (!container) return;
  
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    
    const type = btn.dataset.type;
    const value = btn.dataset.value;
    
    if (type === 'bookType') {
      // 1단계: 국내서/국외서 선택
      handleBookTypeSelection(btn, value);
    } else if (type === 'book') {
      // 2단계: 세부 분류 단일 선택 (중복 불가) + 절대 수량 Top10
      clearFiltersExcept(new Set(['book']));
      const wasActive = btn.classList.contains('active');
      document.querySelectorAll('[data-type="book"]').forEach(ch=>ch.classList.remove('active'));
      selectedBookCategories.clear();
      if (wasActive) {
        filterLibrariesByGenre(selectedBookType, 'total');
        window.activeBookGenre = null;
        window.activeBookType = null;
        applyFilters();
        return;
      }
      btn.classList.add('active');
      selectedBookCategories.add(value);
      if (!selectedBookType) selectedBookType = 'domestic';
      window.activeBookGenre = value;
      window.activeBookType = selectedBookType;
      filterLibrariesByGenre(selectedBookType, value);
      applyFilters();
    } else if (type === 'electronic') {
      // 전자자료: 단일 선택(중복 불가) + 절대 수량 Top10
      clearFiltersExcept(new Set(['electronic']));
      // 전자자료 선택 시 도서종류 컨텍스트 초기화 (호버카드 혼재 방지)
      window.activeBookGenre = null;
      window.activeBookType = null;
      const wasActive = btn.classList.contains('active');
      document.querySelectorAll('[data-type="electronic"]').forEach(ch=>ch.classList.remove('active'));
      selectedElectronicCategories.clear();
      if (wasActive) { window.activeElectronicCategory = null; applyFilters(); return; }
      btn.classList.add('active');
      selectedElectronicCategories.add(value);
      window.activeElectronicCategory = value;
      applyFilters();
          } else if (type === 'study') {
        // 좌석혼잡도 카테고리: 단일 선택(중복 불가). 쾌적함과는 독립.
        // 혼잡도-쾌적함만 AND 허용 → study 선택 시 다른 모든 필터 초기화, 쾌적함은 유지/병행 가능
        clearFiltersExcept(new Set(['study','comfort']));
        const studyChips = document.querySelectorAll('[data-type="study"]');
        const wasActive = btn.classList.contains('active');
        // 모두 초기화
        studyChips.forEach(chip => chip.classList.remove('active'));
        if (!window.selectedStudyCategories) window.selectedStudyCategories = new Set();
        window.selectedStudyCategories.clear();
        // 새로 선택 (이미 활성 상태였으면 토글 해제 상태 유지)
        if (!wasActive) {
          btn.classList.add('active');
          window.selectedStudyCategories.add(value);
        }
        applyFilters();
    } else if (type === 'comfort') {
      // 쾌적함: 단일 선택 + 토글 가능
      // 혼잡도-쾌적함만 AND 허용 → comfort 선택 시 다른 모든 필터 초기화, 혼잡도는 유지/병행 가능
      clearFiltersExcept(new Set(['comfort','study']));
      const comfortChips = document.querySelectorAll('[data-type="comfort"]');
      const wasActive = btn.classList.contains('active');
      comfortChips.forEach(chip => chip.classList.remove('active'));
      selectedComfortCategories.clear();
      if (!wasActive) {
        btn.classList.add('active');
        selectedComfortCategories.add(value);
        filterLibrariesByComfort(value);
      } else {
        // 해제
        filterLibrariesByComfort('total');
      }
      applyFilters();
    }
  });
}

// 전체 필터 상태 초기화 유틸리티. keepKeys: 유지할 그룹 키 집합
// 그룹 키: 'search','district','sort','age','study','comfort','book','electronic'
function clearFiltersExcept(keepKeys){
  // 검색어
  if (!keepKeys.has('search')) {
    const searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
  }
  // 구역/정렬
  if (!keepKeys.has('district')) {
    const d = document.getElementById('districtFilter'); if (d) d.value = '';
  }
  if (!keepKeys.has('sort')) {
    const s = document.getElementById('sortSelect'); if (s) s.value = '';
    sortKey = '';
  }
  // 연령
  if (!keepKeys.has('age')) {
    const age = document.getElementById('ageFocus'); if (age) age.value = '';
    window.ageFocus = '';
  }
  // 혼잡도
  if (!keepKeys.has('study')) {
    if (window.selectedStudyCategories) window.selectedStudyCategories.clear();
    document.querySelectorAll('[data-type="study"]')?.forEach(ch => ch.classList.remove('active'));
  }
  // 쾌적함
  if (!keepKeys.has('comfort')) {
    selectedComfortCategories.clear();
    document.querySelectorAll('[data-type="comfort"]')?.forEach(ch => ch.classList.remove('active'));
  }
  // 도서 종류
  if (!keepKeys.has('book')) {
    selectedBookType = '';
    selectedGenre = '';
    selectedBookTypeForMap = '';
    selectedBookCategories.clear();
    document.querySelectorAll('[data-type="bookType"]')?.forEach(ch => ch.classList.remove('active'));
    document.querySelectorAll('[data-type="book"]')?.forEach(ch => ch.classList.remove('active'));
    const subCat = document.getElementById('bookSubcategoryContainer'); if (subCat) subCat.style.display = 'none';
    // 호버카드 컨텍스트 초기화
    window.activeBookGenre = null;
    window.activeBookType = null;
  }
  // 전자자료
  if (!keepKeys.has('electronic')) {
    selectedElectronicCategories.clear();
    document.querySelectorAll('[data-type="electronic"]')?.forEach(ch => ch.classList.remove('active'));
    // 호버카드 컨텍스트 초기화
    window.activeElectronicCategory = null;
  }
}
function handleBookTypeSelection(btn, value) {
  const subcategoryContainer = document.getElementById('bookSubcategoryContainer');
  const allBookTypeChips = document.querySelectorAll('[data-type="bookType"]');
  
  // 다른 bookType 버튼들 비활성화
  allBookTypeChips.forEach(chip => chip.classList.remove('active'));
  
  if (selectedBookType === value) {
    // 같은 버튼을 다시 클릭한 경우 - 선택 해제
    selectedBookType = '';
    subcategoryContainer.style.display = 'none';
    // 세부 카테고리도 모두 해제
    selectedBookCategories.clear();
    document.querySelectorAll('[data-type="book"]').forEach(chip => chip.classList.remove('active'));
    // 지도에 모든 도서관 표시
    filterLibrariesByGenre('', 'total');
  } else {
    // 새로운 버튼 선택
    selectedBookType = value;
    btn.classList.add('active');
    subcategoryContainer.style.display = 'block';
    // 이전 세부 카테고리 선택 해제
    selectedBookCategories.clear();
    document.querySelectorAll('[data-type="book"]').forEach(chip => chip.classList.remove('active'));
    // 지도에 모든 도서관 표시
    filterLibrariesByGenre('', 'total');
  }
  
  applyFilters();
}

function isOpenNow(library) {
  try {
    const now = new Date();
    const day = now.getDay();
    const dayStr = ['일','월','화','수','목','금','토'][day];
    const hhmm = now.toTimeString().slice(0,5);
    if (library.closedDays && library.closedDays.includes(dayStr)) return false;
    const segments = (library.openHours || '').split(',').map(s => s.trim());
    for (const seg of segments) {
      let applies = false;
      if (seg.includes('~')) {
        const [start, end] = seg.split(' ')[0].split('~');
        const days = ['일','월','화','수','목','금','토'];
        const si = days.indexOf(start), ei = days.indexOf(end), di = days.indexOf(dayStr);
        if (si !== -1 && ei !== -1 && di !== -1) applies = si <= ei ? (di >= si && di <= ei) : (di >= si || di <= ei);
      } else if (seg.includes('/')) {
        const ds = seg.split(' ')[0].split('/');
        applies = ds.includes(dayStr);
      } else {
        applies = seg.startsWith(dayStr);
      }
      if (!applies) continue;
      const timePart = seg.split(' ').find(t => t.includes(':')) || '';
      const [startTime, endTime] = timePart.split('-');
      if (!startTime || !endTime) continue;
      if (hhmm >= startTime && hhmm <= endTime) return true;
    }
    return false;
  } catch { return false; }
}

function applyFilters() {
  const term = document.getElementById('searchInput').value.toLowerCase().trim();
  const district = document.getElementById('districtFilter').value;
  let result = [...(allLibraries.length ? allLibraries : sampleLibraries)];

  // 지도 내부 쾌적함 필터 상태 보호: 선택된 쾌적함이 없으면 지도 내부 필터 해제
  if (!selectedComfortCategories || selectedComfortCategories.size === 0) {
    try { if (window.MapView && MapView.showAllLibraries) MapView.showAllLibraries(); } catch(_) {}
    window.comfortFilter = null;
  }

  // 기본 필터
  if (district) result = result.filter((l) => (l.district||'').includes(district));
  if (term) {
    result = result.filter((l) => (l.name||'').toLowerCase().includes(term) || (l.address||'').toLowerCase().includes(term) || (l.district||'').toLowerCase().includes(term));
  }
  // 국내서/국외서 및 세부 카테고리 필터 (요구사항: 선택 장르 보유 절대 수량 Top10만 표시)
  if (selectedBookType && selectedBookCategories.size > 0) {
    const genre = Array.from(selectedBookCategories)[0];
    // 각 도서관의 해당 장르 보유 절대 수량 계산
    const withCounts = result
      .map(l => {
        if (selectedBookType === 'domestic') {
          const val = (l.domesticCategoriesData||[]).find(c=>c.name===genre)?.value || 0;
          return { lib: l, count: val };
        } else {
          const val = (l.foreignCategoriesData||[]).find(c=>c.name===genre)?.value || 0;
          return { lib: l, count: val };
        }
      })
      .filter(x => x.count > 0)
      .sort((a,b)=>b.count-a.count)
      .slice(0,10)
      .map(x=>x.lib);
    result = withCounts;
  } else if (selectedBookCategories.size > 0) {
    // 타입 미선택 시에는 기존 bookCategories(상위) 포함 도서관만 (임시 유지)
    result = result.filter((l) => l.bookCategories && l.bookCategories.some((c) => selectedBookCategories.has(c)));
  }
  // 전자자료 카테고리 필터: 단일 선택 절대 수량 Top10
  if (selectedElectronicCategories.size > 0) {
    const selectedElectronic = Array.from(selectedElectronicCategories)[0];
    const baseForElectronic = [...(allLibraries.length ? allLibraries : sampleLibraries)];
    const withCounts = baseForElectronic
      .map(l => {
        const fromMap = (l.electronicData && (l.electronicData[selectedElectronic] || 0)) || 0;
        const fromProp = toNumber(l[selectedElectronic]);
        const count = fromMap || fromProp || 0;
        return { library: l, count };
      })
      .filter(x => x.count > 0)
      .sort((a,b) => b.count - a.count)
      .slice(0, 10);
    // Top10을 지도/호버카드와 일치하도록 per-item 카운트를 함께 전달
    result = withCounts.map(x => ({ ...x.library, __electronicCount: x.count }));
  }
  
  if (window.selectedStudyCategories && window.selectedStudyCategories.size > 0) {
    result = result.filter((l) => l.crowdingLevel && window.selectedStudyCategories.has(l.crowdingLevel));
  }
  // 쾌적함 카테고리 필터
  if (selectedComfortCategories.size > 0) {
    result = result.filter((l) => selectedComfortCategories.has(l.comfortLevel));
  }
  // openNowOnly filter removed (toggle deleted)

  if (window.ageFocus) {
    // 연령 필터는 항상 전체 도서관을 기준으로 계산 (초기화 후 필터링)
    const baseForAge = [...(allLibraries.length ? allLibraries : sampleLibraries)];
    // 연령별 회원등록자 수 비율 계산 및 상위 10개 선택
    const ageRatios = baseForAge
      .map((l) => {
        const childMembers = l.연령별회원등록자수_어린이 || 0;
        const teenMembers = l.연령별회원등록자수_청소년 || 0;
        const adultMembers = l.연령별회원등록자수_성인 || 0;
        const totalMembers = childMembers + teenMembers + adultMembers;
        let ratio = 0;
        if (window.ageFocus === 'child') {
          ratio = totalMembers > 0 ? childMembers / totalMembers : 0;
        } else if (window.ageFocus === 'teen') {
          ratio = totalMembers > 0 ? teenMembers / totalMembers : 0;
        } else if (window.ageFocus === 'adult') {
          ratio = totalMembers > 0 ? adultMembers / totalMembers : 0;
        }
        return { library: l, ratio, totalMembers };
      })
      // 데이터가 있는 도서관만 랭킹에 포함
      .filter(item => item.totalMembers > 0);
    
    // 디버깅: 비율 계산 결과 확인
    console.log('Age focus:', window.ageFocus);
    console.log('Age ratios (top 5):', ageRatios
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
      .map(item => ({
        name: item.library.name,
        ratio: item.ratio.toFixed(3),
        child: item.library.연령별회원등록자수_어린이 || 0,
        teen: item.library.연령별회원등록자수_청소년 || 0,
        adult: item.library.연령별회원등록자수_성인 || 0
      }))
    );
    
    // 비율 기준으로 내림차순 정렬 후 상위 10개 선택
    ageRatios.sort((a, b) => b.ratio - a.ratio);
    result = ageRatios.slice(0, 10).map(item => item.library);
  }


  // 정렬
  switch (sortKey) {
    case 'holdingsDesc': result.sort((a,b) => ((a.holdingsDomestic||0)+(a.holdingsForeign||0)) < ((b.holdingsDomestic||0)+(b.holdingsForeign||0)) ? 1 : -1); break;
    case 'visitorsDesc': result.sort((a,b) => (a.visitors||0) < (b.visitors||0) ? 1 : -1); break;
    case 'loansDesc': result.sort((a,b) => (a.loansPrintTotal||0) < (b.loansPrintTotal||0) ? 1 : -1); break;
    case 'seatsDesc': result.sort((a,b) => (a.seatsTotal||0) < (b.seatsTotal||0) ? 1 : -1); break;
    case 'areaDesc': result.sort((a,b) => (a.area||0) < (b.area||0) ? 1 : -1); break;
    case 'yearDesc': result.sort((a,b) => (a.yearOpened||0) < (b.yearOpened||0) ? 1 : -1); break;
    case 'yearAsc': result.sort((a,b) => (a.yearOpened||0) > (b.yearOpened||0) ? 1 : -1); break;
    default: break;
  }



  libraries = result;
  
  // ageFocus로 필터된 경우 전역 변수에 저장 (팝업에서 순위 계산용)
  if (window.ageFocus) {
    window.filteredLibraries = result;
  } else {
    window.filteredLibraries = null;
  }
  displayLibraries();
  // 지도 렌더 (파트너 모듈)
  if (window.MapView) MapView.render(libraries);
}

function displayLibraries() {
  const libraryList = document.getElementById('libraryList');
  const libraryListInner = document.getElementById('libraryListInner');
  
  if (!libraryListInner) return;
  
  // 업데이트 페이드 트랜지션
  libraryList.classList.add('fade-enter');
  libraryListInner.innerHTML = '';
  
  // 연령대 집중 필터가 선택된 경우 필터링된 도서관들만 표시
  let librariesToDisplay = libraries;
  if (window.ageFocus && window.filteredLibraries) {
    librariesToDisplay = window.filteredLibraries;
  }
  
  librariesToDisplay.forEach((library, idx) => {
    const libraryItem = createLibraryItem(library);
    libraryItem.style.animationDelay = `${Math.min(idx*60, 600)}ms`;
    libraryItem.classList.add('appear');
    libraryListInner.appendChild(libraryItem);
  });
  
  requestAnimationFrame(()=>{
    libraryList.classList.add('fade-enter-active');
    setTimeout(()=>{ libraryList.classList.remove('fade-enter','fade-enter-active'); }, 260);
  });
  // 지도는 applyFilters에서 한번에 렌더하므로 여기서는 생략
}

function createLibraryItem(library) {
  const div = document.createElement('div');
  div.className = 'library-item';
  div.dataset.id = library.id;
  const totalHoldings = (library.holdingsDomestic||0) + (library.holdingsForeign||0);
  const statusBadge = '';
  
  // 쾌적함 정보 표시
  const comfortInfo = library.comfortLevel && library.comfortLevel !== '정보없음' ? 
    `<div class="library-comfort" title="사람당 면적: ${library.comfortRatio?.toFixed(2)}㎡/명">
      <span class="comfort-label">쾌적함:</span>
      <span class="comfort-level comfort-${library.comfortLevel}">${library.comfortLevel}</span>
    </div>` : '';
  
  div.innerHTML = `
    <div class="library-name">${library.name}</div>
    <div class="library-info">
      <div>📍 ${library.address}</div>
      <div>📚 보유도서: ${totalHoldings.toLocaleString()}권</div>
      <div>🪑 좌석: ${library.seatsTotal?.toLocaleString?.() || '-'}석 · 🖥️ PC: ${library.pcs ?? '-'}</div>
    </div>
    ${comfortInfo}
    ${statusBadge}
  `;
  div.addEventListener('mouseenter', () => { selectLibrary(library); });
  return div;
}

function selectLibrary(library) {
  clearSelection();
  selectedLibrary = library;
  document.querySelectorAll('.library-item').forEach((item) => {
    item.classList.remove('selected');
    if (parseInt(item.dataset.id) === library.id) item.classList.add('selected');
  });
  showLibraryDetail(library);
  // 지도 마커 선택 반영 (파트너 모듈)
  if (window.MapView) MapView.select(library.id);
}

function clearSelection() {
  if (!selectedLibrary) return;
  selectedLibrary = null;
  document.querySelectorAll('.library-item').forEach((i) => i.classList.remove('selected'));
  // 지도 마커 선택 해제 (파트너 모듈)
  if (window.MapView) MapView.select(null);
}

function showLibraryDetail(library) {
  const modal = document.getElementById('detailModal');
  const modalContent = document.getElementById('modalContent');
  const totalHoldings = (library.holdingsDomestic||0) + (library.holdingsForeign||0);
  const isOpen = isOpenNow(library);
  modalContent.innerHTML = `
    <div class="library-detail">
      <h2>${library.name}</h2>
      <p style="color:#6b7280;margin-bottom:0.25rem;">${library.address}</p>
      <p style="color:#6b7280;margin-bottom:1rem;">☎️ ${library.phone || '-'} · 🔗 ${library.homepage ? `<a href="${library.homepage}" target="_blank" rel="noopener">홈페이지</a>` : '-'}</p>
      <div class="detail-section">
        <h4>🕘 운영 정보</h4>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">개관시간</div><div class="detail-value">${library.openHours || '-'}</div></div>
          <div class="detail-item"><div class="detail-label">휴관일</div><div class="detail-value">${library.closedDays || '-'}</div></div>
          <div class="detail-item"><div class="detail-label">현재 상태</div><div class="detail-value">${isOpen ? '운영중' : '운영 종료'}</div></div>
          <div class="detail-item"><div class="detail-label">개관년도</div><div class="detail-value">${library.yearOpened || '-'}</div></div>
        </div>
      </div>
      <div class="detail-section">
        <h4>📚 컬렉션</h4>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">국내서</div><div class="detail-value">${(library.holdingsDomestic||0).toLocaleString()}권</div></div>
          <div class="detail-item"><div class="detail-label">국외서</div><div class="detail-value">${(library.holdingsForeign||0).toLocaleString()}권</div></div>
          <div class="detail-item"><div class="detail-label">합계</div><div class="detail-value">${totalHoldings.toLocaleString()}권</div></div>
        </div>
      </div>
      <div class="detail-section">
        <h4>🪑 좌석/시설</h4>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">서비스 면적</div><div class="detail-value">${(library.area||0).toLocaleString()}㎡</div></div>
          <div class="detail-item"><div class="detail-label">총 좌석</div><div class="detail-value">${(library.seatsTotal||0).toLocaleString()}석</div></div>
          <div class="detail-item"><div class="detail-label">어린이 열람석</div><div class="detail-value">${(library.seatsChild||0).toLocaleString()}석</div></div>
          <div class="detail-item"><div class="detail-label">노인/장애인 열람석</div><div class="detail-value">${(library.seatsSeniorDisabled||0).toLocaleString()}석</div></div>
          <div class="detail-item"><div class="detail-label">이용자용 PC</div><div class="detail-value">${(library.pcs||0).toLocaleString()}대</div></div>
        </div>
      </div>
      <div class="detail-section">
        <h4>🏷️ 카테고리</h4>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
          ${library.bookCategories.map((c) => `<span style=\"background:#ede3d6;color:#5a3d26;padding:.35rem .6rem;border-radius:999px;font-size:.85rem;border:1px solid #d7c3a8;\">${c}</span>`).join('')}
          ${library.spaceCategories.map((c) => `<span style=\"background:#ecfdf5;color:#065f46;padding:.35rem .6rem;border-radius:999px;font-size:.85rem;border:1px solid #d1fae5;\">${c}</span>`).join('')}
        </div>
      </div>
      <div class="detail-section">
        <h4>📍 주변 시설</h4>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">🏠 주거시설</div><div class="detail-value">${library.nearby.residential.map((i) => `<div>• ${i}</div>`).join('')}</div></div>
          <div class="detail-item"><div class="detail-label">🏪 상가</div><div class="detail-value">${library.nearby.commercial.map((i) => `<div>• ${i}</div>`).join('')}</div></div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('detailModal').style.display = 'block';
  requestAnimationFrame(() => { const mc = document.querySelector('.modal-content'); if (mc) mc.classList.add('show'); });
  // charts/wordcloud 제거 요청에 따라 렌더 호출 중단
}

function closeModal() { const mc = document.querySelector('.modal-content'); if (mc) mc.classList.remove('show'); setTimeout(()=>{ document.getElementById('detailModal').style.display='none'; },150); }



// 차트 렌더링
let chartAge, chartUsage, chartHoldings, chartSubjectTop;
function renderCharts(l){
  const ageCtx = document.getElementById('chartAge');
  const usageCtx = document.getElementById('chartUsage');
  const holdCtx = document.getElementById('chartHoldings');
  const subjectCtx = document.getElementById('chartSubjectTop');
  if ((!ageCtx || !usageCtx || !holdCtx) || !window.Chart) return;
  chartAge && chartAge.destroy(); chartUsage && chartUsage.destroy(); chartHoldings && chartHoldings.destroy(); chartSubjectTop && chartSubjectTop.destroy();
  chartAge = new Chart(ageCtx, { type:'doughnut', data:{ labels:['어린이','청소년','성인'], datasets:[{ data:[l.loansPrintChild||0,l.loansPrintTeen||0,l.loansPrintAdult||0], backgroundColor:['#fde68a','#93c5fd','#86efac'] }] }, options:{ plugins:{legend:{position:'bottom'}}, maintainAspectRatio:false, animation:{ animateRotate:true, duration:600 } } });
  chartUsage = new Chart(usageCtx, { type:'bar', data:{ labels:['인쇄 대출','전자자료 이용'], datasets:[{ data:[l.loansPrintTotal||0,l.eUseTotal||0], backgroundColor:['#93c5fd','#86efac'] }] }, options:{ plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true } }, maintainAspectRatio:false, animation:{ duration:600 } } });
  chartHoldings = new Chart(holdCtx, { type:'pie', data:{ labels:['국내서','국외서'], datasets:[{ data:[l.holdingsDomestic||0,l.holdingsForeign||0], backgroundColor:['#c4b5fd','#fca5a5'] }] }, options:{ plugins:{legend:{position:'bottom'}}, maintainAspectRatio:false, animation:{ animateRotate:true, duration:700 } } });

  // 주제 Top5 (현재 리스트 기준 합산) - 샘플은 bookCategories 빈도로 계산
  if (subjectCtx) {
    const counts = {};
    libraries.forEach(lib => (lib.bookCategories||[]).forEach(c => counts[c]=(counts[c]||0)+1));
    const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
    chartSubjectTop = new Chart(subjectCtx, { type:'bar', data:{ labels:entries.map(e=>e[0]), datasets:[{ data:entries.map(e=>e[1]), backgroundColor:'#fcd34d' }] }, options:{ plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }, maintainAspectRatio:false, animation:{ duration:600 } } });
  }

  renderWordCloud(l);
}

function renderWordCloud(l){
  const el = document.getElementById('wordCloud');
  if (!el || !window.d3 || !window.d3.layout) return;
  el.innerHTML = '';
  const width = el.clientWidth || 300;
  const height = el.clientHeight || 260;
  const wordsRaw = (l.popularBooks||[]).join(' ');
  const tokens = wordsRaw.split(/\s+/).filter(Boolean);
  const freq = {};
  tokens.forEach(t=>{ freq[t]=(freq[t]||0)+1; });
  const data = Object.entries(freq).map(([text,size])=>({ text, size: 14 + size*6 }));
  const fill = d3.scaleOrdinal(['#8b5e3c','#2563eb','#10b981','#f59e0b','#ef4444','#6366f1']);
  d3.layout.cloud()
    .size([width,height])
    .words(data)
    .padding(5)
    .rotate(()=>0)
    .font('Segoe UI')
    .fontSize(d=>d.size)
    .on('end', (words)=>{
      const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
      const g = svg.append('g').attr('transform', `translate(${width/2},${height/2})`);
      g.selectAll('text')
        .data(words)
        .enter().append('text')
        .style('font-size', d=>d.size+ 'px')
        .style('fill', (d,i)=>fill(i))
        .style('font-weight', 700)
        .attr('text-anchor','middle')
        .attr('transform', d=>`translate(${[d.x,d.y]})rotate(${d.rotate})`)
        .text(d=>d.text)
        .style('opacity',0)
        .transition().duration(500)
        .style('opacity',1);
    })
    .start();
}

// 지도 관련 내부 구현 제거됨 (map.js 사용)
 