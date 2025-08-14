// MapView: Kakao Maps 기반 지도 모듈
// 공개 API
// - MapView.init(containerId, options?)
// - MapView.render(libraries)
// - MapView.select(libraryId)
// - MapView.clear()
// - MapView.on(event, handler) // 'markerClick', 'markerHover'

(function(global){
  const state = {
    map: null,
    clusterer: null,
    markers: [],
    hoverOverlay: null,
    selectedId: null,
    listeners: { markerClick: [], markerHover: [] },
    ready: false,
    containerId: 'map',
    options: { level: 8 },
    firstRender: true,
    interacted: false,
    // 폴리곤 관련 상태 추가
    polygons: [],
    areas: [],
    detailMode: false,
    customOverlay: null
  };

  function getAgeEmoji(age) {
    switch (age) {
      case '어린이': return '👶';
      case '청소년': return '🧒';
      case '성인': return '🧑';
      default: return '📚';
    }
  }

  function emit(event, payload){ (state.listeners[event]||[]).forEach(fn=>{ try{ fn(payload); }catch(_){} }); }

  function ensureKakaoLoaded(cb){
    if (!global.kakao || !global.kakao.maps) {
      console.log('카카오맵 API가 로드되지 않았습니다');
      return;
    }
    if (state.ready) return cb();
    global.kakao.maps.load(()=>{ 
      state.ready = true; 
      console.log('카카오맵 API 로드 완료');
      cb(); 
    });
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
    console.log(`현재 레벨: ${level}, 마커 개수: ${markersOnly.length}, 클러스터러: ${state.clusterer ? '있음' : '없음'}`);
    
    if (!state.clusterer) {
      // 클러스터러가 없으면 모든 레벨에서 개별 마커 표시
      console.log('클러스터러 없음 - 개별 마커 표시');
      markersOnly.forEach(m => { try{ m.setMap(state.map); }catch(_){} });
      return;
    }
    if (level > 8) {
      // 레벨 8보다 클 때: 클러스터링 모드
      console.log('클러스터링 모드 활성화');
      // 모든 개별 마커를 지도에서 제거
      markersOnly.forEach(m => { 
        try{ m.setMap(null); }catch(_){} 
      });
      // 클러스터러 초기화 후 마커들 추가
      try{ state.clusterer.clear(); }catch(_){ }
      try{ state.clusterer.addMarkers(markersOnly); }catch(_){ }
      try{ state.clusterer.setMap(state.map); }catch(_){ }
    } else {
      // 레벨 8 이하일 때: 개별 마커 표시
      console.log('개별 마커 모드 활성화');
      // 클러스터러를 지도에서 제거
      try{ state.clusterer.clear(); }catch(_){ }
      try{ state.clusterer.setMap(null); }catch(_){ }
      // 모든 개별 마커를 지도에 표시
      markersOnly.forEach(m => { 
        try{ m.setMap(state.map); }catch(_){} 
      });
    }
  }

  function init(containerId, options){
    state.containerId = containerId || state.containerId;
    state.options = Object.assign({}, state.options, options||{});
    ensureKakaoLoaded(()=>{
      if (state.map) return;
      const center = new kakao.maps.LatLng(37.5665, 126.9780);
      state.map = new kakao.maps.Map(document.getElementById(state.containerId), {
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
        updatePolygonMode(); 
      });
      try{
        // MarkerClusterer가 로드되었는지 확인
        if (typeof kakao.maps.MarkerClusterer !== 'undefined'){
          state.clusterer = new kakao.maps.MarkerClusterer({
            map: null,
            averageCenter: true,
            minLevel: 9  // 레벨 8보다 클 때 클러스터링 시작
          });
          console.log('MarkerClusterer 초기화 완료');
        } else {
          console.log('MarkerClusterer를 사용할 수 없습니다 - 라이브러리가 로드되지 않았습니다');
          console.log('사용 가능한 kakao.maps 객체:', Object.keys(kakao.maps));
        }
      }catch(e){ 
        console.log('MarkerClusterer 초기화 실패:', e);
        console.log('kakao.maps 객체:', kakao.maps);
      }
      
      // 지도 초기화 후 즉시 폴리곤 로드
      loadInitialPolygons();
    });
  }

  function clear(){
    if (!state.map) return;
    try{ state.hoverOverlay && state.hoverOverlay.setMap(null); }catch(_){ }
    state.hoverOverlay = null;
    // 모든 개별 마커를 지도에서 제거
    state.markers.forEach(m=>{ try{ m.marker.setMap(null); }catch(_){} });
    state.markers = [];
    // 클러스터러 완전 정리
    try{ state.clusterer && state.clusterer.clear(); }catch(_){}
    try{ state.clusterer && state.clusterer.setMap(null); }catch(_){}
    // 폴리곤 정리
    removePolygons();
  }

  function render(libraries){
    ensureKakaoLoaded(()=>{
      if (!state.map) init(state.containerId, state.options);
      clear();
      const rows = Array.isArray(libraries) ? libraries.filter(l=>l.lat&&l.lng) : [];
      if (rows.length === 0){
        state.map.setCenter(new kakao.maps.LatLng(37.5665, 126.9780));
        state.map.setLevel(state.options.level || 8);
        return;
      }
      // 반지름 스케일(px) - 이용자 수에 따라 최대 1.5배까지 증가
      const maxVisitors = Math.max(1, rows.reduce((m,l)=>Math.max(m, Number(l.visitors)||0), 1));
      const baseScale = v => {
        const s = Math.sqrt(Math.max(0, Number(v)||0) / maxVisitors);
        const baseSize = 14; // 기본 크기
        const maxSize = Math.round(baseSize * 2); // 최대 1.5배
        return Math.max(baseSize, Math.min(maxSize, Math.round(baseSize + s * (maxSize - baseSize))));
      };

      const bounds = new kakao.maps.LatLngBounds();
      rows.forEach((d)=>{
        const pos = new kakao.maps.LatLng(d.lat, d.lng);
        bounds.extend(pos);
        const baseSize = baseScale(d.visitors);
        const size = applyZoomFactor(baseSize);
        const image = new kakao.maps.MarkerImage('icon.png', new kakao.maps.Size(size, size), { offset: new kakao.maps.Point(Math.round(size/2), size-2) });
        const marker = new kakao.maps.Marker({ position: pos, image, zIndex: 2 });
        // 마커를 바로 지도에 표시하지 않고 상태에만 저장

        if (!window.ageFocus) {
          return; // 캐릭터도 마커도 만들지 않음
        }
        // 마커를 생성하고 위치 설정한 이후에 추가
        const emoji = getAgeEmoji(window.ageFocus || '');  // 전역 상태 참조
        const emojiDiv = document.createElement('div');
        emojiDiv.className = 'emoji-character';
        emojiDiv.innerText = emoji;

        emojiDiv.style.position = 'relative';
        emojiDiv.style.animation = 'runAndStand 0.8s ease-out';
        const mapContainer = document.getElementById(state.containerId);
        const proj = state.map.getProjection();
        const targetPoint = proj.containerPointFromCoords(pos);

        // 랜덤 시작점 (지도 바깥쪽)
        const startX = Math.random() > 0.5 ? -100 : mapContainer.offsetWidth + 100;
        const startY = Math.random() * mapContainer.offsetHeight;

        // 캐릭터 이미지 결정
        const age = window.ageFocus || '';
        let imagePath = '';
        let animClass = '';

        if (age === '어린이') {
          imagePath = 'img/child_run.gif';
          animClass = 'run-character';
        } else {
          imagePath = 'img/adult_walk.gif';
          animClass = 'walk-character';
        }

        // DOM 생성
        const charDiv = document.createElement('div');
        charDiv.className = `character-wrapper ${animClass}`;
        charDiv.style.left = `${startX}px`;
        charDiv.style.top = `${startY}px`;

        const img = document.createElement('img');
        img.src = imagePath;
        img.style.width = '36px';
        img.style.height = 'auto';
        img.style.pointerEvents = 'none';

        charDiv.appendChild(img);
        mapContainer.appendChild(charDiv);

        // 이동 애니메이션
        setTimeout(() => {
          charDiv.style.transform = `translate(${targetPoint.x - startX}px, ${targetPoint.y - startY}px)`;
        }, 100); // 다음 프레임에 실행

        // 위치 고정
        charDiv.style.position = 'absolute';
        charDiv.style.transition = age === '어린이' ? 'transform 1.2s ease-out' : 'transform 2.4s ease-in';

        const emojiOverlay = new kakao.maps.CustomOverlay({
          content: emojiDiv,
          position: pos,
          yAnchor: 1.2,
          xAnchor: 0.5,
          zIndex: 4
        });
        emojiOverlay.setMap(state.map);

        kakao.maps.event.addListener(marker, 'mouseover', () => showHoverCard(d, pos));
        kakao.maps.event.addListener(marker, 'mouseout', hideHoverCard);
        kakao.maps.event.addListener(marker, 'click', () => emit('markerClick', d));
        state.markers.push({ marker, baseSize, lib: d });
      });
      updateClusteringMode();
      try{
        if (state.firstRender) {
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          const center = new kakao.maps.LatLng((sw.getLat()+ne.getLat())/2, (sw.getLng()+ne.getLng())/2);
          state.map.setCenter(center);
          state.map.setLevel(state.options.level || 8);
          state.firstRender = false;
        } else if (state.interacted) {
          state.map.setBounds(bounds, 20, 20, 20, 20);
        } else {
          // 유지: 사용자가 아직 상호작용하지 않은 경우 초기 확대 유지
          // 필요시 중심만 약간 보정하려면 아래 주석을 켜세요
          // const sw = bounds.getSouthWest();
          // const ne = bounds.getNorthEast();
          // const center = new kakao.maps.LatLng((sw.getLat()+ne.getLat())/2, (sw.getLng()+ne.getLng())/2);
          // state.map.setCenter(center);
          state.map.setLevel(state.options.level || 8);
        }
      }catch(_){ }
    });
  }

  function showHoverCard(d, pos){
    try{ state.hoverOverlay && state.hoverOverlay.setMap(null); }catch(_){ }
    const totalHoldings = (d.holdingsDomestic||0) + (d.holdingsForeign||0);
    const box = document.createElement('div');
    box.className = 'ko-popup';
    box.innerHTML = `
      <div class="title">${d.name||''}</div>
      <div class="meta">
        주소: ${d.address||'-'}<br/>
        방문자수: ${(d.visitors||0).toLocaleString()}명<br/>
        보유도서: ${totalHoldings.toLocaleString()}권
      </div>
    `;
    state.hoverOverlay = new kakao.maps.CustomOverlay({ position: pos, content: box, yAnchor: 1.1, xAnchor: 0.5, zIndex: 12 });
    state.hoverOverlay.setMap(state.map);
    emit('markerHover', d);
  }

  function hideHoverCard(){
    try{ state.hoverOverlay && state.hoverOverlay.setMap(null); }catch(_){ }
    state.hoverOverlay = null;
  }

  // 폴리곤 관련 함수들
  function removePolygons() { 
    for (let i = 0; i < state.polygons.length; i++) {
      state.polygons[i].setMap(null);
    }
    state.areas = [];
    state.polygons = [];
  }

  function initPolygons() {
    if (!state.map) return;
    
    // CustomOverlay 초기화
    if (!state.customOverlay) {
      state.customOverlay = new kakao.maps.CustomOverlay({});
    }

    // sig.json 파일에서 서울시 행정구역 데이터 로드
    fetch('sig.json')
      .then(response => response.json())
      .then(geojson => {
        const units = geojson.features;
        
        units.forEach((unit, index) => {
          const coordinates = unit.geometry.coordinates;
          const name = unit.properties.SIG_KOR_NM;
          const cd_location = unit.properties.SIG_CD;

          const area = {
            name: name,
            path: [],
            location: cd_location
          };

          // 좌표 변환 (GeoJSON은 [lng, lat] 순서, 카카오맵은 [lat, lng] 순서)
          coordinates[0].forEach(coordinate => {
            area.path.push(new kakao.maps.LatLng(coordinate[1], coordinate[0]));
          });

          state.areas[index] = area;
        });

        // 폴리곤 표시
        state.areas.forEach(area => {
          displayArea(area);
        });
      })
      .catch(error => {
        console.error('폴리곤 데이터 로드 실패:', error);
      });
  }

  function displayArea(area) {
    const polygon = new kakao.maps.Polygon({
      map: state.map,
      path: area.path,
      strokeWeight: 2,
      strokeColor: '#004c80',
      strokeOpacity: 0.8,
      fillColor: '#fff',
      fillOpacity: 0.7
    });
    
    state.polygons.push(polygon);

    // 클릭 이벤트만 유지 (호버 이벤트 제거)
    kakao.maps.event.addListener(polygon, 'click', function (mouseEvent) {
      if (!state.detailMode) {
        state.map.setLevel(10);
        const latlng = mouseEvent.latLng;
        state.map.panTo(latlng);
      } else {
        // 상세 모드에서의 클릭 이벤트 (필요시 구현)
        console.log('클릭된 구역:', area.name, area.location);
      }
    });
  }

  function updatePolygonMode() {
    if (!state.map) return;
    
    const level = state.map.getLevel();
    const newDetailMode = level <= 10;
    
    if (newDetailMode !== state.detailMode) {
      state.detailMode = newDetailMode;
      if (state.detailMode && state.polygons.length === 0) {
        // 상세 모드로 전환되고 폴리곤이 없으면 초기화
        initPolygons();
      }
    }
  }

  // 초기 폴리곤 로드 함수 추가
  function loadInitialPolygons() {
    if (!state.map) return;
    
    // 지도가 준비되면 즉시 폴리곤 초기화
    if (state.ready && state.polygons.length === 0) {
      initPolygons();
    }
  }

  function select(libraryId){
    state.selectedId = libraryId;
    // 선택 스타일 변경이 필요하면 여기서 마커 이미지 교체 등 구현
  }

  function on(event, handler){
    if (!state.listeners[event]) state.listeners[event] = [];
    state.listeners[event].push(handler);
  }

  global.MapView = { init, render, select, clear, on, loadInitialPolygons };
})(window);

