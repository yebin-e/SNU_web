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
    polygons: [],
    areas: [],
    detailMode: false,
    hasAnimated: false,
    customOverlay: null
  };

  function emit(event, payload){ (state.listeners[event]||[]).forEach(fn=>{ try{ fn(payload); }catch(_){} }); }

  function ensureKakaoLoaded(cb){
    if (!global.kakao || !global.kakao.maps) return;
    if (state.ready) return cb();
    global.kakao.maps.load(()=>{ state.ready = true; cb(); });
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
    try{ state.hoverOverlay && state.hoverOverlay.setMap(null); }catch(_){ }
    state.hoverOverlay = null;
    state.markers.forEach(m=>{ try{ m.marker.setMap(null); }catch(_){} });
    state.markers = [];
    const prevCharacters = document.querySelectorAll('.character-wrapper');
    prevCharacters.forEach(el => el.remove());
    state.hasAnimated = false;  // 애니메이션 재실행 가능하도록 초기화
    try{ state.clusterer && state.clusterer.clear(); state.clusterer.setMap(null); }catch(_){}
    removePolygons();
  }

  function render(libraries){
    ensureKakaoLoaded(()=>{
      if (!state.map) init(state.containerId, state.options);
      clear();
  
      const rows = Array.isArray(libraries) ? libraries.filter(l => l.lat && l.lng) : [];
      if (rows.length === 0){
        state.map.setCenter(new kakao.maps.LatLng(37.5665, 126.9780));
        state.map.setLevel(8);
        return;
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
        kakao.maps.event.addListener(marker, 'mouseover', () => showHoverCard(d, pos));
        kakao.maps.event.addListener(marker, 'mouseout', hideHoverCard);
        kakao.maps.event.addListener(marker, 'click', () => emit('markerClick', d));
        state.markers.push({ marker, baseSize, lib: d });
  
                // ✅ 캐릭터는 도서관 수만큼 생성되며 정확한 위치로 이동
        if (shouldAnimate) {
          // 줌 레벨 변경 후에 캐릭터 애니메이션 실행
          setTimeout(() => {
            const targetPoint = proj.containerPointFromCoords(pos);
            const startX = Math.random() > 0.5 ? -100 : mapContainer.offsetWidth + 100;
            const startY = Math.random() * mapContainer.offsetHeight;

            const charDiv = document.createElement('div');
            charDiv.className = `character-wrapper ${animClass}`;
            charDiv.style.left = `${startX}px`;
            charDiv.style.top = `${startY}px`;
            charDiv.style.position = 'absolute';
            charDiv.style.transition = (age === 'child')
              ? 'transform 1.2s ease-out'
              : 'transform 2.4s ease-in';

            const img = document.createElement('img');
            img.src = imagePath;
            img.style.width = '72px'; // 크기를 2배로 증가 (36px -> 72px)
            img.style.height = 'auto';
            img.style.pointerEvents = 'none';
            
            // 왼쪽에서 오는 경우 좌우반전
            if (startX < 0) {
              img.style.transform = 'scaleX(-1)';
            }
            
            charDiv.appendChild(img);
            mapContainer.appendChild(charDiv);

            setTimeout(() => {
              charDiv.style.transform = `translate(${targetPoint.x - startX - 36}px, ${targetPoint.y - startY - 72}px)`; // 오프셋도 2배로 조정
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
      state.map.setCenter(center);
      state.map.setLevel(8);
  
      loadInitialPolygons();  // 폴리곤 다시 로드
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
      strokeWeight: 2,
      strokeColor: '#004c80',
      strokeOpacity: 0.8,
      fillColor: '#fff',
      fillOpacity: 0.7
    });
    state.polygons.push(polygon);
    kakao.maps.event.addListener(polygon, 'click', function (mouseEvent) {
      if (!state.detailMode) {
        state.map.setLevel(10);
        state.map.panTo(mouseEvent.latLng);
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
        initPolygons();
      }
    }
  }

  function loadInitialPolygons() {
    if (!state.map) return;
    if (state.ready && state.polygons.length === 0) {
      initPolygons();
    }
  }

  function select(libraryId){
    state.selectedId = libraryId;
  }

  function on(event, handler){
    if (!state.listeners[event]) state.listeners[event] = [];
    state.listeners[event].push(handler);
  }

  global.MapView = { init, render, select, clear, on, loadInitialPolygons };
})(window);
