(function(global){
  const state = {
    map: null,
    clusterer: null,
    markers: [],
    rankOverlays: [],
    hoverOverlay: null,
    selectedId: null,
    listeners: { markerClick: [], markerHover: [] },
    ready: false,
    containerId: 'map',
    options: { level: 8.5 },
    firstRender: true,
    interacted: false,
    polygons: [],
    areas: [],
    detailMode: false,
    hasAnimated: false,
    customOverlay: null,
    roadview: null,
    roadviewClient: null,
    roadviewOverlay: null,
    isPolygonClick: false,
    comfortFxNode: null,
    relaxFxNode: null
  };

  function emit(event, payload){ (state.listeners[event]||[]).forEach(fn=>{ try{ fn(payload); }catch(_){} }); }

  function ensureKakaoLoaded(cb){
    if (!global.kakao || !global.kakao.maps) return;
    if (state.ready) return cb();
    global.kakao.maps.load(()=>{ state.ready = true; cb(); });
  }

  function ensureRoadviewInfra(){
    try {
      const container = document.querySelector('.map-container') || document.getElementById(state.containerId);
      if (!container) return;
      // 컨테이너 position 보정
      try {
        const comp = getComputedStyle(container);
        if (!comp.position || comp.position === 'static') container.style.position = 'relative';
      } catch(_){ container.style.position = 'relative'; }

      // 오버레이 생성
      if (!state.roadviewOverlay) {
        const overlay = document.createElement('div');
        overlay.id = 'roadviewOverlay';
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.zIndex = '999999';
        overlay.style.background = 'rgba(0,0,0,0.45)';
        overlay.style.display = 'none';

        const inner = document.createElement('div');
        inner.className = 'roadview-inner';
        inner.style.position = 'absolute';
        inner.style.left = '50%';
        inner.style.top = '50%';
        inner.style.transform = 'translate(-50%, -50%)';
        inner.style.width = '78%';
        inner.style.height = '70%';
        inner.style.background = '#000';
        inner.style.borderRadius = '12px';
        inner.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
        inner.style.overflow = 'hidden';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', '로드뷰 닫기');
        closeBtn.style.position = 'absolute';
        closeBtn.style.right = '8px';
        closeBtn.style.top = '6px';
        closeBtn.style.zIndex = '2';
        closeBtn.style.width = '34px';
        closeBtn.style.height = '34px';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '8px';
        closeBtn.style.background = 'rgba(255,255,255,0.9)';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '22px';
        closeBtn.style.lineHeight = '1';
        closeBtn.addEventListener('click', hideRoadviewOverlay, { once: false });

        const rv = document.createElement('div');
        rv.id = 'roadview';
        rv.style.width = '100%';
        rv.style.height = '100%';

        inner.appendChild(rv);
        inner.appendChild(closeBtn);
        overlay.appendChild(inner);
        overlay.addEventListener('click', (e)=>{ if (e.target === overlay) hideRoadviewOverlay(); });
        container.appendChild(overlay);
        state.roadviewOverlay = overlay;
      }

      // 로드뷰 객체 준비
      if (!state.roadview || !state.roadviewClient) {
        const roadviewContainer = document.getElementById('roadview');
        if (!roadviewContainer) return;
        state.roadview = new kakao.maps.Roadview(roadviewContainer);
        state.roadviewClient = new kakao.maps.RoadviewClient();
      }
    } catch(_){ }
  }

  function hideRoadviewOverlay(){ try { if (state.roadviewOverlay) state.roadviewOverlay.style.display = 'none'; } catch(_){ } }

  function showRoadviewAt(position){
    try {
      ensureRoadviewInfra();
      if (!state.roadviewClient || !state.roadview) return;
      // position: kakao.maps.LatLng
      state.roadviewClient.getNearestPanoId(position, 50, function(panoId){
        try {
          if (panoId) {
            state.roadview.setPanoId(panoId, position);
            if (state.roadviewOverlay) state.roadviewOverlay.style.display = 'block';
          } else {
            hideRoadviewOverlay();
            showToast('해당 위치에서 로드뷰를 찾을 수 없습니다.');
          }
        } catch(_){ }
      });
    } catch(_){ }
  }

  function showRoadviewForLibrary(library){
    try {
      const lat = Number(library.lat ?? library.latitude);
      const lng = Number(library.lng ?? library.longitude);
      if (!isFinite(lat) || !isFinite(lng)) { showToast('도서관 좌표가 올바르지 않습니다.'); return; }
      const position = new kakao.maps.LatLng(lat, lng);
      showRoadviewAt(position);
    } catch(_){ }
  }

  function applyZoomFactor(baseSize){
    const level = state.map ? state.map.getLevel() : 10;  
    const factor = Math.max(0.6, Math.min(2.5, 1 + (10 - level) * 0.15));
    return Math.round(baseSize * factor);
  }

  function updateMarkerSizes(){
    if (!state.map || !state.markers.length) return;
    state.markers.forEach(m => {
      try {
        const size = applyZoomFactor(m.baseSize);
        const image = new kakao.maps.MarkerImage('icon.png', new kakao.maps.Size(size, size), { offset: new kakao.maps.Point(Math.round(size/2), size-2) });
        m.marker.setImage(image);
      } catch(_) {}
    });
  }

  function updateClusteringMode(){
    if (!state.map) return;
    const level = state.map.getLevel ? state.map.getLevel() : 99;
    const markersOnly = state.markers.map(m => m.marker);
    if (!state.clusterer) {
      markersOnly.forEach(m => { try{ m.setMap(state.map); }catch(_){} });
      return;
    }
    if (level > 8) {
      markersOnly.forEach(m => { try{ m.setMap(null); }catch(_){} });
      try{ state.clusterer.clear(); state.clusterer.addMarkers(markersOnly); state.clusterer.setMap(state.map); }catch(_){ }
    } else {
      try{ state.clusterer.clear(); state.clusterer.setMap(null); }catch(_){ }
      markersOnly.forEach(m => { try{ m.setMap(state.map); }catch(_){} });
    }
  }

  function ensureComfortFxStyle(){
    if (document.getElementById('comfort-fx-style')) return;
    const style = document.createElement('style');
    style.id = 'comfort-fx-style';
    style.textContent = `
      @keyframes comfort-bloom { 0% { transform: scale(0.8) rotate(0deg); opacity: 0; } 5% { opacity: 1; } 100% { transform: scale(1) rotate(360deg); opacity: 1; } }
      @keyframes comfort-float { 0% { transform: translateY(0) translateX(0); opacity: 0.0; } 10% { opacity: 0.95; } 100% { transform: translateY(-180px) translateX(var(--dx, 0px)); opacity: 0; } }
      .comfort-fx-container { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 999999; overflow: hidden; }
      .comfort-fx-flower { position: absolute; font-size: 26px; will-change: transform, opacity; animation: comfort-bloom 400ms ease-out forwards, comfort-float var(--dur, 3000ms) ease-in forwards; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15)); }
    `;
    document.head.appendChild(style);
  }

  function startComfortFx(){
    if (!state.map) return;
    // 이미 실행 중이면 재시작하여 체감 지연을 줄임
    if (state.comfortFxNode) { try { state.comfortFxNode.remove(); } catch(_) {}; state.comfortFxNode = null; }
    ensureComfortFxStyle();
    const container = document.getElementById(state.containerId);
    if (!container) return;
    // 보정: 부모가 positioning이 없으면 상대 배치로 전환하여 absolute 자식 정렬 보장
    const computed = window.getComputedStyle(container);
    if (!computed.position || computed.position === 'static') {
      container.style.position = 'relative';
    }
    const fx = document.createElement('div');
    fx.className = 'comfort-fx-container';
    // 꽃 요소 생성
    const num = 40;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;
    try { console.log('[ComfortFX] start, size:', width, height, 'filter=', window.comfortFilter); } catch(_){ }
    for (let i = 0; i < num; i++) {
      const el = document.createElement('div');
      el.className = 'comfort-fx-flower';
      el.textContent = Math.random() < 0.5 ? '🌸' : '🌼';
      const x = Math.random() * width;
      const y = height - 20 - Math.random() * 20; // 하단에서 피어오름
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.setProperty('--dx', (Math.random()*100 - 50) + 'px');
      el.style.setProperty('--dur', (2000 + Math.random()*1800) + 'ms');
      el.style.animationDelay = (Math.random()*120) + 'ms';
      fx.appendChild(el);
    }
    container.appendChild(fx);
    state.comfortFxNode = fx;
    // 자동 제거 타이머 (4초 후)
    setTimeout(()=>{ stopComfortFx(); }, 4000);
  }

  function stopComfortFx(){
    if (state.comfortFxNode) {
      try { state.comfortFxNode.remove(); } catch(_) {}
      state.comfortFxNode = null;
    }
  }

  function ensureRelaxFxStyle(){
    if (document.getElementById('relax-fx-style')) return;
    const style = document.createElement('style');
    style.id = 'relax-fx-style';
    style.textContent = `
      @keyframes relax-rise { 0% { transform: translateY(0) scale(0.9); opacity: 0; } 15% { opacity: 0.95; } 100% { transform: translateY(-140px) scale(1); opacity: 0; } }
      .relax-fx-container { position: absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index: 999999; overflow:hidden; }
      .relax-fx-steam { position:absolute; font-size: 22px; will-change: transform, opacity; animation: relax-rise var(--dur, 2600ms) ease-out forwards; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.12)); }
    `;
    document.head.appendChild(style);
  }

  function startRelaxFx(){
    if (!state.map || state.relaxFxNode) return;
    ensureRelaxFxStyle();
    const container = document.getElementById(state.containerId);
    if (!container) return;
    const computed = window.getComputedStyle(container);
    if (!computed.position || computed.position === 'static') {
      container.style.position = 'relative';
    }
    const fx = document.createElement('div');
    fx.className = 'relax-fx-container';
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;
    const num = 18;
    for (let i = 0; i < num; i++) {
      const el = document.createElement('div');
      el.className = 'relax-fx-steam';
      el.textContent = Math.random() < 0.5 ? '☕️' : '🫖';
      const x = Math.random() * width;
      const y = height - 40 - Math.random()*30;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.setProperty('--dur', (1600 + Math.random()*1800) + 'ms');
      el.style.opacity = '0';
      fx.appendChild(el);
    }
    container.appendChild(fx);
    state.relaxFxNode = fx;
    setTimeout(()=>{ stopRelaxFx(); }, 3000);
  }

  function stopRelaxFx(){
    if (state.relaxFxNode) {
      try { state.relaxFxNode.remove(); } catch(_) {}
      state.relaxFxNode = null;
    }
  }

  function init(containerId, options){
    state.containerId = containerId || state.containerId;
    state.options = Object.assign({}, state.options, options||{});
    ensureKakaoLoaded(()=>{
      if (state.map) return;
      const center = new kakao.maps.LatLng(37.5665, 126.9780);
      const mapEl = document.getElementById(state.containerId);
      try { if (getComputedStyle(mapEl).position === 'static') mapEl.style.position = 'relative'; } catch(_) { mapEl.style.position = 'relative'; }
      state.map = new kakao.maps.Map(mapEl, {
        center,
        level: state.options.level || 8,
        draggable: true,
        scrollwheel: true,
      });
      const zoomCtrl = new kakao.maps.ZoomControl();
      state.map.addControl(zoomCtrl, kakao.maps.ControlPosition.RIGHT);
      kakao.maps.event.addListener(state.map, 'dragend', ()=>{ state.interacted = true; });
      kakao.maps.event.addListener(state.map, 'zoom_changed', ()=>{ 
        state.interacted = true; 
        updateMarkerSizes(); 
        updateClusteringMode(); 
        // 레벨이 실수로 내려오는 경우 강제로 정수화하여 타일 요청 오류 방지
        try {
          const lvl = state.map.getLevel();
          const rounded = Math.round(lvl);
          if (Math.abs(lvl - rounded) > 1e-6) {
            state.map.setLevel(rounded);
          }
        } catch(_){ }
      });
      // 안전모드: 초기엔 클러스터러 없이 직접 표시 → 이후 updateClusteringMode가 상황에 따라 전환
      try{
        if (typeof kakao.maps.MarkerClusterer !== 'undefined'){
          state.clusterer = new kakao.maps.MarkerClusterer({
            map: null,
            averageCenter: true,
            minLevel: 9
          });
        }
      }catch(e){ }
      loadInitialPolygons();
    });
  }

  function clear(){
    if (!state.map) return;
    if (state.hoverOverlay) {
      state.hoverOverlay.remove();
      state.hoverOverlay = null;
    }
    // 로드뷰/카드 정리
    try { if (state.roadviewCardNode) { state.roadviewCardNode.remove(); state.roadviewCardNode = null; } } catch(_){}
    try { if (state.roadviewContainer) { state.roadviewContainer.style.display = 'none'; } } catch(_){}
    // 랭킹 뱃지 오버레이 제거
    if (state.rankOverlays && state.rankOverlays.length) {
      state.rankOverlays.forEach(o => { try { o.setMap(null); } catch(_){} });
      state.rankOverlays = [];
    }
    state.markers.forEach(m=>{ try{ m.marker.setMap(null); }catch(_){} });
    state.markers = [];
    const prevCharacters = document.querySelectorAll('.character-wrapper');
    prevCharacters.forEach(el => el.remove());
    state.hasAnimated = false;  // 애니메이션 재실행 가능하도록 초기화
    try{ state.clusterer && state.clusterer.clear(); state.clusterer.setMap(null); }catch(_){}
    // 폴리곤은 제거하지 않음 (투명도 유지)
    stopComfortFx();
  }

  // 쾌적함 필터 함수 (도서관 면적 / 이용자 수 비율 기준)
  function getComfortLevel(library) {
    const area = Number(library.area) || 0;
    const visitors = Number(library.visitors) || 1; // 0으로 나누기 방지
    const ratio = area / visitors;
    
    // 비율에 따른 4개 그룹 분류 (실제 데이터에 맞게 조정)
    let comfortLevel;
    if (ratio >= 0.02) {
      comfortLevel = '매우좋음'; // 매우 쾌적함
    } else if (ratio >= 0.01) {
      comfortLevel = '좋음'; // 쾌적함
    } else if (ratio >= 0.005) {
      comfortLevel = '보통'; // 보통
    } else {
      comfortLevel = '좁음'; // 좁음
    }
    
    return comfortLevel;
  }

  function render(libraries){
    ensureKakaoLoaded(()=>{
      if (!state.map) init(state.containerId, state.options);
      clear();
      
      // 현재 도서관 데이터 저장 (필터 재적용을 위해)
      window.currentLibraries = libraries;
      
      // 스크립트 측에서 전달된 데이터만 신뢰하여 렌더
  
      // 쾌적함 필터 적용
      let filteredLibraries = Array.isArray(libraries) ? libraries.filter(l => l.lat && l.lng) : [];
      
      console.log('=== 지도 렌더 ===', { total: libraries.length, withCoords: filteredLibraries.length, comfort: window.comfortFilter });
      
      if (window.comfortFilter && window.comfortFilter !== '' && window.comfortFilter !== null) {
        // 필터 값이 배열인 경우 첫 번째 요소 사용
        let filterValue = window.comfortFilter;
        if (Array.isArray(window.comfortFilter)) {
          filterValue = window.comfortFilter[0]?.comfortLevel || window.comfortFilter[0];
        }

        // script.js에서 이미 사분위 기반으로 comfortLevel이 지정되어 있으면 그 값을 우선 사용
        filteredLibraries = filteredLibraries.filter(library => {
          const levelFromData = library.comfortLevel;
          const level = levelFromData || getComfortLevel(library);
          return level === filterValue;
        });
      }
      // 매우 쾌적함일 때 축하 애니메이션
      // 매우 쾌적함: 즉시 애니메이션 실행
      if (window.comfortFilter === '매우좋음') {
        requestAnimationFrame(()=> startComfortFx());
      } else {
        stopComfortFx();
      }

      // 좌석혼잡도: 여유일 때 편안한 스팀/커피 애니메이션
      const hasRelax = window.selectedStudyCategories && window.selectedStudyCategories.has && window.selectedStudyCategories.has('여유');
      if (hasRelax) {
        requestAnimationFrame(()=> startRelaxFx());
      } else {
        stopRelaxFx();
      }

      const rows = filteredLibraries;
      console.log('최종 렌더링할 도서관 수:', rows.length); // 디버깅
      
      if (rows.length === 0){
        // 데이터가 없어도 기본 중심/레벨로 지도 표시는 유지
        try {
          state.map.setCenter(new kakao.maps.LatLng(37.5665, 126.9780));
          state.map.setLevel(8);
        } catch(_){ }
        // returnせず 진행해 지도가 기본 상태로 보이도록 함
      }
  
      const maxVisitors = Math.max(1, rows.reduce((m, l) => Math.max(m, Number(l.visitors) || 0), 1));
      const baseScale = v => {
        const s = Math.sqrt(Math.max(0, Number(v) || 0) / maxVisitors);
        const baseSize = 14;
        const maxSize = Math.round(baseSize * 2);
        return Math.max(baseSize, Math.min(maxSize, Math.round(baseSize + s * (maxSize - baseSize))));
      };
  
      const bounds = new kakao.maps.LatLngBounds();
      const shouldAnimate = !!window.ageFocus && !state.hasAnimated;
  
      const mapContainer = document.getElementById(state.containerId);
      const proj = state.map.getProjection();
             const age = window.ageFocus;
       let imagePath = '', animClass = '';

       if (shouldAnimate) {
         state.hasAnimated = true;
         if (age === 'child') {
           imagePath = 'img/child_run.gif';
           animClass = 'run-character';
         } else if (age === 'teen') {
           imagePath = 'img/teen_walk.gif';
           animClass = 'walk-character';
         } else if (age === 'adult') {
           imagePath = 'img/adult_walk.gif';
           animClass = 'walk-character';
         }
       }
  
      rows.forEach((d) => {
        // 디버깅: 좌표 데이터 확인
        if (d.lat === null || d.lng === null) {
          console.warn('Library with null coordinates:', d.name, d.lat, d.lng);
        }
        const pos = new kakao.maps.LatLng(d.lat, d.lng);
        bounds.extend(pos);
        const baseSize = baseScale(d.visitors);
        const size = applyZoomFactor(baseSize);
        const image = new kakao.maps.MarkerImage('icon.png', new kakao.maps.Size(size, size), {
          offset: new kakao.maps.Point(Math.round(size / 2), size - 2)
        });
  
        const marker = new kakao.maps.Marker({ position: pos, image, zIndex: 2 });
        // marker.setMap은 클러스터 모드에서 clusterer가 담당
        // 순위 뱃지(Top3) 계산: 나이 Top10 / 도서장르 Top10 / 전자자료 Top10 맥락에서 표시
        let rankForBadge = null;
        try {
          if (window.ageFocus && Array.isArray(window.filteredLibraries) && window.filteredLibraries.length) {
            const idx = window.filteredLibraries.findIndex(lib => lib.id === d.id);
            if (idx !== -1) rankForBadge = idx + 1;
          } else if ((window.activeBookGenre && window.activeBookType) || window.activeElectronicCategory) {
            // 현재 렌더 rows는 이미 Top10 정렬된 상태이므로 index 기반 순위 사용
            // 성능상 rows.indexOf(d)는 O(n)이지만 Top10 규모이므로 무시 가능
            const idx2 = rows.indexOf(d);
            if (idx2 !== -1) rankForBadge = idx2 + 1;
          }
        } catch(_){ }
        if (rankForBadge && rankForBadge >= 1 && rankForBadge <= 3) {
          try {
            const badge = document.createElement('div');
            badge.className = 'map-rank-badge' + (rankForBadge === 1 ? ' rank-1' : rankForBadge === 2 ? ' rank-2' : ' rank-3');
            badge.textContent = String(rankForBadge);
            const ov = new kakao.maps.CustomOverlay({
              position: pos,
              content: badge,
              // 이모지 바로 아래 쪽에 붙도록 앵커/오프셋 조정
              xAnchor: 0.5,
              yAnchor: -0.05,
              zIndex: 3
            });
            ov.setMap(state.map);
            state.rankOverlays.push(ov);
          } catch(_){ }
        }
        // 마커 호버 시 정보 카드 표시/숨김 (필터 상태에 따라 카드 종류 전환)
        kakao.maps.event.addListener(marker, 'mouseover', () => {
          showHoverForCurrentMode(d, pos);
        });
        kakao.maps.event.addListener(marker, 'mouseout', () => {
          // 필터 모드인 경우: 호버 카드 제거
          try { hideHoverCard(); } catch(_){ }
          // 기본 모드인 경우: 로드뷰 카드 제거
          try { if (state.roadviewCardNode) { state.roadviewCardNode.classList.remove('show'); setTimeout(()=>{ try{ state.roadviewCardNode.remove(); }catch(_){} state.roadviewCardNode=null; }, 200); } } catch(_){ }
        });
        // 클릭 시 로드뷰 진입
        kakao.maps.event.addListener(marker, 'click', () => {
          try { hideRoadviewInfoCard(); } catch(_){ }
          try { showRoadviewForLibrary(d); } catch(_){ }
          try { emit('markerClick', d); } catch(_){ }
        });
        state.markers.push({ marker, baseSize, lib: d });
  
                // ✅ 캐릭터는 도서관 수만큼 생성되며 정확한 위치로 이동
        if (shouldAnimate) {
          // 줌 레벨 변경 후에 캐릭터 애니메이션 실행
          setTimeout(() => {
            const targetPoint = proj.containerPointFromCoords(pos);
            // 시작 위치를 더 가깝게 조정 (외곽 거리 단축)
            const startX = Math.random() > 0.5 ? -60 : mapContainer.offsetWidth + 60;
            const startY = Math.random() * mapContainer.offsetHeight;

            const charDiv = document.createElement('div');
            charDiv.className = `character-wrapper ${animClass}`;
            charDiv.style.left = `${startX}px`;
            charDiv.style.top = `${startY}px`;
            charDiv.style.position = 'absolute';
            charDiv.style.zIndex = '1';
            charDiv.style.pointerEvents = 'none';
            charDiv.style.position = 'absolute';
            charDiv.style.transition = (age === 'child')
              ? 'transform 1.2s ease-out'
              : 'transform 1.8s ease-out'; // 청소년/어른 애니메이션 시간 단축
            
            // 왼쪽에서 오는 경우 처음부터 뒤집은 채로 시작
            if (startX < 0) {
              charDiv.style.transform = 'rotateY(180deg)';
            }

            const img = document.createElement('img');
            img.src = imagePath;
            
            // 청소년 캐릭터는 크기를 줄임
            if (age === 'teen') {
              img.style.width = '50px';
            } else {
              img.style.width = '72px'; // 크기를 2배로 증가 (36px -> 72px)
            }
            
            img.style.height = 'auto';
            img.style.pointerEvents = 'none';
            
            // 이미지 개별 transform 제거 (charDiv에서 통합 적용)
            console.log(startX);
            
            charDiv.appendChild(img);
            mapContainer.insertBefore(charDiv, mapContainer.firstChild);
            const overlayNode = document.querySelector('.age-focus-popup');
            if (overlayNode) {
              mapContainer.insertBefore(charDiv, overlayNode);
            } else {
              mapContainer.appendChild(charDiv);
            }

            setTimeout(() => {
              // 청소년 캐릭터는 오프셋을 조정
              let offsetX, offsetY;
              if (age === 'teen') {
                offsetX = 25; // 50px의 절반
                offsetY = 50; // 50px
              } else {
                offsetX = 36; // 72px의 절반
                offsetY = 72; // 72px
              }
              
              // translate만 적용 (rotateY는 이미 초기에 적용됨)
              charDiv.style.transform = `translate(${targetPoint.x - startX - offsetX}px, ${targetPoint.y - startY - offsetY}px)`;
              
              // 왼쪽에서 오는 경우 rotateY도 함께 유지
              if (startX < 0) {
                charDiv.style.transform = `translate(${targetPoint.x - startX - offsetX}px, ${targetPoint.y - startY - offsetY}px) rotateY(180deg)`;
              }
              
              // 캐릭터가 도착하면 이미지를 fin으로 변경
              if (age === 'child') {
                setTimeout(() => {
                  img.src = 'img/child_run_fin.png';
                  img.style.width = '40px'; // fin 이미지는 크기를 조금 줄여서 맞춤
                  charDiv.style.zIndex = '1'; // fin 상태에서도 매우 낮은 z-index 유지
                }, 1200); // 애니메이션 완료 후 이미지 변경 (1.2초)
              } else if (age === 'teen') {
                setTimeout(() => {
                  img.src = 'img/teen_walk_fin.png';
                  img.style.width = '30px'; // teen fin 이미지 크기 조정
                  charDiv.style.zIndex = '1'; // fin 상태에서도 매우 낮은 z-index 유지
                }, 1800); // 애니메이션 완료 후 이미지 변경 (1.8초)
              } else if (age === 'adult') {
                setTimeout(() => {
                  img.src = 'img/adult_walk_fin.png';
                  img.style.width = '40px'; // adult fin 이미지 크기 조정
                  charDiv.style.zIndex = '1'; // fin 상태에서도 매우 낮은 z-index 유지
                }, 1800); // 애니메이션 완료 후 이미지 변경 (1.8초)
              }
            }, 100);
          }, 500); // 줌 레벨 변경 후 0.5초 지연
        }
      });
  
      updateClusteringMode();
  
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const center = new kakao.maps.LatLng(
        (sw.getLat() + ne.getLat()) / 2,
        (sw.getLng() + ne.getLng()) / 2
      );
      try {
        state.map.setCenter(center);
        state.map.setLevel(8);
      } catch(_){ }
  
      // 폴리곤이 이미 로드되어 있으면 다시 로드하지 않음
      if (state.polygons.length === 0) {
        loadInitialPolygons();
      }
    });
  }
  

  function showHoverCard(d, pos){
    // 이미 호버 카드가 있으면 제거
    if (state.hoverOverlay) {
      state.hoverOverlay.remove();
      state.hoverOverlay = null;
    }
    
    const box = document.createElement('div');
    box.className = 'age-focus-popup';
    
    // 연령/쾌적함/좌석혼잡도 지표 계산
    const childMembers = d.연령별회원등록자수_어린이 || 0;
    const teenMembers = d.연령별회원등록자수_청소년 || 0;
    const adultMembers = d.연령별회원등록자수_성인 || 0;
    const totalMembers = childMembers + teenMembers + adultMembers;
    let ageRank = '';
    let ageRatio = 0;
    let ageLabel = '';
    if (window.ageFocus === 'child' && totalMembers > 0) { ageRatio = (childMembers/totalMembers*100).toFixed(1); ageLabel='어린이'; }
    else if (window.ageFocus === 'teen' && totalMembers > 0) { ageRatio = (teenMembers/totalMembers*100).toFixed(1); ageLabel='청소년'; }
    else if (window.ageFocus === 'adult' && totalMembers > 0) { ageRatio = (adultMembers/totalMembers*100).toFixed(1); ageLabel='성인'; }
    if (window.filteredLibraries) {
      const idx = window.filteredLibraries.findIndex(lib => lib.id === d.id);
      if (idx !== -1) ageRank = idx + 1;
    }

    // 쾌적함/좌석혼잡도 순위 계산 (전체 데이터 기준 글로벌 순위)
    let comfortRank = '';
    let crowdingRank = '';
    try {
      const all = (window.allLibraries || []).filter(x => x && x.lat && x.lng);
      if (all.length) {
        // 쾌적함 글로벌 순위 (큰 값 우선)
        const comfortSorted = [...all]
          .filter(x => typeof x.comfortRatio === 'number' && isFinite(x.comfortRatio))
          .sort((a,b) => (b.comfortRatio||0) - (a.comfortRatio||0));
        const cIdx = comfortSorted.findIndex(x => x.id === d.id);
        if (cIdx !== -1) comfortRank = cIdx + 1;

        // 좌석혼잡도 글로벌 순위 (큰 값이 여유)
        // crowdingRatio가 없으면 계산
        const withCrowd = all.map(x => {
          if (typeof x.crowdingRatio === 'number' && isFinite(x.crowdingRatio)) return x;
          const seats = Number(x.seatsTotal) || 0;
          const mChild = Number(x['연령별회원등록자수_어린이']) || 0;
          const mTeen = Number(x['연령별회원등록자수_청소년']) || 0;
          const mAdult = Number(x['연령별회원등록자수_성인']) || 0;
          const members = mChild + mTeen + mAdult;
          return Object.assign({}, x, { crowdingRatio: (seats > 0 && members > 0) ? (seats/members) : 0 });
        });
        const crowdSorted = withCrowd
          .filter(x => typeof x.crowdingRatio === 'number' && isFinite(x.crowdingRatio))
          .sort((a,b) => (b.crowdingRatio||0) - (a.crowdingRatio||0));
        const rIdx = crowdSorted.findIndex(x => x.id === d.id);
        if (rIdx !== -1) crowdingRank = rIdx + 1;
      }
    } catch(_){ }
    
    // 도서 장르/전자자료 카드용 스니펫
    const bookInfo = (window.activeBookGenre && d) ? (()=>{
      const type = window.activeBookType || 'domestic';
      let count = 0;
      if (type === 'domestic') {
        count = (d.domesticCategoriesData||[]).find(c=>c.name===window.activeBookGenre)?.value || 0;
      } else {
        count = (d.foreignCategoriesData||[]).find(c=>c.name===window.activeBookGenre)?.value || 0;
      }
      return `<div class=\"mini-card\" style=\"background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:6px 10px;\">\n                <div style=\"font-size:12px;color:#9a3412;\">${type==='domestic'?'국내서':'국외서'} · ${window.activeBookGenre}</div>\n                <div style=\"font-weight:700;color:#7c2d12;\">${count.toLocaleString()}권</div>\n              </div>`;
    })() : '';
    const electronicInfo = '';

    // 주소 처리: )까지만 표시하고 잘라내기
    let displayAddress = d.address || '-';
    const closeBracketIndex = displayAddress.indexOf(')');
    if (closeBracketIndex !== -1) {
      displayAddress = displayAddress.substring(0, closeBracketIndex + 1);
    }
    
    // 파이차트 SVG 생성 (연령 필터 선택시만)
    const pieChartSVG = `
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="25" fill="none" stroke="#e0e0e0" stroke-width="5"/>
        <circle cx="30" cy="30" r="25" fill="none" stroke="#4CAF50" stroke-width="5" 
                stroke-dasharray="${2 * Math.PI * 25 * ageRatio / 100} ${2 * Math.PI * 25}" 
                transform="rotate(-90 30 30)"/>
        <text x="30" y="35" text-anchor="middle" font-size="12" font-weight="bold" fill="#333">${ageRatio}%</text>
      </svg>
    `;
    
    box.innerHTML = `
      <div class="popup-header">
        ${window.ageFocus ? `<div class="rank-badge">${ageRank}</div>` : ''}
        <div class="library-name">${d.name || ''}</div>
      </div>
      <div class="popup-content">
        <div class="address-section">
          <div class="address-label">주소</div>
          <div class="address-text">${displayAddress}</div>
        </div>
        ${window.ageFocus ? `
        <div class="ratio-section">
          <div class="ratio-label">${ageLabel} 회원 비율</div>
          <div class="pie-chart-container">${pieChartSVG}</div>
        </div>` : ''}
        <div class="rank-section" style="display:flex; gap:12px; flex-wrap:wrap; margin-top:6px;">
          ${window.comfortFilter ? `
          <div class="mini-card" style="background:#ecfdf5;border:1px solid #d1fae5;border-radius:8px;padding:6px 10px;">
            <div style="font-size:12px;color:#065f46;">쾌적함</div>
            <div style="font-weight:700;color:#065f46;">${d.comfortLevel || '-'}</div>
          </div>`:''}
          ${(window.selectedStudyCategories && window.selectedStudyCategories.size>0) ? `
          <div class="mini-card" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:6px 10px;">
            <div style="font-size:12px;color:#075985;">좌석혼잡도</div>
            <div style="font-weight:700;color:#075985;">${d.crowdingLevel || '-'}</div>
          </div>`: ''}
          ${bookInfo}
        </div>
      </div>
    `;
    
    // 지도 좌표를 화면 좌표로 변환
    const mapContainer = document.getElementById('map');
    const proj = state.map.getProjection();
    const point = proj.containerPointFromCoords(pos);
    
    // 카드 위치 계산
    const cardWidth = 320;
    const cardHeight = 200;
    let left = point.x - cardWidth / 2;
    let top = point.y - cardHeight - 10; // 마커 위에 표시
    
    // 화면 경계 체크
    const mapRect = mapContainer.getBoundingClientRect();
    
    // 위쪽 공간이 부족하면 아래쪽으로 표시
    if (top < 10) {
      top = point.y + 30; // 마커 아래에 표시
    }
    
    // 좌우 경계 체크
    if (left < 10) {
      left = 10;
    } else if (left + cardWidth > mapRect.width - 10) {
      left = mapRect.width - cardWidth - 10;
    }
    
    // 카드 스타일 설정
    box.style.position = 'absolute';
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.zIndex = '999999';
    box.style.pointerEvents = 'none'; // 클릭 이벤트 방지
    
    // 지도 컨테이너에 추가
    mapContainer.appendChild(box);
    state.hoverOverlay = box;
    emit('markerHover', d);
  }

  function hideHoverCard(){
    if (state.hoverOverlay) {
      state.hoverOverlay.remove();
      state.hoverOverlay = null;
    }
  }

  function removePolygons() {
    for (let i = 0; i < state.polygons.length; i++) {
      state.polygons[i].setMap(null);
    }
    state.areas = [];
    state.polygons = [];
  }

  function initPolygons() {
    if (!state.map) return;
    if (!state.customOverlay) state.customOverlay = new kakao.maps.CustomOverlay({});
    fetch('sig.json')
      .then(response => response.json())
      .then(geojson => {
        const units = geojson.features;
        units.forEach((unit, index) => {
          const coordinates = unit.geometry.coordinates;
          const name = unit.properties.SIG_KOR_NM;
          const cd_location = unit.properties.SIG_CD;
          const area = { name: name, path: [], location: cd_location };
          coordinates[0].forEach(coordinate => {
            area.path.push(new kakao.maps.LatLng(coordinate[1], coordinate[0]));
          });
          state.areas[index] = area;
        });
        state.areas.forEach(area => displayArea(area));
      });
  }

  function displayArea(area) {
    const polygon = new kakao.maps.Polygon({
      map: state.map,
      path: area.path,
      strokeWeight: 1.5,
      strokeColor: '#004c80',
      strokeOpacity: 0.6,
      fillColor: '#fff',
      fillOpacity: 0.4
    });
    state.polygons.push(polygon);
    kakao.maps.event.addListener(polygon, 'click', function (mouseEvent) {
      // 폴리곤 구역의 크기에 맞춰 줌 레벨 조정
      const clickedLatLng = mouseEvent.latLng;
      
      // 폴리곤의 경계 계산
      const bounds = new kakao.maps.LatLngBounds();
      area.path.forEach(latLng => {
        bounds.extend(latLng);
      });
      
      // 폴리곤의 크기 계산 (위도/경도 차이)
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const latDiff = Math.abs(ne.getLat() - sw.getLat());
      const lngDiff = Math.abs(ne.getLng() - sw.getLng());
      const maxDiff = Math.max(latDiff, lngDiff);
      
      // 크기에 따른 적절한 줌 레벨 계산 (각 폴리곤마다 고유한 적절한 레벨)
      let targetLevel;
      if (maxDiff > 0.1) {
        targetLevel = 7.3; // 큰 구역 (강남구, 송파구 등)
      } else if (maxDiff > 0.05) {
        targetLevel = 6.8; // 중간 구역
      } else {
        targetLevel = 6; // 작은 구역
      }
      
      // 항상 해당 폴리곤의 적절한 줌 레벨로 이동
      const finalLevel = targetLevel;
      
      // 폴리곤 전체가 보이도록 지도 영역을 한 번에 맞춤 (애니메이션 단계 반복 제거)
      try {
        // 약간의 패딩을 주어 경계가 잘 보이도록 함
        state.map.setBounds(bounds, 20, 20, 20, 20);
      } catch (_) {
        // setBounds 지원 이슈가 있을 경우 백업: 중심만 이동
        const center = new kakao.maps.LatLng(
          (sw.getLat() + ne.getLat()) / 2,
          (sw.getLng() + ne.getLng()) / 2
        );
        state.map.setCenter(center);
      }
    });
  }

  function updatePolygonMode() {
    // 폴리곤 투명도는 고정하므로 이 함수는 비활성화
    // 줌 레벨에 따라 폴리곤을 다시 로드하지 않음
    return;
  }

  function loadInitialPolygons() {
    if (!state.map) return;
    if (state.ready && state.polygons.length === 0) {
      initPolygons();
    }
  }

  // 로드뷰 컨테이너/인스턴스 지연 준비
  function ensureRoadviewReady(){ return false; }

  // 로드뷰 진입: 지도 → 로드뷰로 전환, 1초 후 카드 애니메이션 표시
  function enterRoadview(library){ /* disabled */ }

  function revealRoadviewAndCard(library){ try { /* roadview disabled */ } catch(_){} }

  function showRoadviewInfoCard(d){
    try {
      const container = document.querySelector('.map-container') || document.getElementById(state.containerId);
      if (!container) return;
      // 기존 카드 제거
      if (state.roadviewCardNode) { try { state.roadviewCardNode.remove(); } catch(_){} state.roadviewCardNode = null; }
      const card = document.createElement('div');
      card.className = 'rv-info-card';
      card.innerHTML = `
        <div class="rv-card-inner">
          <div class="rv-header">
            <div class="rv-title">${d.name || ''}</div>
            <button class="rv-close" type="button">×</button>
          </div>
          <div class="rv-meta">${(d.address||'-')}</div>
          <div class="rv-stats">
            <div class="rv-chip green">쾌적함: <b>${d.comfortLevel || '-'}</b></div>
            <div class="rv-chip blue">좌석혼잡도: <b>${d.crowdingLevel || '-'}</b></div>
            <div class="rv-chip gray">좌석: <b>${(d.seatsTotal||0).toLocaleString()}석</b></div>
            <div class="rv-chip gray">방문자: <b>${(d.visitors||0).toLocaleString()}명</b></div>
          </div>
        </div>`;
      // 컨테이너가 relative가 아니면 relative로 설정하여 absolute 카드가 정렬되도록 함
      try {
        const comp = getComputedStyle(container);
        if (!comp.position || comp.position === 'static') container.style.position = 'relative';
      } catch(_){ container.style.position = 'relative'; }
      container.appendChild(card);
      state.roadviewCardNode = card;
      // 등장 애니메이션
      requestAnimationFrame(()=>{ card.classList.add('show'); });
      // 닫기
      const closeBtn = card.querySelector('.rv-close');
      if (closeBtn) closeBtn.addEventListener('click', () => { try { hideRoadviewInfoCard(); } catch(_){} }, { once: true });
    } catch(_){ }
  }

  function isAnyFilterActive(){
    try {
      if (window.ageFocus && window.ageFocus !== '') return true;
      if (window.comfortFilter && window.comfortFilter !== null && window.comfortFilter !== '') return true;
      if (window.selectedStudyCategories && window.selectedStudyCategories.size > 0) return true;
      if (window.activeBookGenre && window.activeBookType) return true;
      if (window.activeElectronicCategory) return true;
      return false;
    } catch(_){ return false; }
  }

  function showHoverForCurrentMode(d, pos){
    if (isAnyFilterActive()) {
      showHoverCard(d, pos);
    } else {
      showRoadviewInfoCard(d);
    }
  }

  function hideRoadviewInfoCard(){
    try {
      if (state.roadviewCardNode) {
        try { state.roadviewCardNode.classList.remove('show'); } catch(_){}
        const node = state.roadviewCardNode;
        state.roadviewCardNode = null;
        setTimeout(()=>{ try{ node.remove(); }catch(_){ } }, 200);
      }
    } catch(_){ }
  }

  function exitRoadview(){ try { hideRoadviewInfoCard(); } catch(_){} }

  function showToast(msg){
    try {
      const mapEl = document.getElementById(state.containerId);
      if (!mapEl) return;
      const node = document.createElement('div');
      node.className = 'rv-toast';
      node.textContent = msg;
      mapEl.appendChild(node);
      requestAnimationFrame(()=>{ node.classList.add('show'); });
      setTimeout(()=>{ node.classList.remove('show'); setTimeout(()=>{ try{ node.remove(); }catch(_){} }, 250); }, 1800);
    } catch(_){ }
  }

  function select(libraryId){
    state.selectedId = libraryId;
  }

  function on(event, handler){
    if (!state.listeners[event]) state.listeners[event] = [];
    state.listeners[event].push(handler);
  }

  // 쾌적함 필터 설정 함수
  function setComfortFilter(filterValue) {
    window.comfortFilter = filterValue;
    // script.js에서 render를 호출하도록 함
  }

  // script.js와 연동을 위한 함수
  function showFilteredLibraries(comfortLevel) {
    // 배열을 받으면 해당 목록만 즉시 표시 (TopN 등)
    if (Array.isArray(comfortLevel)) { if (state.map) render(comfortLevel); return; }
    // 문자열은 기존 쾌적함 필터로 처리
    setComfortFilter(comfortLevel);
  }

  // 모든 도서관 표시 함수
  function showAllLibraries() {
    window.comfortFilter = null;
    // script.js에서 render를 호출하도록 함
  }

  global.MapView = { init, render, select, clear, on, loadInitialPolygons, setComfortFilter, showFilteredLibraries, showAllLibraries };
})(window);
