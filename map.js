// MapView: Kakao Maps 기반 지도 모듈
// 공개 API
// - MapView.init(containerId, options?)
// - MapView.render(libraries)
// - MapView.select(libraryId)
// - MapView.clear()
// - MapView.on(event, handler) // 'markerClick', 'markerHover'
console.log('test');
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

  // 구별 도서관 개수 계산
  function calculateAreaLibraries(libraries) {
    const areaCounts = {};
    
    libraries.forEach(lib => {
      const address = lib.address || '';
      // 주소에서 구 이름 추출 (예: "서울특별시 강남구 ..." -> "강남구")
      const districtMatch = address.match(/([가-힣]+구)/);
      if (districtMatch) {
        const district = districtMatch[1];
        areaCounts[district] = (areaCounts[district] || 0) + 1;
      }
    });
    
    return areaCounts;
  }

  // 구별 클러스터 생성
  function createAreaClusters(libraries) {
    const areaCounts = calculateAreaLibraries(libraries);
    
    console.log('구별 도서관 개수:', areaCounts);
    console.log('사용 가능한 구역:', state.areas.map(a => a.name));
    
    // 기존 클러스터 제거
    clearAreaClusters();
    
    state.areas.forEach(area => {
      const count = areaCounts[area.name] || 0;
      if (count > 0) {
        console.log(`${area.name}: ${count}개 도서관`);
        const cluster = createClusterOverlay(area, count);
        state.areaClusters.push(cluster);
      }
    });
    
    console.log('생성된 클러스터 개수:', state.areaClusters.length);
  }

  // 클러스터 오버레이 생성
  function createClusterOverlay(area, count) {
    // 구의 중심점 계산
    const center = calculateAreaCenter(area.path);
    
    // 도서관 개수에 따른 크기 클래스 결정
    let sizeClass = '';
    if (count <= 3) sizeClass = 'small';
    else if (count >= 10) sizeClass = 'large';
    
    const clusterDiv = document.createElement('div');
    clusterDiv.className = 'area-cluster';
    clusterDiv.innerHTML = `
      <div class="cluster-circle ${sizeClass}">
        <span class="cluster-count">${count}</span>
      </div>
      <div class="cluster-label">${area.name}</div>
    `;
    
    const overlay = new kakao.maps.CustomOverlay({
      position: center,
      content: clusterDiv,
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 10
    });
    
    // 클러스터 클릭 이벤트
    clusterDiv.addEventListener('click', () => {
      // 해당 구로 확대
      state.map.setLevel(10);
      state.map.panTo(center);
    });
    
    return overlay;
  }

  // 구의 중심점 계산
  function calculateAreaCenter(path) {
    if (!path || path.length === 0) {
      return new kakao.maps.LatLng(37.5665, 126.9780);
    }
    
    let sumLat = 0, sumLng = 0;
    path.forEach(point => {
      sumLat += point.getLat();
      sumLng += point.getLng();
    });
    
    return new kakao.maps.LatLng(sumLat / path.length, sumLng / path.length);
  }

  // 구별 클러스터 제거
  function clearAreaClusters() {
    state.areaClusters.forEach(cluster => {
      try {
        cluster.setMap(null);
      } catch(_) {}
    });
    state.areaClusters = [];
  }

  // 구별 클러스터 표시
  function showAreaClusters() {
    state.areaClusters.forEach(cluster => {
      try {
        cluster.setMap(state.map);
      } catch(_) {}
    });
  }

  // 구별 클러스터 숨기기
  function hideAreaClusters() {
    state.areaClusters.forEach(cluster => {
      try {
        cluster.setMap(null);
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
      
      // 구별 클러스터 표시
      showAreaClusters();
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
      
      // 구별 클러스터 숨기기
      hideAreaClusters();
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
        level: state.options.level || 3,
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
    // 구별 클러스터 정리
    clearAreaClusters();
  }

  function render(libraries){
    ensureKakaoLoaded(()=>{
      if (!state.map) init(state.containerId, state.options);
      clear();
      const rows = Array.isArray(libraries) ? libraries.filter(l=>l.lat&&l.lng) : [];
      if (rows.length === 0){
        state.map.setCenter(new kakao.maps.LatLng(37.5665, 126.9780));
        state.map.setLevel(state.options.level || 3);
        return;
      }
      
      // 폴리곤 초기화 (구별 경계선) 후 클러스터 생성
      if (state.areas.length === 0) {
        initPolygons().then(() => {
          // 구별 클러스터 생성
          createAreaClusters(rows);
        });
      } else {
        // 구별 클러스터 생성
        createAreaClusters(rows);
      }
      
      // 반지름 스케일(px)
      const maxVisitors = Math.max(1, rows.reduce((m,l)=>Math.max(m, Number(l.visitors)||0), 1));
      const baseScale = v => {
        const s = Math.sqrt(Math.max(0, Number(v)||0) / maxVisitors);
        return Math.max(24, Math.round(6 + s*20)*2);
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
          state.map.setLevel(state.options.level || 3);
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
          state.map.setLevel(state.options.level || 3);
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
    if (!state.map) return Promise.resolve();
    
    // CustomOverlay 초기화
    if (!state.customOverlay) {
      state.customOverlay = new kakao.maps.CustomOverlay({});
    }

    // sig.json 파일에서 서울시 행정구역 데이터 로드
    return fetch('sig.json')
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
        
        console.log('폴리곤 초기화 완료:', state.areas.length, '개 구역');
        return state.areas;
      })
      .catch(error => {
        console.error('폴리곤 데이터 로드 실패:', error);
        return [];
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

    // 마우스 오버 이벤트
    kakao.maps.event.addListener(polygon, 'mouseover', function (mouseEvent) {
      polygon.setOptions({fillColor: '#09f'});
      state.customOverlay.setContent('<div class="area">' + area.name + '</div>');
      state.customOverlay.setPosition(mouseEvent.latLng);
      state.customOverlay.setMap(state.map);
    });

    // 마우스 이동 이벤트
    kakao.maps.event.addListener(polygon, 'mousemove', function (mouseEvent) {
      state.customOverlay.setPosition(mouseEvent.latLng);
    });

    // 마우스 아웃 이벤트
    kakao.maps.event.addListener(polygon, 'mouseout', function () {
      polygon.setOptions({fillColor: '#fff'});
      state.customOverlay.setMap(null);
    });

    // 클릭 이벤트
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

  function select(libraryId){
    state.selectedId = libraryId;
    // 선택 스타일 변경이 필요하면 여기서 마커 이미지 교체 등 구현
  }

  function on(event, handler){
    if (!state.listeners[event]) state.listeners[event] = [];
    state.listeners[event].push(handler);
  }

  global.MapView = { init, render, select, clear, on };
})(window);


