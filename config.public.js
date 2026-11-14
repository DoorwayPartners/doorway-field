// Doorway Field — public page config (config.public.js, ships in every drop). No secrets, no Drive/Sheet/Script IDs, no emails. Public tile URLs only.
// Runtime endpoints come from config.env.js (persistent, never in a zip, loaded first): only the ENV_KEYS below are taken from it.
// Everything here is a default: the owner edits roster, campaigns and pin inventory in Admin (saved on the device until the API ships).
window.DF_CONFIG = (function () {
  const ENV_KEYS = ['API_URL', 'ORG_ID', 'BASEMAP', 'IMAGERY'], src = window.DF_ENV || {}, env = {};
  ENV_KEYS.forEach(k => { if (typeof src[k] === 'string') env[k] = src[k]; });   // whitelist: config.env.js can never inject a roster
  return Object.assign({
  VERSION: '2.4.3',
  ORG_ID: 'doorway',
  API_URL: '',                 // stays blank here: the live Sync URL lives in config.env.js. Admin › Sync Outbox can also set one per device
  FIXTURE_URL: '',             // tests/dev only
  BASEMAP: 'google',           // 'google' (Hybrid / Street / Satellite) | 'esri' (Esri imagery + OpenFreeMap). Google auto-falls back to Esri
  IMAGERY: 'esri',             // fallback imagery: 'esri' | 'usgs'
  DEFAULT_MODE: 'hybrid',
  FLUSH_EVERY_MS: 120000,      // batched background sync (also on screen-off / app-hide and the manual Sync button)
  UNDO_MS: 5000,
  CAMPAIGNS: ['Fidium', 'AT&T Fiber', 'Brightspeed', 'Frontier'],
  DEFAULT_CAMPAIGN: 'Fidium',  // legacy v1 leads + rows imported without a campaign
  // Public seed only: the Owner + generic sample roles. Real team names / PINs are entered in Admin › Roster (saved in IndexedDB on the
  // device and synced through the private Sync endpoint), so no rep names or emails ever sit in the public repo.
  ROSTER: [
    { id: 'cristian-coy', name: 'Cristian Coy', role: 'Owner', team: 'Leadership', campaigns: ['*'], color: '#e31b23' },
    { id: 'manager-1', name: 'Manager 1', role: 'Manager', team: 'Team 1', campaigns: ['*'], color: '#2f80ed' },
    { id: 'agent-1', name: 'Agent 1', role: 'Agent', team: 'Team 1', campaigns: ['Fidium'], color: '#00a3a3' }
  ],
  SOLD_FIELDS: [
    { key: 'customer_name', label: 'Customer Name', type: 'text', required: true },
    { key: 'speed_tier', label: 'Speed Tier', type: 'text', required: true },
    { key: 'phone_email', label: 'Phone / Email', type: 'text', required: true },
    { key: 'install_date', label: 'Install Date', type: 'date', required: false }
  ],
  ROUTE_MAX_STOPS: 23,
  GEOCODE_URL: 'https://nominatim.openstreetmap.org/reverse',
  SEARCH_URL: 'https://nominatim.openstreetmap.org/search',      // street / town jump: only when the rep taps Search Town/Street   // free OSM reverse geocoder: light use only (1 request/s, cached)
  TILES: {
    google: 'https://mt{s}.google.com/vt/lyrs={lyrs}&x={x}&y={y}&z={z}&scale=2',   // y hybrid | m street | s satellite; scale=2 = retina tiles
    googleAttr: 'Map data © Google',
    esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    esriAttr: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    usgs: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    usgsAttr: 'USDA, USGS The National Map: Orthoimagery',
    streetStyle: 'https://tiles.openfreemap.org/styles/liberty',
    vector: 'https://tiles.openfreemap.org/planet',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    font: 'Noto Sans Regular',
    vectorAttr: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
}, env, window.DF_CONFIG_OVERRIDE || {});
})();
