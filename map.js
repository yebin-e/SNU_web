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
    markers: [],
    hoverOverlay: null,
    selectedId: null,
    listeners: { markerClick: [], markerHover: [] },
    ready: false,
    containerId: 'map',
    options: { level: 8 },
    firstRender: true,
    interacted: false
  };

  function emit(event, payload){ (state.listeners[event]||[]).forEach(fn=>{ try{ fn(payload); }catch(_){} }); }

  function ensureKakaoLoaded(cb){
    if (!global.kakao || !global.kakao.maps || !global.kakao.maps.load) return;
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
      kakao.maps.event.addListener(state.map, 'zoom_changed', ()=>{ state.interacted = true; updateMarkerSizes(); });
    });
  }

  function clear(){
    if (!state.map) return;
    try{ state.hoverOverlay && state.hoverOverlay.setMap(null); }catch(_){}
    state.hoverOverlay = null;
    state.markers.forEach(m=>{ try{ m.setMap(null); }catch(_){} });
    state.markers = [];
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
        marker.setMap(state.map);

        kakao.maps.event.addListener(marker, 'mouseover', () => showHoverCard(d, pos));
        kakao.maps.event.addListener(marker, 'mouseout', hideHoverCard);
        kakao.maps.event.addListener(marker, 'click', () => emit('markerClick', d));
        state.markers.push({ marker, baseSize, lib: d });
      });
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


